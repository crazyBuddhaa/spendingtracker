import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTransactionsCsv } from "./csv.ts";
import { applyCategoryRules, categorise, isOwnAccountTransfer, isWalletProductMovement, normaliseTransactionDescription, recogniseTransactionParty, refreshCategories, ruleMatches, similarityKey } from "./categorise.ts";
import { parseStatementSheets } from "./workbookStatement.ts";
import { calculateTotals, getMonthlySeries, previousRange, resolvePeriod } from "./insights.ts";
import {
  findRecurringPayments,
  getBudgetStatus,
  getFeeSummary,
  getMonthlyReport,
  getSpendingRhythm,
  getTopCounterparties,
  suggestBudget,
} from "./analytics.ts";
import { parseStoredTransactions, serializeTransactions } from "./transactionStorage.ts";
import { buildImportPreview } from "./importPreview.ts";
import { buildClassificationHistory, classifyTransaction, classifyTransactions, getSimilarTransactionCounts } from "./transactionIntelligence.ts";
import { detectRecurringRecipients, getClassificationReviewQueue, reclassifyHistoricalTransactions } from "./transactionReview.ts";
import { createBackup, normaliseBudgets, normaliseRules, readBackup } from "./backup.ts";
import { getRecipientDirectory, normaliseRecipientProfiles, resolveTransactionParty } from "./recipientProfiles.ts";
import { detectTypicalFareRanges } from "./recipientAnalytics.ts";

const tx = (overrides) => ({
  id: overrides.id ?? `t-${Math.random()}`,
  date: "2026-09-01",
  description: "Something",
  amount: 1000,
  direction: "expense",
  category: "Other",
  source: "Test",
  ...overrides,
});

describe("OPay-aware categorisation", () => {
  it("files levies, stamp duty, SMS and redemption fees as bank fees", () => {
    for (const description of ["Electronic Money Transfer Levy", "Stamp Duty", "SMS Subscription", "Targets redemption fee", "Outstanding USSD Charge", "VAT on Transfer Fee"]) {
      assert.equal(categorise(description, "expense"), "Bank fees", description);
    }
  });

  it("recognises everyday OPay payment types", () => {
    assert.equal(categorise("Mobile Data | 8140000000 | MTN", "expense"), "Airtime & data");
    assert.equal(categorise("Airtime | 8140000000 | MTN", "expense"), "Airtime & data");
    assert.equal(categorise("TV | 02146199364 | Startimes | DTT_Classic", "expense"), "Bills & utilities");
    assert.equal(categorise("WAEC | 08140000000 | WAEC", "expense"), "Education");
    assert.equal(categorise("Third-Party Merchant Order | Paystack Payment Limited", "expense"), "Shopping");
    assert.equal(categorise("Transfer to POS Transfer - JOHN DOE | MONIE POINT | 123", "expense"), "Cash withdrawal");
    assert.equal(categorise("Transfer to Remita Checkout | Fidelity Bank | 123", "expense"), "Bills & utilities");
    assert.equal(categorise("Transfer to JANE DOE | OPay | 123 | PAYMENT FOR HOUSE RENT 2026", "expense"), "Rent & housing");
  });

  it("treats football.com and its payout processors as betting, both ways", () => {
    assert.equal(categorise("Third-Party Merchant Order | Football Internet Limited", "expense"), "Betting");
    assert.equal(categorise("Transfer from Soti Payment Limited | OPay | 955****167 | L2311puid1|Footbal", "income"), "Betting");
    assert.equal(categorise("Betting | 8140000000 | SPORTYBET", "expense"), "Betting");
  });

  it("separates refunds and interest from ordinary income", () => {
    assert.equal(categorise("Reversal - OPay Card Payment", "income"), "Refunds");
    assert.equal(categorise("Refund", "income"), "Refunds");
    assert.equal(categorise("OWealth Interest Earned", "income"), "Income");
    assert.equal(categorise("Transfer from ACME LTD | GTBank | 123", "income"), "Income");
  });

  it("does not let word fragments trigger a category", () => {
    assert.equal(categorise("Transfer to TONICE BUSINESS VENTURES | UBA | 1", "expense"), "Transfers");
    assert.equal(categorise("Transfer to TAXIFY NIGERIA | X", "expense"), "Transfers");
  });

  it("marks every OPay savings-pot movement as the customer's own money", () => {
    for (const description of [
      "OWealth Deposit", "OWealth Withdrawal(Transaction Payment)", "Auto-save to OWealth Balance",
      "Spend & Save Deposit", "Spend & Save Withdrawal", "OWealth Deposit(from Spend & Save)", "Targets Deposit", "Targets payout",
      "OWealth Deposit(from Fixed)",
    ]) {
      assert.equal(isWalletProductMovement(description), true, description);
    }
    assert.equal(isWalletProductMovement("OWealth Interest Earned"), false);
    assert.equal(isWalletProductMovement("Targets redemption fee"), false);
  });
});

