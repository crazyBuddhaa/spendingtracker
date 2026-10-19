import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTransactionsCsv, transactionsToCsv } from "./csv.ts";
import { calculateTotals, getCategoryTotals } from "./insights.ts";
import { findBetMatchCandidates } from "./bettingReconciliation.ts";
import { parsePdfPages } from "./pdfText.ts";
import { savedForGoal, savingsSummary } from "./savings.ts";
import { normaliseBets, parseSportyBetPage } from "./sportyBetImport.ts";
import { getBettingInsights } from "./bettingInsights.ts";
import { normaliseSavingsCircles, savingsCircleSummary } from "./savingsCircles.ts";
import { getTransferInsights } from "./transactionPatterns.ts";
import { parseStoredTransactions, serializeTransactions } from "./transactionStorage.ts";
import { findNewTransactions } from "./transactionDeduplication.ts";

describe("parseTransactionsCsv", () => {
  it("reads debit and credit columns and Nigerian day-first dates", () => {
    const result = parseTransactionsCsv(
      "Transaction Date,Description,Debit,Credit\n16/10/2026,Salary,,250000\n17/10/2026,Food market,12500,",
      "my-bank.csv",
    );

    assert.equal(result.transactions.length, 2);
    assert.deepEqual(result.transactions[0], {
      id: result.transactions[0].id,
      date: "2026-10-16",
      description: "Salary",
      amount: 250000,
      direction: "income",
      category: "Income",
      source: "my bank",
    });
    assert.equal(result.transactions[1].date, "2026-10-17");
    assert.equal(result.transactions[1].direction, "expense");
    assert.equal(result.transactions[1].amount, 12500);
    assert.equal(result.transactions[1].category, "Food & groceries");
  });

  it("handles quoted commas, quoted line breaks, and signed amount exports", () => {
    const result = parseTransactionsCsv(
      'Date,Details,Amount,Type\n2026-10-01,"Shoprite, Lekki",-8000,Debit\n2026-10-02,"Salary\nOctober",300000,Credit',
      "statement.csv",
    );

    assert.equal(result.transactions.length, 2);
    assert.equal(result.transactions[0].description, "Shoprite, Lekki");
    assert.equal(result.transactions[0].direction, "expense");
    assert.equal(result.transactions[1].description, "Salary\nOctober");
    assert.equal(result.transactions[1].direction, "income");
  });

  it("warns when a positive amount has no clear debit or credit marker", () => {
    const result = parseTransactionsCsv(
      "date,description,amount\n2026-10-10,Unknown merchant,1200",
      "statement.csv",
    );
    assert.equal(result.transactions[0].direction, "expense");
    assert.match(result.warnings[0], /treated as spending/);
  });

  it("reports files whose columns cannot be mapped", () => {
    const result = parseTransactionsCsv("foo,bar\nx,y", "broken.csv");
    assert.equal(result.transactions.length, 0);
    assert.match(result.warnings[0], /Couldn't identify/);
  });

  it("maps an Access Bank-style statement with a preamble and NGN amount headers", () => {
    const result = parseTransactionsCsv(
      "Access Bank statement\nAccount,Example account\nValue Date,Narration,Reference,Debit Amount (NGN),Credit Amount (NGN),Balance\n15/10/2026,POS purchase at Shoprite,REF-01,6500,,93500",
      "access_bank_statement.csv",
    );

    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].date, "2026-10-15");
    assert.equal(result.transactions[0].source, "Access Bank");
    assert.equal(result.transactions[0].direction, "expense");
    assert.equal(result.transactions[0].amount, 6500);
    assert.equal(result.skipped, 0);
  });

  it("maps an OPay-style single Amount and transaction type export", () => {
    const result = parseTransactionsCsv(
      "Date,Transaction Details,Amount (NGN),Transaction Type,Reference,Balance\n2026-10-10,Transfer to friend,\"-2,500.00\",Debit,REF-01,47500\n2026-10-11,Cash deposit,\"50,000.00\",Credit,REF-02,97500",
      "opay_wallet_history.csv",
    );

    assert.equal(result.transactions.length, 2);
    assert.equal(result.transactions[0].source, "OPay");
    assert.equal(result.transactions[0].direction, "expense");
    assert.equal(result.transactions[0].amount, 2500);
    assert.equal(result.transactions[1].direction, "income");
    assert.equal(result.transactions[1].amount, 50000);
  });

  it("maps a Moniepoint-style transaction table after statement metadata", () => {
    const result = parseTransactionsCsv(
      "Moniepoint business statement\nPeriod,October 2026\nTransaction Date,Transaction Narration,Dr Amount,Cr Amount,Account Balance,Reference\n16/10/2026,Transfer from customer,,120000,500000,MP-01",
      "moniepoint_extended_statement.csv",
    );

    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].source, "Moniepoint");
    assert.equal(result.transactions[0].date, "2026-10-16");
    assert.equal(result.transactions[0].direction, "income");
    assert.equal(result.transactions[0].amount, 120000);
    assert.equal(result.skipped, 0);
  });

  it("accepts named-month dates used in some statement exports", () => {
    const result = parseTransactionsCsv(
      "Date,Description,Debit,Credit\n16-Oct-2026,Market purchase,3500,",
      "statement.csv",
    );
    assert.equal(result.transactions[0].date, "2026-10-16");
  });

  it("classifies OPay betting and fees and flags exact same-name transfers", () => {
    const result = parseTransactionsCsv(
      "Date,Description,Debit,Credit\n2026-10-16,Betting | 123 | SPORTYBET,3500,\n2026-10-16,USSD Charge,50,\n2026-10-16,Transfer to Test User | Local Bank,1000,",
      "opay.xlsx",
      { source: "OPay Wallet", accountHolderName: "Test User" },
    );
    assert.equal(result.transactions[0].category, "Betting");
    assert.equal(result.transactions[1].category, "Bank fees");
    assert.equal(result.transactions[2].category, "Transfers");
    assert.equal(result.transactions[2].ownAccountCandidate, true);
    assert.equal(result.transactions[2].internalTransfer, undefined);
  });
});

