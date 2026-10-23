import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatHour,
  formatMinuteOfDay,
  getSpendingTimeAnalytics,
  getSpendingTimeline,
} from "./spendingTimeAnalytics.ts";

const tx = (overrides) => ({
  id: overrides.id,
  date: "2026-10-19",
  description: "Transfer to Someone | Bank | REF 1",
  amount: 1000,
  direction: "expense",
  category: "Other",
  source: "Test",
  ...overrides,
});

describe("hourly spending and heatmap analytics", () => {
  it("groups only timed external spending by hour and weekday, and reports time coverage", () => {
    const result = getSpendingTimeAnalytics([
      tx({ id: "mon", date: "2026-10-19", time: "10:30:00", amount: 100 }),
      tx({ id: "tue", date: "2026-10-20", time: "10:10", amount: 300 }),
      tx({ id: "untimed", amount: 50 }),
      tx({ id: "invalid-date", date: "2026-02-31", time: "11:00", amount: 25 }),
      tx({ id: "internal", time: "10:00", amount: 9000, internalTransfer: true }),
      tx({ id: "income", time: "10:00", amount: 5000, direction: "income" }),
    ]);

    assert.equal(result.totalSpending, 475);
    assert.equal(result.totalTimedSpending, 400);
    assert.equal(result.spendingTransactions, 4);
    assert.equal(result.timedTransactions, 2);
    assert.equal(result.untimedTransactions, 2);
    assert.equal(result.timeCoverageByCount, 0.5);
    assert.equal(result.timeCoverageByAmount, 400 / 475);
    assert.deepEqual(result.byHour[10], { hour: 10, amount: 400, count: 2, averageAmount: 200 });
    assert.equal(result.heatmap.find((day) => day.day === "Mon").cells[10].amount, 100);
    assert.equal(result.heatmap.find((day) => day.day === "Tue").cells[10].amount, 300);
  });

  it("sorts the period timeline newest first, with time-less entries after timed entries on a date", () => {
    const timeline = getSpendingTimeline([
      tx({ id: "earlier", time: "09:00", description: "Transfer to Jane Doe | Bank | 1" }),
      tx({ id: "later", time: "17:10", description: "Transfer to Shoprite | Bank | 2" }),
      tx({ id: "no-time", description: "Cash market" }),
      tx({ id: "previous-day", date: "2026-10-18", time: "23:00", description: "Transfer to Driver | Bank | 3" }),
      tx({ id: "internal", time: "22:00", internalTransfer: true }),
      tx({ id: "income", time: "21:00", direction: "income" }),
    ], 3);

    assert.deepEqual(timeline.map((item) => item.transaction.id), ["later", "earlier", "no-time"]);
    assert.equal(timeline[0].name, "Shoprite");
    assert.equal(timeline[0].minuteOfDay, 17 * 60 + 10);
    assert.equal(timeline[2].minuteOfDay, null);
  });

  it("formats hours and minute-of-day values consistently", () => {
    assert.equal(formatHour(0), "00:00");
    assert.equal(formatHour(23), "23:00");
    assert.equal(formatHour(24), "00:00");
    assert.equal(formatMinuteOfDay(605), "10:05");
  });
});
