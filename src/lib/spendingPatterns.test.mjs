import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSpendingPatternAnalytics } from "./spendingPatterns.ts";

const tx = (overrides) => ({
  id: overrides.id,
  date: "2026-10-01",
  description: "Test purchase",
  amount: 10,
  direction: "expense",
  category: "Other",
  source: "Test",
  ...overrides,
});

describe("spending pace, frequency, and peak periods", () => {
  it("calculates daily and weekly pace across quiet days and excludes income and own transfers", () => {
    const result = getSpendingPatternAnalytics([
      tx({ id: "a", date: "2026-10-01", amount: 100 }),
      tx({ id: "b", date: "2026-10-03", amount: 20 }),
      tx({ id: "c", date: "2026-10-08", amount: 30 }),
      tx({ id: "d", date: "2026-10-14", amount: 70 }),
      tx({ id: "own", date: "2026-10-10", amount: 999, internalTransfer: true }),
      tx({ id: "income", date: "2026-10-10", amount: 500, direction: "income" }),
      tx({ id: "bad-date", date: "2026-02-31", amount: 500 }),
    ], { start: "2026-10-01", end: "2026-10-14" });

    assert.equal(result.totalSpending, 220);
    assert.equal(result.transactionCount, 4);
    assert.equal(result.calendarDays, 14);
    assert.equal(result.averageDailySpending, 15.71);
    assert.equal(result.weeklyPace, 110);
    assert.equal(result.transactionsPerWeek, 2);
    assert.equal(result.dailyTrend.length, 14);
    assert.equal(result.dailyTrend.find((day) => day.date === "2026-10-02").amount, 0);
    assert.equal(result.weeklyTrend.length, 3);
    assert.equal(result.weeklyTrend[0].daysInPeriod, 4);
    assert.equal(result.weeklyTrend[2].daysInPeriod, 3);
  });

  it("detects peak day and week and compares the last seven days with the prior seven", () => {
    const result = getSpendingPatternAnalytics([
      tx({ id: "peak-day", date: "2026-10-01", amount: 100 }),
      tx({ id: "same-week", date: "2026-10-03", amount: 20 }),
      tx({ id: "recent-a", date: "2026-10-08", amount: 30 }),
      tx({ id: "recent-b", date: "2026-10-14", amount: 70 }),
    ], { start: "2026-10-01", end: "2026-10-14" });

    assert.equal(result.peakDay.date, "2026-10-01");
    assert.equal(result.peakDay.amount, 100);
    assert.equal(result.peakWeek.weekStart, "2026-09-28");
    assert.equal(result.peakWeek.amount, 120);
    assert.equal(result.peakFrequencyWeek.weekStart, "2026-09-28");
    assert.equal(result.peakFrequencyWeek.transactionCount, 2);
    assert.equal(result.velocityChangePercent, -16.67);
    assert.equal(result.frequencyChangePercent, 0);
  });

  it("finds the busiest week independently of the highest-spend week", () => {
    const result = getSpendingPatternAnalytics([
      tx({ id: "high-spend", date: "2026-10-01", amount: 500 }),
      tx({ id: "frequent-a", date: "2026-10-06", amount: 10 }),
      tx({ id: "frequent-b", date: "2026-10-07", amount: 10 }),
      tx({ id: "frequent-c", date: "2026-10-08", amount: 10 }),
    ], { start: "2026-10-01", end: "2026-10-14" });

    assert.equal(result.peakWeek.weekStart, "2026-09-28");
    assert.equal(result.peakFrequencyWeek.weekStart, "2026-10-05");
    assert.equal(result.peakFrequencyWeek.transactionCount, 3);
  });

  it("uses valid transaction dates when bounds are open and handles an empty period", () => {
    const inferred = getSpendingPatternAnalytics([
      tx({ id: "invalid", date: "not-a-date", amount: 20 }),
      tx({ id: "only", date: "2026-10-05", amount: 40 }),
    ]);
    assert.equal(inferred.start, "2026-10-05");
    assert.equal(inferred.end, "2026-10-05");
    assert.equal(inferred.calendarDays, 1);
    assert.equal(inferred.peakWeek.amount, 40);
    assert.equal(inferred.velocityChangePercent, null);

    const empty = getSpendingPatternAnalytics([], { start: "2026-10-01", end: "2026-10-14" });
    assert.equal(empty.calendarDays, 14);
    assert.equal(empty.transactionCount, 0);
    assert.equal(empty.weeklyPace, 0);
    assert.equal(empty.peakDay, null);
    assert.equal(empty.peakWeek, null);
  });
});