describe("insights and export", () => {
  it("calculates income, outgoing, savings rate, and expense categories", () => {
    const transactions = parseTransactionsCsv(
      "date,description,debit,credit\n2026-10-01,Salary,,100000\n2026-10-02,Food market,20000,",
      "bank.csv",
    ).transactions;
    assert.deepEqual(calculateTotals(transactions), {
      income: 100000,
      expenses: 20000,
      net: 80000,
      savingsRate: 80,
      transactionCount: 2,
      refunds: 0,
    });
    assert.equal(getCategoryTotals(transactions)[0].category, "Food & groceries");
    assert.equal(getCategoryTotals(transactions)[0].share, 100);
  });

  it("quotes transaction descriptions in CSV exports", () => {
    const transactions = parseTransactionsCsv(
      'date,description,debit,credit\n2026-10-01,"Market, Lagos",1200,',
      "bank.csv",
    ).transactions;
    assert.match(transactionsToCsv(transactions), /"Market, Lagos"/);
  });

  it("excludes confirmed internal transfers but keeps unconfirmed name matches in cash flow", () => {
    const transactions = parseTransactionsCsv(
      "date,description,debit,credit\n2026-10-01,Salary,,100000\n2026-10-02,Transfer to Test User | bank,12000,\n2026-10-03,OWealth Deposit,4000,",
      "opay.csv",
      { accountHolderName: "Test User" },
    ).transactions;
    transactions[2].internalTransfer = true;
    assert.deepEqual(calculateTotals(transactions), {
      income: 100000,
      expenses: 12000,
      net: 88000,
      savingsRate: 88,
      transactionCount: 2,
      refunds: 0,
    });
    assert.equal(getCategoryTotals(transactions).find((item) => item.category === "Transfers")?.amount, 12000);
  });
});

