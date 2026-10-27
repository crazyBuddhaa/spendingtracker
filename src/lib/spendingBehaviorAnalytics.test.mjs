import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getLifestyleInflationAnalysis,
  getPaydaySpendingAnalysis,
  getPossibleImpulseSpending,
  getSmallExpenseAccumulation,
  getSpendingContextAnalysis,
} from "./spendingBehaviorAnalytics.ts";

const tx = (overrides) => ({
  id: overrides.id,
  date: "2026-10-01",
  description: "Test purchase",
  amount: 100,
  direction: "expense",
  category: "Other",
  source: "Test",
  ...overrides,
});

describe("behavioral spending analytics", () => {
  it("tracks accumulated low-value expenses relative to the user's own transaction amounts", () => {
    const transactions = [10, 20, 30, 40, 100, 200, 300, 400].map((amount, index) =>
      tx({ id: `expense-${index}`, amount }));
    transactions.push(
      tx({ id: "income", direction: "income", amount: 50_000 }),
      tx({ id: "transfer", amount: 90_000, internalTransfer: true }),
    );

    const result = getSmallExpenseAccumulation(transactions);
    assert.equal(result.status, "ready");
    assert.equal(result.transactionCount, 8);
    assert.equal(result.threshold, 20);
    assert.equal(result.smallTransactionCount, 2);
    assert.equal(result.smallSpend, 30);
    assert.equal(result.shareOfSpending, 2.73);
    assert.equal(result.topCategories[0].category, "Other");
  });

  it("compares complete three-month windows and excludes partial-month and internal entries", () => {
    const transactions = [];
    for (const month of ["01", "02", "03"]) {
      transactions.push(
        tx({ id: `old-income-${month}`, date: `2026-${month}-01`, direction: "income", category: "Income", amount: 10_000 }),
        tx({ id: `old-expense-${month}`, date: `2026-${month}-10`, amount: 5_000 }),
      );
    }
    for (const month of ["04", "05", "06"]) {
      transactions.push(
        tx({ id: `new-income-${month}`, date: `2026-${month}-01`, direction: "income", category: "Income", amount: 12_000 }),
        tx({ id: `new-expense-${month}`, date: `2026-${month}-10`, amount: 8_000 }),
      );
    }
    transactions.push(
      tx({ id: "partial-income", date: "2026-07-02", direction: "income", category: "Income", amount: 100_000 }),
      tx({ id: "internal-income", date: "2026-06-15", direction: "income", category: "Income", amount: 100_000, internalTransfer: true }),
    );

    const result = getLifestyleInflationAnalysis(transactions, "2026-07-15");
    assert.equal(result.status, "signal");
    assert.equal(result.previousPeriod, "Jan–Mar 2026");
    assert.equal(result.recentPeriod, "Apr–Jun 2026");
    assert.equal(result.incomeChangePercent, 20);
    assert.equal(result.spendingChangePercent, 60);
    assert.equal(result.spendingShareChangePoints, 16.67);
  });

  it("marks lifestyle comparisons insufficient when monthly coverage is too sparse", () => {
    const result = getLifestyleInflationAnalysis([
      tx({ id: "income", date: "2026-06-01", direction: "income", category: "Income", amount: 10_000 }),
      tx({ id: "expense", date: "2026-06-02", amount: 5_000 }),
    ], "2026-07-15");
    assert.equal(result.status, "insufficient");
    assert.equal(result.incomeChangePercent, null);
  });

  it("describes recurring context on the highest-spend active days", () => {
    const amounts = [10, 20, 30, 40, 100, 200, 300, 400];
    const transactions = amounts.map((amount, index) => tx({
      id: `day-${index}`,
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      amount,
      category: index >= 5 ? "Shopping" : "Food & groceries",
      time: index >= 5 ? "19:00" : "10:00",
    }));
    const result = getSpendingContextAnalysis(transactions);
    assert.equal(result.status, "ready");
    assert.equal(result.activeDays, 8);
    assert.equal(result.highSpendThreshold, 200);
    assert.equal(result.highSpendDays, 3);
    assert.equal(result.commonHighSpendDayPart, "Evening");
    assert.equal(result.topCategory.category, "Shopping");
  });

  it("flags tightly timed discretionary clusters as possible, not definitive, impulse signals", () => {
    const result = getPossibleImpulseSpending([
      tx({ id: "shop-1", time: "09:00", amount: 100, category: "Shopping" }),
      tx({ id: "fun-1", time: "09:45", amount: 200, category: "Entertainment" }),
      tx({ id: "shop-2", time: "12:00", amount: 75, category: "Shopping" }),
      tx({ id: "shop-3", time: "13:15", amount: 50, category: "Shopping" }),
      tx({ id: "internal", time: "09:15", amount: 9_000, category: "Shopping", internalTransfer: true }),
    ]);

    assert.equal(result.status, "ready");
    assert.equal(result.totalDiscretionaryTransactions, 4);
    assert.equal(result.timedCoveragePercent, 100);
    assert.equal(result.clusterCount, 1);
    assert.equal(result.clusteredTransactionCount, 2);
    assert.equal(result.clusteredSpend, 300);
    assert.deepEqual(result.clusters[0].categories, ["Shopping", "Entertainment"]);
  });

  it("compares income-date-to-three-day spending with the remaining calendar days", () => {
    const transactions = [
      tx({ id: "income-1", date: "2026-01-01", direction: "income", category: "Income", amount: 50_000 }),
      tx({ id: "income-2", date: "2026-01-15", direction: "income", category: "Income", amount: 50_000 }),
      tx({ id: "payday-1", date: "2026-01-01", amount: 100 }),
      tx({ id: "payday-2", date: "2026-01-04", amount: 100 }),
      tx({ id: "payday-3", date: "2026-01-15", amount: 100 }),
      tx({ id: "payday-4", date: "2026-01-18", amount: 100 }),
    ];
    const start = Date.UTC(2026, 0, 1);
    for (let offset = 0; offset < 51; offset += 1) {
      const date = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
      if (["2026-01-01", "2026-01-04", "2026-01-15", "2026-01-18"].includes(date)) continue;
      transactions.push(tx({ id: `baseline-${date}`, date, amount: 10 }));
    }

    const result = getPaydaySpendingAnalysis(
      transactions,
      { start: "2026-01-01", end: "2026-02-20" },
    );
    assert.equal(result.status, "ready");
    assert.equal(result.windowDays, 3);
    assert.equal(result.paydayCyclesWithSpending, 2);
    assert.equal(result.paydaySpend, 440);
    assert.equal(result.paydayAveragePerDay, 55);
    assert.equal(result.baselineAveragePerDay, 10);
    assert.equal(result.differencePercent, 450);
  });
});