describe("own-account transfer detection", () => {
  const holder = "OLUWAFEMI ADEDAMOLA ADEKANMI";
  it("matches full names in any order, partial names of two or more parts, and wallet-app prefixes", () => {
    assert.equal(isOwnAccountTransfer("Transfer from ADEKANMI, ADEDAMOLA OLUWAFEMI | bank | 1", holder), true);
    assert.equal(isOwnAccountTransfer("Transfer to oluwafemi adekanmi | M&M MFB | 5", holder), true);
    assert.equal(isOwnAccountTransfer("Transfer from Palmpay - Oluwafemi Adedamola Adekanmi | x", holder), true);
    assert.equal(isOwnAccountTransfer("Transfer to PIGGYVEST/ADEKANMI OLUWAFEMI | PAYSTACK-TITAN | 9", holder), true);
    assert.equal(isOwnAccountTransfer("Transfer to Oluwafemi Adekanmi(Sub2me) | X | 1", holder), true);
  });

  it("does not match relatives who share only a surname", () => {
    assert.equal(isOwnAccountTransfer("Transfer to ADEKANMI ADEKANMI ISAAC | UBA | 2", holder), false);
    assert.equal(isOwnAccountTransfer("Transfer to WUMI AMINAT ADEKANMI | OPay | 9", holder), false);
    assert.equal(isOwnAccountTransfer("Transfer to ADEKANMI | OPay | 9", holder), false);
  });

  it("matches the holder's own account number and card top-ups", () => {
    assert.equal(isOwnAccountTransfer("Transfer to SOMEONE ELSE | M&M MFB | 8147119891", undefined, "8147119891"), true);
    assert.equal(isOwnAccountTransfer("Add Money-Bank Card | Access Bank | 418745******4190", holder), true);
  });
});

describe("statement parsing details", () => {
  it("keeps the value date but records the time from the transaction date column", () => {
    const result = parseTransactionsCsv(
      "Trans. Date,Value Date,Description,Debit(₦),Credit(₦)\n16 Jun 2026 23:59:58,17 Jun 2026,Airtime | 1 | MTN,100,--",
      "opay.xlsx",
    );
    assert.equal(result.transactions[0].date, "2026-06-17");
    assert.equal(result.transactions[0].time, "23:59:58");
    assert.equal(result.transactions[0].category, "Airtime & data");
  });

  it("explains an OPay header that prints the same total for debits and credits", () => {
    const header = "Trans. Date,Value Date,Description,Debit(₦),Credit(₦),Balance After(₦),Channel,Transaction Reference";
    const cells = {
      A1: "Wallet Account Statement", A2: "Account Name", B2: "Test User", C2: "Account Number", D2: "8100000000",
      B3: "Wallet Account", D4: "₦50.00", F4: "1", D5: "₦50.00", F5: "1",
    };
    const sheets = [
      { name: "Wallet Account Transactions", csv: `${header}\n01 Sep 2026 10:00:00,01 Sep 2026,Airtime | 1 | MTN,40.00,--,0,Mobile,R1\n01 Sep 2026 09:00:00,01 Sep 2026,Transfer from Payer | Bank | 1,--,50.00,50,Mobile,R2`, cell: (a) => cells[a] ?? "" },
      { name: "Savings Account Transactions", csv: header, cell: (a) => ({ ...cells, A1: "Savings Account Statement", B3: "Savings Account" })[a] ?? "" },
    ];
    const result = parseStatementSheets(sheets, "opay.xlsx");
    assert.equal(result.transactions.length, 2);
    assert.ok(result.warnings.some((warning) => /same figure .* for total debit and total credit/.test(warning)));
  });
});

