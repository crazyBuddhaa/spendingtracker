import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTransactionsCsv } from "./csv.ts";
import { applyCategoryRules, categorise, isOwnAccountTransfer, isWalletProductMovement, refreshCategories, ruleMatches, similarityKey } from "./categorise.ts";
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
import { createBackup, normaliseBudgets, normaliseRules, readBackup } from "./backup.ts";

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
  it("round-trips time, notes, manual and locked flags in compact storage", () => {
    const original = [tx({ id: "m1", time: "09:15:00", note: "Shop generator", manual: true, categoryLocked: true, category: "Business" }), tx({ id: "p" })];
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
    };
    const restored = readBackup(createBackup(data));
    assert.deepEqual(restored.transactions, data.transactions);
    assert.deepEqual(restored.rules, [{ ...data.rules[0], direction: undefined, markInternal: undefined }]);
    assert.deepEqual(restored.budgets, data.budgets);
    assert.equal(readBackup("{\"format\":\"something-else\"}"), null);
    assert.equal(readBackup("not json"), null);
    assert.deepEqual(normaliseRules([{ id: "x", pattern: "  ", category: "Business" }]), []);
    assert.deepEqual(normaliseBudgets([{ category: "Nope", monthlyLimit: 5 }, { category: "Betting", monthlyLimit: -1 }]), []);
  });
});
