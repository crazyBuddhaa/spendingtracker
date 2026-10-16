import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTransactionsCsv, transactionsToCsv } from "./csv.ts";
import { calculateTotals, getCategoryTotals } from "./insights.ts";

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
});
