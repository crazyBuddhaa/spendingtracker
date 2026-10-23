import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSpendingForecasts } from "./spendingForecasts.ts";

function tx(overrides = {}) {
  return {
    id: `tx-${Math.random()}`,
    date: "2026-10-01",
    amount: 100,
    direction: "expense",
    category: "Food & groceries",
    internalTransfer: false,
    ...overrides,
  };
}

describe("spending run-rate forecasts", () => {
  it("projects month-end and next 30 days from recorded net expenses and recent history", () => {
    const dailyExpenses = Array.from({ length: 15 }, (_, index) => tx({
      id: `expense-${index}`,
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    }));
    const refund = tx({ id: "refund", date: "2026-10-10", amount: 500, direction: "income", category: "Refunds" });
    const internal = tx({ id: "internal", date: "2026-10-11", amount: 10000, internalTransfer: true });
    const future = tx({ id: "future", date: "2026-10-16", amount: 5000 });
    const result = getSpendingForecasts([...dailyExpenses, refund, internal, future], new Date(2026, 9, 15));

    assert.equal(result.monthToDateSpending, 1000);
    assert.equal(result.monthHistoryDays, 15);
    assert.equal(result.daysInMonth, 31);
    assert.equal(result.monthEndProjection, 2066.67);
    assert.equal(result.recentWindowDays, 15);
    assert.equal(result.recentWindowSpending, 1000);
    assert.equal(result.next30DayProjection, 2000);
  });

  it("waits for a minimum history span before showing projections", () => {
    const shortHistory = Array.from({ length: 5 }, (_, index) => tx({
      id: `expense-${index}`,
      date: `2026-10-0${index + 1}`,
    }));
    const result = getSpendingForecasts(shortHistory, new Date(2026, 9, 5));
    assert.equal(result.monthEndProjection, null);
    assert.equal(result.next30DayProjection, null);
    assert.equal(result.recentWindowDays, 5);
  });

  it("does not project a partial month with fewer than seven recorded days", () => {
    const partialHistory = Array.from({ length: 6 }, (_, index) => tx({
      id: `partial-${index}`,
      date: `2026-10-${String(index + 10).padStart(2, "0")}`,
    }));
    const result = getSpendingForecasts(partialHistory, new Date(2026, 9, 15));
    assert.equal(result.monthHistoryDays, 6);
    assert.equal(result.monthEndProjection, null);
  });

  it("returns no forecasts for an empty history", () => {
    const result = getSpendingForecasts([], new Date(2026, 9, 15));
    assert.equal(result.monthToDateSpending, 0);
    assert.equal(result.monthEndProjection, null);
    assert.equal(result.next30DayProjection, null);
    assert.equal(result.recentWindowDays, 0);
  });
});