describe("user rules", () => {
  const rule = { id: "r1", pattern: "third-party merchant order", category: "Business", createdAt: "2026-10-19" };

  it("applies rules to unlocked transactions only and can mark them internal", () => {
    const transactions = [
      tx({ id: "a", description: "Third-Party Merchant Order | Paystack" }),
      tx({ id: "b", description: "Third-Party  Merchant Order | Kora", categoryLocked: true, category: "Health" }),
      tx({ id: "c", description: "Airtime | MTN" }),
    ];
    const result = applyCategoryRules(transactions, [rule, { id: "r2", pattern: "airtime", category: "Business", markInternal: true, createdAt: "" }]);
    assert.equal(result[0].category, "Business");
    assert.equal(result[1].category, "Health");
    assert.equal(result[2].internalTransfer, true);
  });

  it("builds similarity keys that ignore account numbers and spacing", () => {
    assert.equal(similarityKey("Transfer to  ISAAC  ADEKANMI | United Bank For Africa | 1024085079"), "transfer to isaac adekanmi");
    assert.ok(ruleMatches({ ...rule, pattern: "transfer to isaac adekanmi" }, tx({ description: "Transfer to ISAAC  ADEKANMI | UBA | 1" })));
    assert.ok(!ruleMatches({ ...rule, direction: "income" }, tx({ description: "Third-Party Merchant Order" })));
  });

  it("re-categorises old imports without touching hand-picked categories or manual entries", () => {
    const old = [
      tx({ id: "1", description: "Electronic Money Transfer Levy", category: "Transfers" }),
      tx({ id: "2", description: "Spend & Save Deposit", category: "Transfers" }),
      tx({ id: "3", description: "Mobile Data | MTN", category: "Shopping", categoryLocked: true }),
      tx({ id: "4", description: "Cash for market", category: "Other", manual: true }),
    ];
    const { transactions, changed } = refreshCategories(old, []);
    assert.equal(transactions[0].category, "Bank fees");
    assert.equal(transactions[1].internalTransfer, true);
    assert.equal(transactions[2].category, "Shopping");
    assert.equal(transactions[3].category, "Other");
    assert.equal(changed, 2);
  });
});