describe("transaction storage and review helpers", () => {
  it("keeps identical repeated payments distinct and deduplicates re-imports by multiplicity", () => {
    const imported = parseTransactionsCsv(
      "date,description,debit,credit\n2026-10-01,Same merchant,500,\n2026-10-01,Same merchant,500,\n2026-10-01,Same merchant,500,",
      "bank.csv",
    ).transactions;
    assert.equal(new Set(imported.map((item) => item.id)).size, 3);
    const legacyExisting = [{ ...imported[0], id: "legacy-id" }];
    const added = findNewTransactions(legacyExisting, imported);
    assert.equal(added.length, 2);
    assert.equal(findNewTransactions([...legacyExisting, ...added], imported).length, 0);
  });

  it("round-trips compact local transaction storage and review flags", () => {
    const transactions = parseTransactionsCsv(
      "date,description,debit,credit\n2026-10-01,Transfer to Test User | bank,12000,",
      "opay.csv",
      { source: "OPay Wallet", accountHolderName: "Test User" },
    ).transactions;
    transactions[0].ownAccountCandidate = true;
    transactions[0].internalTransfer = true;
    const serialized = serializeTransactions(transactions);
    assert.deepEqual(parseStoredTransactions(serialized), transactions);
    assert.equal(parseStoredTransactions(JSON.stringify(transactions)).length, 1);
  });

  it("summarizes repeated counterparties and same-name review candidates", () => {
    const transactions = parseTransactionsCsv(
      "date,description,debit,credit\n2026-10-01,Transfer to Alpha Store | bank,1000,\n2026-10-02,Transfer to Alpha Store | bank,2000,\n2026-10-03,Transfer from Alpha Store | bank,,500\n2026-10-04,Transfer to Test User | bank,4000,",
      "opay.csv",
      { accountHolderName: "Test User" },
    ).transactions;
    const insights = getTransferInsights(transactions);
    assert.equal(insights.ownAccountCandidateCount, 1);
    assert.equal(insights.ownAccountSent, 4000);
    assert.equal(insights.repeatedCounterparties[0].name, "Alpha Store");
    assert.equal(insights.repeatedCounterparties[0].count, 3);
    assert.equal(insights.repeatedCounterparties[0].sent, 3000);
    assert.equal(insights.repeatedCounterparties[0].received, 500);
  });

  it("suggests only unique same-date bookmaker stake matches", () => {
    const transaction = parseTransactionsCsv(
      "date,description,debit,credit\n2026-10-01,Betting | REF | SPORTYBET,2500,",
      "opay.csv",
    ).transactions[0];
    const bet = {
      id: "bet-1",
      date: "2026-10-01",
      category: "Football",
      betType: "Single",
      status: "lost",
      stake: 2500,
      returnAmount: 0,
      events: ["Example match"],
      hiddenEvents: 0,
      source: "SportyBet",
    };
    assert.equal(findBetMatchCandidates([transaction], [bet]).length, 1);
    assert.equal(findBetMatchCandidates([transaction, { ...transaction, id: "duplicate" }], [bet]).length, 0);
  });
});

describe("statement file imports", () => {
  it("maps positioned PDF table columns into transactions", () => {
    const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
    const result = parsePdfPages([[
      item("Date", 20, 700),
      item("Narration", 100, 700),
      item("Debit", 350, 700),
      item("Credit", 445, 700),
      item("16/10/2026", 20, 680),
      item("POS purchase at Shoprite", 100, 680),
      item("1,250.00", 350, 680),
    ]], "access_bank.pdf");

    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].date, "2026-10-16");
    assert.equal(result.transactions[0].direction, "expense");
    assert.equal(result.transactions[0].amount, 1250);
    assert.equal(result.transactions[0].category, "Food & groceries");
  });

  it("explains when a PDF has no selectable text", () => {
    const result = parsePdfPages([[]], "scanned.pdf");
    assert.equal(result.transactions.length, 0);
    assert.match(result.warnings[0], /no selectable text/);
  });
});

