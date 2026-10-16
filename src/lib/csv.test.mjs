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