describe("transaction intelligence", () => {
  it("recognises transfer recipients and merchants while normalising volatile references", () => {
    const recipient = recogniseTransactionParty("Transfer to JANE DOE | GTBank | 12345678901");
    assert.equal(recipient?.kind, "recipient");
    assert.equal(recipient?.key, "jane doe");
    assert.equal(recipient?.name, "Jane Doe");
    assert.equal(recogniseTransactionParty("Transfer to POS Transfer - ADA LOVELACE - OPay | OPay | 123456789")?.key, "ada lovelace");
    const merchant = recogniseTransactionParty("POS purchase at Shoprite | REF 12345678901");
    assert.equal(merchant?.kind, "merchant");
    assert.equal(merchant?.key, "shoprite");
    assert.equal(
      normaliseTransactionDescription("POS purchase at Shoprite | REF 12345678901"),
      normaliseTransactionDescription("Card payment at SHOPRITE | REF 98765432109"),
    );
    assert.equal(similarityKey("Transfer to  ISAAC  ADEKANMI | United Bank For Africa | 1024085079"), "transfer to isaac adekanmi");
  });

  it("uses accepted personal rules for classification and groups similar transactions", () => {
    const rules = [{ id: "r1", pattern: "merchant shoprite", category: "Food & groceries", direction: "expense", createdAt: "2026-10-23" }];
    const first = tx({ id: "one", description: "POS purchase at Shoprite | REF 12345678901" });
    const second = tx({ id: "two", description: "Card payment at SHOPRITE | REF 98765432109" });
    const classification = classifyTransaction(first, rules);
    assert.equal(classification.category, "Food & groceries");
    assert.equal(classification.source, "custom-rule");
    assert.equal(classification.confidence, 0.99);
    const counts = getSimilarTransactionCounts([first, second]);
    assert.equal(counts.get("one"), 2);
    assert.equal(counts.get("two"), 2);
  });

  it("flags weak fallback categories for review", () => {
    const result = classifyTransaction(tx({ description: "Unrecognised statement narration" }));
    assert.equal(result.category, "Other");
    assert.equal(result.confidence < 0.5, true);
  });

  it("queues weak suggestions and leaves hand-picked transactions out of the queue", () => {
    const weak = tx({ id: "weak", description: "Unrecognised statement narration" });
    const locked = tx({ id: "locked", description: "Unrecognised statement narration", categoryLocked: true });
    const queue = getClassificationReviewQueue([weak, locked]);
    assert.deepEqual(queue.map(({ transaction }) => transaction.id), ["weak"]);
    assert.equal(queue[0].classification.confidence < 0.6, true);
  });

  it("learns from a rejected suggestion for later transactions to the same payee", () => {
    const rejected = tx({
      id: "corrected",
      description: "Mobile Data | 8140000000 | MTN",
      category: "Shopping",
      categoryLocked: true,
      rejectedSuggestion: "Airtime & data",
    });
    const history = buildClassificationHistory([rejected]);
    const learned = classifyTransaction(tx({
      id: "future",
      description: "Mobile Data | 8140000000 | MTN",
      category: "Airtime & data",
    }), [], history);
    assert.equal(learned.category, "Shopping");
    assert.equal(learned.source, "merchant-history");
    assert.match(learned.reason, /rejected Airtime & data/);
  });

  it("reclassifies a historical date window while protecting locked categories", () => {
    const inWindow = tx({ id: "in", date: "2026-02-01", description: "Mobile Data | 8140000000 | MTN", category: "Other" });
    const outOfWindow = tx({ id: "out", date: "2026-03-01", description: "Mobile Data | 8140000000 | MTN", category: "Other" });
    const locked = tx({ id: "locked", date: "2026-02-10", description: "Mobile Data | 8140000000 | MTN", category: "Shopping", categoryLocked: true });
    const result = reclassifyHistoricalTransactions([inWindow, outOfWindow, locked], [], buildClassificationHistory([]), {
      start: "2026-02-01",
      end: "2026-02-28",
    });
    assert.equal(result.eligible, 1);
    assert.equal(result.changed, 1);
    assert.equal(result.transactions[0].category, "Airtime & data");
    assert.equal(result.transactions[1].category, "Other");
    assert.equal(result.transactions[2].category, "Shopping");
  });

  it("detects regularly spaced transfer recipients without treating merchants or own transfers as recipients", () => {
    const recurring = [
      tx({ id: "r1", date: "2026-01-01", description: "Transfer to JANE DOE | GTBank | REF 111111", amount: 12000 }),
      tx({ id: "r2", date: "2026-02-01", description: "Transfer to Jane Doe | GTBank | REF 222222", amount: 15000 }),
      tx({ id: "r3", date: "2026-03-04", description: "Transfer to JANE DOE | GTBank | REF 333333", amount: 9000 }),
      tx({ id: "invalid-date", date: "2026-02-31", description: "Transfer to Jane Doe | GTBank | REF 353535", amount: 20000 }),
      tx({ id: "merchant", date: "2026-01-01", description: "Purchase at Netflix | REF 111111" }),
      tx({ id: "internal", date: "2026-04-04", description: "Transfer to Jane Doe | GTBank | REF 444444", internalTransfer: true }),
    ];
    const results = detectRecurringRecipients(recurring);
    assert.equal(results.length, 1);
    assert.equal(results[0].name.toLowerCase(), "jane doe");
    assert.equal(results[0].frequencyLabel, "Monthly");
    assert.equal(results[0].count, 3);
    assert.equal(results[0].nextExpectedDate, "2026-04-04");
  });

  it("matches potential duplicates using normalized merchant identity, not account references", () => {
    const result = buildImportPreview({
      imported: [tx({ id: "new", date: "2026-10-16", description: "Card payment at SHOPRITE | REF 98765432109", amount: 2500, source: "OPay" })],
      existing: [tx({ id: "old", date: "2026-10-16", description: "POS purchase at Shoprite | REF 12345678901", amount: 2500, source: "Access Bank" })],
      skipped: 0,
      mode: "full-history",
      month: "",
      customRange: { start: null, end: null },
      comparisonAvailable: true,
    });
    assert.equal(result.confirmedDuplicates, 0);
    assert.equal(result.potentialDuplicates, 1);
  });
});