describe("savings goals", () => {
  const goals = [
    {
      id: "goal-1",
      name: "Emergency fund",
      targetAmount: 100000,
      createdAt: "2026-10-01",
      contributions: [
        { id: "c1", date: "2026-10-01", amount: 20000 },
        { id: "c2", date: "2026-10-16", amount: 5000 },
      ],
    },
  ];

  it("totals contributions and calculates overall goal progress", () => {
    assert.equal(savedForGoal(goals[0]), 25000);
    assert.deepEqual(savingsSummary(goals), {
      saved: 25000,
      target: 100000,
      remaining: 75000,
      progress: 0.25,
    });
  });
});

describe("SportyBet page imports", () => {
  it("extracts bet history from a saved MHTML page", () => {
    const mhtml = [
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="snap"',
      '',
      '--snap',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<html><div data-op="bet-history-card-261017123456ord123">',
      '<span>17</span><span>Oct</span><span>Multiple</span><span>Won</span>',
      '<div>Total Stake(NGN)</div><div>100.00</div>',
      '<div>Total Return</div><div>250.00</div>',
      '<li>Team A v Team B</li><div>...(and 2 other matches)</div><div>Remix Bet</div></div></html>',
      '--snap--',
    ].join("\r\n");
    const result = parseSportyBetPage(mhtml);

    assert.equal(result.bets.length, 1);
    assert.equal(result.bets[0].date, "2026-10-17");
    assert.equal(result.bets[0].status, "won");
    assert.equal(result.bets[0].stake, 100);
    assert.equal(result.bets[0].returnAmount, 250);
    assert.deepEqual(result.bets[0].events, ["Team A v Team B"]);
    assert.equal(result.bets[0].hiddenEvents, 2);
    assert.equal(result.bets[0].category, "Unclassified");
    assert.deepEqual(result.warnings, []);
  });

  it("sanitises saved betting records and excludes invalid rows", () => {
    const bets = normaliseBets([
      {
        id: "valid",
        date: "2026-10-17",
        category: "Football",
        betType: "Multiple",
        status: "won",
        stake: 100,
        returnAmount: 250,
        events: ["Team A v Team B"],
        hiddenEvents: 0,
        source: "SportyBet",
      },
      { id: "invalid", stake: -100 },
    ]);
    assert.equal(bets.length, 1);
    assert.equal(bets[0].category, "Football");
  });
});

