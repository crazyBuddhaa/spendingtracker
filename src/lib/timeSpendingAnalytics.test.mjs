import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getDateRangeComparison,
  getDefaultDateRangeComparison,
  getIncomeSpendingTimeline,
  getSpendingSessionAnalytics,
  getTimePeriodPatterns,
  getTimeToFirstDiscretionaryPurchase,
} from "./timeSpendingAnalytics.ts";

const tx = (overrides) => ({
  id: overrides.id,
  date: "2026-10-19",
  description: "Test purchase",
  amount: 100,
  direction: "expense",
  category: "Shopping",
  source: "Test",
  ...overrides,
});

describe("cashflow and time-based spending patterns", () => {
  it("builds an income-to-spending timeline and excludes internal transfers", () => {
    const entries = getIncomeSpendingTimeline([
      tx({ id: "spend", date: "2026-10-20", time: "10:00", amount: 50, category: "Food & groceries" }),
      tx({ id: "salary", date: "2026-10-20", time: "09:00", amount: 5000, direction: "income", description: "Salary | Employer" }),
      tx({ id: "refund", date: "2026-10-19", amount: 20, direction: "income", category: "Refunds" }),
      tx({ id: "own", date: "2026-10-20", amount: 9000, internalTransfer: true }),
      tx({ id: "invalid", date: "2026-02-31", amount: 10 }),
    ]);

    assert.deepEqual(entries.map((entry) => entry.transaction.id), ["spend", "salary", "refund"]);
    assert.equal(entries[1].kind, "income");
    assert.equal(entries[2].kind, "refund");
    assert.equal(entries[1].name, "Salary");
  });

  it("measures the first categorized discretionary purchase between income dates", () => {
    const result = getTimeToFirstDiscretionaryPurchase([
      tx({ id: "income-1", date: "2026-10-01", time: "08:00", amount: 5000, direction: "income", category: "Income" }),
      tx({ id: "before-income", date: "2026-10-01", time: "07:45", amount: 40, category: "Shopping" }),
      tx({ id: "same-day", date: "2026-10-01", time: "10:00", amount: 80, category: "Entertainment" }),
      tx({ id: "next-day", date: "2026-10-02", amount: 30, category: "Shopping" }),
      tx({ id: "income-2", date: "2026-10-10", amount: 6000, direction: "income", category: "Income" }),
      tx({ id: "ambiguous-same-day", date: "2026-10-10", amount: 20, category: "Shopping" }),
      tx({ id: "after-income-2", date: "2026-10-11", amount: 60, category: "Betting" }),
      tx({ id: "refund", date: "2026-10-12", amount: 500, direction: "income", category: "Refunds" }),
      tx({ id: "own-income", date: "2026-10-13", amount: 500, direction: "income", internalTransfer: true }),
      tx({ id: "necessity", date: "2026-10-14", amount: 300, category: "Bills & utilities" }),
    ]);

    assert.equal(result.incomeDates, 2);
    assert.equal(result.matchedIncomeDates, 2);
    assert.equal(result.medianCalendarDays, 0.5);
    assert.equal(result.timedSameDayPurchases, 1);
    assert.equal(result.medianSameDayMinutes, 120);
    assert.deepEqual(result.matches.map((match) => match.purchaseDate), ["2026-10-11", "2026-10-01"]);
    assert.equal(result.matches[1].purchaseCategory, "Entertainment");
  });

  it("groups same-day timed expenses into sessions separated by at most one hour", () => {
    const result = getSpendingSessionAnalytics([
      tx({ id: "first", date: "2026-10-19", time: "08:00", amount: 100 }),
      tx({ id: "second", date: "2026-10-19", time: "08:30", amount: 50, category: "Food & groceries" }),
      tx({ id: "later", date: "2026-10-19", time: "10:00", amount: 300 }),
      tx({ id: "other-day", date: "2026-10-20", time: "08:30", amount: 600 }),
      tx({ id: "untimed", date: "2026-10-19", amount: 700 }),
      tx({ id: "internal", date: "2026-10-19", time: "08:15", amount: 9000, internalTransfer: true }),
    ]);

    assert.equal(result.timedTransactions, 4);
    assert.equal(result.sessionCount, 1);
    assert.equal(result.groupedTransactionCount, 2);
    assert.equal(result.averageSessionAmount, 150);
    assert.equal(result.largestSessions[0].startMinute, 8 * 60);
    assert.equal(result.largestSessions[0].endMinute, 8 * 60 + 30);
  });

  it("compares dayparts and normalizes weekday/weekend spending by calendar days", () => {
    const result = getTimePeriodPatterns([
      tx({ id: "morning", date: "2026-10-19", time: "08:30", amount: 100 }),
      tx({ id: "evening", date: "2026-10-24", time: "18:00", amount: 200 }),
      tx({ id: "overnight", date: "2026-10-25", time: "23:00", amount: 50 }),
      tx({ id: "untimed-weekday", date: "2026-10-20", amount: 300, time: undefined }),
      tx({ id: "income", date: "2026-10-21", amount: 9000, direction: "income", time: "09:00" }),
    ], { start: "2026-10-19", end: "2026-10-25" });

    assert.equal(result.timedTransactions, 3);
    assert.equal(result.untimedTransactions, 1);
    assert.equal(result.byDayPart.find((part) => part.key === "morning").amount, 100);
    assert.equal(result.byDayPart.find((part) => part.key === "evening").amount, 200);
    assert.equal(result.byDayPart.find((part) => part.key === "overnight").amount, 50);
    assert.equal(result.weekday.days, 5);
    assert.equal(result.weekend.days, 2);
    assert.equal(result.weekday.amount, 400);
    assert.equal(result.weekend.amount, 250);
    assert.equal(result.weekday.averagePerDay, 80);
    assert.equal(result.weekend.averagePerDay, 125);
    assert.equal(result.weekendVsWeekdayAveragePercent, 56.25);
  });

  it("summarizes two selected periods with normalized spending and time-based metrics", () => {
    const transactions = [
      tx({ id: "salary", date: "2026-10-01", time: "09:00", amount: 1000, direction: "income", category: "Income" }),
      tx({ id: "morning", date: "2026-10-01", time: "10:00", amount: 100 }),
      tx({ id: "evening-1", date: "2026-10-02", time: "18:00", amount: 50 }),
      tx({ id: "evening-2", date: "2026-10-02", time: "18:45", amount: 25 }),
      tx({ id: "weekend", date: "2026-10-03", time: "13:00", amount: 30, category: "Transport" }),
      tx({ id: "untimed", date: "2026-10-05", amount: 40, category: "Food & groceries", time: undefined }),
      tx({ id: "refund", date: "2026-10-04", amount: 20, direction: "income", category: "Refunds" }),
      tx({ id: "internal", date: "2026-10-02", time: "12:00", amount: 5000, internalTransfer: true }),
      tx({ id: "later", date: "2026-10-10", amount: 200, category: "Bills & utilities" }),
    ];

    const periodA = getDateRangeComparison(transactions, { start: "2026-10-01", end: "2026-10-07" });
    const periodB = getDateRangeComparison(transactions, { start: "2026-10-08", end: "2026-10-14" });

    assert.ok(periodA);
    assert.ok(periodB);
    assert.equal(periodA.calendarDays, 7);
    assert.equal(periodA.income, 1000);
    assert.equal(periodA.spending, 225);
    assert.equal(periodA.netCashflow, 775);
    assert.equal(periodA.expenseTransactions, 5);
    assert.equal(periodA.expensesPerWeek, 5);
    assert.equal(periodA.timedExpenseCoverage, 0.8);
    assert.equal(periodA.dayParts.find((part) => part.key === "morning").amount, 100);
    assert.equal(periodA.dayParts.find((part) => part.key === "evening").averagePerDay, 10.71);
    assert.equal(periodA.weekdayAveragePerDay, 43);
    assert.equal(periodA.weekendAveragePerDay, 15);
    assert.equal(periodA.sessionsPerWeek, 1);
    assert.equal(periodA.averageSessionAmount, 75);
    assert.equal(periodA.matchedIncomeDates, 1);
    assert.equal(periodA.discretionaryPurchaseRate, 1);
    assert.equal(periodA.medianDaysToFirstDiscretionaryPurchase, 0);
    assert.equal(periodB.spending, 200);
    assert.equal(periodB.expenseTransactions, 1);
    assert.equal(periodB.timedExpenseCoverage, 0);
  });

  it("defaults to the selected range and the equally long period before it", () => {
    const transactions = [
      tx({ id: "first", date: "2026-10-01" }),
      tx({ id: "last", date: "2026-10-07" }),
    ];
    assert.deepEqual(
      getDefaultDateRangeComparison({ start: "2026-10-01", end: "2026-10-07" }, transactions),
      {
        periodA: { start: "2026-10-01", end: "2026-10-07" },
        periodB: { start: "2026-09-24", end: "2026-09-30" },
      },
    );
    assert.equal(
      getDateRangeComparison(transactions, { start: "2026-10-08", end: "2026-10-01" }),
      null,
    );
  });
});