describe("custom classification rules and confidence scoring", () => {
  it("supports exact, starts-with, merchant, and counterparty rule matches", () => {
    assert.equal(ruleMatches({ pattern: "Transfer to Jane Doe", matchType: "exact" }, tx({ description: "Transfer to Jane Doe | UBA | 123456789" })), true);
    assert.equal(ruleMatches({ pattern: "transfer to jane", matchType: "startsWith" }, tx({ description: "Transfer to Jane Doe | UBA | 123456789" })), true);
    assert.equal(ruleMatches({ pattern: "Shoprite", matchType: "merchant" }, tx({ description: "POS purchase at Shoprite | REF 123456789" })), true);
    assert.equal(ruleMatches({ pattern: "Jane", matchType: "counterparty" }, tx({ description: "Transfer from Jane Doe | UBA | 123456789", direction: "income" })), true);
  });

  it("scores classifications by evidence and learns from repeated hand-categorized history", () => {
    const rule = { id: "merchant-rule", pattern: "Shoprite", matchType: "merchant", category: "Food & groceries", createdAt: "2026-10-23" };
    const current = tx({ id: "current", description: "POS purchase at Shoprite | REF 7654321" });
    const ruled = classifyTransaction(current, [rule]);
    assert.equal(ruled.category, "Food & groceries");
    assert.equal(ruled.source, "custom-rule");
    assert.equal(ruled.confidence, 0.99);

    const history = buildClassificationHistory([
      tx({ id: "old-1", description: "POS purchase at Shoprite | REF 1111111", category: "Food & groceries", categoryLocked: true }),
      tx({ id: "old-2", description: "Card payment at Shoprite | REF 2222222", category: "Food & groceries", categoryLocked: true }),
    ]);
    const learned = classifyTransaction(current, [], history);
    assert.equal(learned.category, "Food & groceries");
    assert.equal(learned.source, "merchant-history");
    assert.ok(learned.confidence > 0.9);
    assert.match(learned.reason, /2 of 2/);
  });

  it("applies custom rules to future imports and preserves legacy rules in backups", () => {
    const custom = { id: "m1", pattern: "Shoprite", matchType: "merchant", category: "Food & groceries", createdAt: "2026-10-23" };
    const [classified] = classifyTransactions([tx({ description: "POS purchase at Shoprite | REF 1234567" })], [custom]);
    assert.equal(classified.category, "Food & groceries");
    const [legacy] = normaliseRules([{ id: "legacy", pattern: "shoprite", category: "Shopping", createdAt: "2026-10-19" }]);
    assert.equal(legacy.matchType, undefined);
    const [restored] = normaliseRules([custom]);
    assert.equal(restored.matchType, "merchant");
  });
});