describe("betting insights", () => {
  const bets = [
    { id: "1", date: "2026-10-01", category: "Football", betType: "Multiple", status: "won", stake: 100, returnAmount: 250, events: ["A v B"], hiddenEvents: 2, source: "SportyBet" },
    { id: "2", date: "2026-10-01", category: "Football", betType: "Single", status: "lost", stake: 50, returnAmount: 0, events: ["C v D"], hiddenEvents: 0, source: "Manual entry" },
    { id: "3", date: "2026-10-02", category: "Tennis", betType: "Single", status: "open", stake: 25, returnAmount: 0, events: ["E v F"], hiddenEvents: 0, source: "SportyBet" },
    { id: "4", date: "2026-11-01", category: "Unclassified", betType: "Other", status: "void", stake: 20, returnAmount: 20, events: [], hiddenEvents: 0, source: "SportyBet" },
    { id: "5", date: "2026-11-02", category: "Unclassified", betType: "Other", status: "other", stake: 10, returnAmount: 0, events: [], hiddenEvents: 0, source: "Manual entry" },
  ];

  it("separates resolved performance, decisive win rate, and open exposure", () => {
    const result = getBettingInsights(bets);
    assert.equal(result.betCount, 5);
    assert.equal(result.totalStaked, 205);
    assert.equal(result.totalReturned, 270);
    assert.equal(result.settledCount, 3);
    assert.equal(result.settledStake, 170);
    assert.equal(result.settledReturn, 270);
    assert.equal(result.settledNet, 100);
    assert.equal(result.roi, (100 / 170) * 100);
    assert.equal(result.winRate, 50);
    assert.equal(result.openCount, 1);
    assert.equal(result.openStake, 25);
    assert.equal(result.otherCount, 1);
    assert.deepEqual(result.outcomeCounts, { won: 1, lost: 1, open: 1, void: 1, "cashed-out": 0, other: 1 });
  });

  it("calculates stake, net distribution, active days, and event coverage", () => {
    const result = getBettingInsights(bets);
    assert.equal(result.averageStake, 41);
    assert.equal(result.medianStake, 25);
    assert.equal(result.averageSettledNet, 100 / 3);
    assert.equal(result.settledReturnRate, (270 / 170) * 100);
    assert.equal(result.positiveSettledCount, 1);
    assert.equal(result.negativeSettledCount, 1);
    assert.equal(result.evenSettledCount, 1);
    assert.equal(result.activeDays, 4);
    assert.equal(result.capturedEvents, 3);
    assert.equal(result.hiddenEvents, 2);
    assert.equal(result.averageEventsPerBet, 1);
  });

  it("groups performance by category, source, date, and month", () => {
    const result = getBettingInsights(bets);
    assert.equal(result.byCategory.find((group) => group.label === "Football")?.betCount, 2);
    assert.equal(result.byCategory.find((group) => group.label === "Football")?.net, 100);
    assert.equal(result.bySource.find((group) => group.label === "Manual entry")?.betCount, 2);
    assert.deepEqual(result.byDay.map((group) => group.label), ["2026-10-01", "2026-10-02", "2026-11-01", "2026-11-02"]);
    assert.deepEqual(result.byMonth.map((group) => group.label), ["2026-10", "2026-11"]);
    assert.equal(result.byMonth[0].net, 100);
    assert.equal(result.byMonth[1].net, 0);
  });

  it("returns null for rate metrics when there is no denominator", () => {
    const result = getBettingInsights([]);
    assert.equal(result.roi, null);
    assert.equal(result.winRate, null);
    assert.equal(result.averageStake, null);
    assert.equal(result.medianStake, null);
    assert.equal(result.bestBet, null);
    assert.equal(result.lowestNetBet, null);
  });
});

describe("offline savings circles", () => {
  const circle = {
    id: "circle-1",
    name: "Ajo group",
    contributionAmount: 5000,
    intervalDays: 10,
    memberCount: 14,
    myPosition: 9,
    currentTurn: 14,
    myPayoutReceived: true,
    currentTurnDate: null,
    entries: [
      { id: "entry-1", date: "2026-10-01", kind: "contribution", amount: 5000, turn: 14 },
      { id: "entry-2", date: "2026-09-11", kind: "payout", amount: 70000, turn: 9 },
    ],
  };

  it("calculates pool payout, rotation length, and turns until the next personal payout", () => {
    const summary = savingsCircleSummary(circle);
    assert.equal(summary.payoutAmount, 70000);
    assert.equal(summary.cycleDays, 140);
    assert.equal(summary.turnsUntilNextPayout, 9);
    assert.equal(summary.daysUntilNextPayout, 90);
    assert.equal(summary.expectedPayoutDate, null);
  });

  it("uses the optional current-turn date to estimate the next collection date", () => {
    const summary = savingsCircleSummary({ ...circle, currentTurnDate: "2026-10-18" });
    assert.equal(summary.expectedPayoutDate, "2027-01-16");
  });

  it("starts a new rotation after turn 14 and accounts for an already received payout", () => {
    const nextCycle = savingsCircleSummary({ ...circle, currentTurn: 9 });
    assert.equal(nextCycle.turnsUntilNextPayout, 14);
    const notYetReceived = savingsCircleSummary({ ...circle, currentTurn: 9, myPayoutReceived: false });
    assert.equal(notYetReceived.turnsUntilNextPayout, 0);
  });

  it("normalises circle history and drops invalid entries or circle definitions", () => {
    const result = normaliseSavingsCircles([
      circle,
      { ...circle, id: "bad", currentTurn: 15 },
      { ...circle, id: "bad-entry", entries: [{ ...circle.entries[0], amount: -5 }] },
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].entries.length, 2);
    assert.equal(result[1].entries.length, 0);
  });
});