describe("recipient profiles and transport fare ranges", () => {
  const profile = {
    id: "recipient:jane-doe",
    kind: "recipient",
    name: "Jane Doe",
    aliases: ["JANE A DOE", "Jane Doe - PalmPay"],
    category: "Rent & housing",
    note: "Landlord",
  };

  it("normalises, resolves, and groups statement aliases under one recipient profile", () => {
    const profiles = normaliseRecipientProfiles([profile, { ...profile, id: "duplicate", name: " " }, null]);
    assert.equal(profiles.length, 1);
    const first = resolveTransactionParty("Transfer to JANE A DOE | GTBank | REF 123456789", profiles);
    const second = resolveTransactionParty("Transfer to JANE DOE - PALMPAY | OPay | 765432109", profiles);
    assert.equal(first?.name, "Jane Doe");
    assert.equal(second?.key, first?.key);

    const directory = getRecipientDirectory([
      tx({ id: "j1", description: "Transfer to JANE A DOE | GTBank | 1", amount: 2000 }),
      tx({ id: "j2", description: "Transfer to Jane Doe - PalmPay | OPay | 2", amount: 3000 }),
    ], profiles);
    assert.equal(directory.length, 1);
    assert.equal(directory[0].transactions, 2);
    assert.equal(directory[0].sent, 5000);
  });

  it("uses a saved recipient category for aliases, without overriding hand-picked categories or explicit rules", () => {
    const aliasTransaction = tx({ id: "alias", description: "Transfer to JANE A DOE | GTBank | 1", category: "Transfers" });
    const locked = tx({ id: "locked-profile", description: "Transfer to JANE A DOE | GTBank | 2", category: "Health", categoryLocked: true });
    assert.equal(classifyTransaction(aliasTransaction, [], undefined, [profile]).category, "Rent & housing");
    assert.equal(classifyTransaction(locked, [], undefined, [profile]).category, "Health");
    const explicitRule = { id: "specific", pattern: "transfer to jane", category: "Business", createdAt: "" };
    assert.equal(classifyTransaction(aliasTransaction, [explicitRule], undefined, [profile]).category, "Business");
  });

  it("merges recurring recipients and recurring payments across aliases", () => {
    const paymentProfile = {
      id: "merchant:power",
      kind: "merchant",
      name: "PowerCo",
      aliases: ["Power Co Utilities"],
    };
    const transfers = [
      tx({ id: "r1", date: "2026-01-01", description: "Transfer to Jane Doe | GTBank | 1", amount: 12000 }),
      tx({ id: "r2", date: "2026-02-01", description: "Transfer to JANE A DOE | OPay | 2", amount: 13000 }),
      tx({ id: "r3", date: "2026-03-04", description: "Transfer to Jane Doe - PalmPay | UBA | 3", amount: 11000 }),
    ];
    const recipients = detectRecurringRecipients(transfers, [profile]);
    assert.equal(recipients.length, 1);
    assert.equal(recipients[0].name, "Jane Doe");
    assert.equal(recipients[0].count, 3);

    const bills = [
      tx({ id: "p1", date: "2026-01-01", description: "Payment at Power Co Utilities | 1", category: "Bills & utilities", amount: 9800 }),
      tx({ id: "p2", date: "2026-02-01", description: "Payment at PowerCo | 2", category: "Bills & utilities", amount: 10000 }),
      tx({ id: "p3", date: "2026-03-01", description: "Payment at Power Co Utilities | 3", category: "Bills & utilities", amount: 10200 }),
    ];
    const [recurring] = findRecurringPayments(bills, [paymentProfile]);
    assert.equal(recurring.name, "PowerCo");
    assert.equal(recurring.occurrences, 3);
    assert.equal(recurring.category, "Bills & utilities");
  });

  it("shows a robust typical fare band only after three named Transport payments", () => {
    const fares = [
      tx({ id: "f1", date: "2026-01-01", description: "Bolt ride", category: "Transport", amount: 1000 }),
      tx({ id: "f2", date: "2026-01-02", description: "Uber trip", category: "Transport", amount: 2000 }),
      tx({ id: "f3", date: "2026-01-03", description: "Bolt ride", category: "Transport", amount: 3000 }),
      tx({ id: "f4", date: "2026-01-04", description: "Bolt ride", category: "Transport", amount: 40000 }),
      tx({ id: "grocery", description: "Bolt ride", category: "Food & groceries", amount: 500 }),
      tx({ id: "internal-fare", description: "Bolt ride", category: "Transport", internalTransfer: true, amount: 500 }),
    ];
    const ranges = detectTypicalFareRanges(fares);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].name, "Bolt");
    assert.equal(ranges[0].count, 3);
    assert.equal(ranges[0].medianAmount, 3000);
    assert.ok(ranges[0].upperAmount < 40000);
  });
});

describe("periods and totals", () => {
  const now = new Date(2026, 9, 19);
  it("resolves calendar periods and equal-length previous windows", () => {
    assert.deepEqual(resolvePeriod("this-month", now), { start: "2026-10-01", end: "2026-10-19" });
    assert.deepEqual(resolvePeriod("last-month", now), { start: "2026-09-01", end: "2026-09-30" });
    assert.deepEqual(resolvePeriod("this-year", now), { start: "2026-01-01", end: "2026-10-19" });
    assert.deepEqual(resolvePeriod("custom", now, { start: "2026-05-10", end: "2026-02-01" }), { start: "2026-02-01", end: "2026-05-10" });
    assert.deepEqual(previousRange("last-month", resolvePeriod("last-month", now)), { start: "2026-08-01", end: "2026-08-30" });
    assert.deepEqual(previousRange("30d", resolvePeriod("30d", now)), { start: "2026-08-21", end: "2026-09-19" });
    assert.equal(previousRange("all", resolvePeriod("all", now)), null);
  });

  it("subtracts refunds from spending instead of counting them as income", () => {
    const totals = calculateTotals([
      tx({ direction: "income", category: "Income", amount: 10000 }),
      tx({ amount: 3000, category: "Shopping" }),
      tx({ direction: "income", category: "Refunds", amount: 500 }),
      tx({ amount: 99999, internalTransfer: true }),
    ]);
    assert.equal(totals.income, 10000);
    assert.equal(totals.expenses, 2500);
    assert.equal(totals.refunds, 500);
  });

  it("charts every month a long period covers, labelled with years", () => {
    const series = getMonthlySeries([tx({ date: "2025-11-03" }), tx({ date: "2026-02-10", amount: 50 })], { start: null, end: null });
    assert.deepEqual(series.map((month) => month.label), ["Nov 25", "Dec 25", "Jan 26", "Feb 26"]);
    assert.equal(series[3].expenses, 50);
  });
});

describe("analytics", () => {
  const history = [
    tx({ date: "2026-06-05", description: "Transfer to O.F MODUPE MULTICHOICE | OPay | 1", amount: 2500, category: "Bills & utilities" }),
    tx({ date: "2026-07-05", description: "Transfer to O.F MODUPE MULTICHOICE | OPay | 1", amount: 2500, category: "Bills & utilities" }),
    tx({ date: "2026-08-04", description: "Transfer to O.F MODUPE MULTICHOICE | OPay | 1", amount: 2600, category: "Bills & utilities" }),
    tx({ date: "2026-09-05", description: "Transfer to O.F MODUPE MULTICHOICE | OPay | 1", amount: 2500, category: "Bills & utilities" }),
    tx({ date: "2026-09-06", description: "USSD Charge", amount: 10, category: "Bank fees" }),
    tx({ date: "2026-09-07", description: "Stamp Duty", amount: 50, category: "Bank fees" }),
    tx({ date: "2026-09-07", description: "Betting | 1 | SPORTYBET", amount: 4000, category: "Betting" }),
    tx({ date: "2026-09-08", description: "Transfer from ACME | Bank | 1", amount: 20000, direction: "income", category: "Income" }),
  ];

  it("finds monthly recurring payments with their next expected date", () => {
    const [recurring] = findRecurringPayments(history);
    assert.equal(recurring.cadence, "monthly");
    assert.equal(recurring.name, "O.F Modupe Multichoice");
    assert.equal(recurring.occurrences, 4);
    assert.equal(recurring.typicalAmount, 2500);
    assert.equal(recurring.nextExpected > "2026-10-01", true);
  });

  it("summarises fees, payees, spending rhythm, and months", () => {
    assert.equal(getFeeSummary(history).total, 60);
    assert.equal(getTopCounterparties(history, "expense", 1)[0].amount, 10100);
    assert.equal(getTopCounterparties(history, "income", 1)[0].name, "Acme");
    const rhythm = getSpendingRhythm(history, "2026-09-01", "2026-09-30");
    assert.equal(rhythm.days, 30);
    const [september] = getMonthlyReport(history);
    assert.equal(september.month, "2026-09");
    assert.equal(september.spending, 6560);
    assert.equal(september.fees, 60);
    assert.equal(september.betting, 4000);
    assert.equal(september.net, 20000 - 6560);
  });

  it("tracks budgets, pace, and suggests a limit from recent months", () => {
    const status = getBudgetStatus(history, [{ category: "Betting", monthlyLimit: 5000 }, { category: "Bank fees", monthlyLimit: 50 }], "2026-09", new Date(2026, 8, 10));
    const fees = status.find((item) => item.category === "Bank fees");
    const betting = status.find((item) => item.category === "Betting");
    assert.equal(fees.status, "over");
    assert.equal(betting.spent, 4000);
    assert.equal(betting.projected, 12000);
    assert.equal(betting.status, "warning");
    assert.equal(suggestBudget(history, "Bills & utilities", 3, new Date(2026, 9, 1)), 2500);
  });
});

describe("storage and backups", () => {
  it("round-trips time, notes, manual and locked flags, and rejected suggestions in compact storage", () => {
    const original = [tx({ id: "m1", time: "09:15:00", note: "Shop generator", manual: true, categoryLocked: true, category: "Business", rejectedSuggestion: "Shopping" }), tx({ id: "p" })];
    const restored = parseStoredTransactions(serializeTransactions(original));
    assert.deepEqual(restored[0], original[0]);
    assert.deepEqual(restored[1], original[1]);
  });

  it("reads storage written by the previous version", () => {
    const legacy = JSON.stringify({
      format: "spendwise.transactions.compact.v1",
      sources: ["OPay Wallet"],
      categories: ["Income", "Food & groceries", "Transport", "Bills & utilities", "Shopping", "Transfers", "Betting", "Bank fees", "Health", "Entertainment", "Education", "Other"],
      records: [["id1", "2026-01-01", "OWealth Deposit", 5, 0, 5, 0, 1]],
    });
    const [transaction] = parseStoredTransactions(legacy);
    assert.equal(transaction.category, "Transfers");
    assert.equal(transaction.internalTransfer, true);
  });

  it("creates and restores full backups and rejects other files", () => {
    const data = {
      transactions: [tx({ id: "b1", note: "x" })],
      savingsGoals: [],
      savingsCircles: [],
      bets: [],
      rules: [{ id: "r", pattern: "abc", category: "Business", createdAt: "2026-10-19" }],
      budgets: [{ category: "Betting", monthlyLimit: 5000 }],
      recipientProfiles: [{ id: "recipient:a", kind: "recipient", name: "Ada", aliases: ["ADA O."], category: "Rent & housing", note: "Landlord" }],
    };
    const restored = readBackup(createBackup(data));
    assert.deepEqual(restored.transactions, data.transactions);
    assert.deepEqual(restored.rules, [{ ...data.rules[0], direction: undefined, markInternal: undefined }]);
    assert.deepEqual(restored.budgets, data.budgets);
    assert.deepEqual(restored.recipientProfiles, data.recipientProfiles);
    const legacyBackup = JSON.parse(createBackup(data));
    delete legacyBackup.recipientProfiles;
    assert.deepEqual(readBackup(JSON.stringify(legacyBackup)).recipientProfiles, []);
    assert.equal(readBackup("{\"format\":\"something-else\"}"), null);
    assert.equal(readBackup("not json"), null);
    assert.deepEqual(normaliseRules([{ id: "x", pattern: "  ", category: "Business" }]), []);
    assert.deepEqual(normaliseBudgets([{ category: "Nope", monthlyLimit: 5 }, { category: "Betting", monthlyLimit: -1 }]), []);
  });
});
