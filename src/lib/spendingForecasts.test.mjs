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

function dateFromOffset(startDate, offset) {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
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
    assert.equal(result.method, "run-rate");
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
    assert.equal(result.method, "insufficient-history");
  });

  it("uses weekday features to forecast a repeating weekly spending pattern", () => {
    const history = Array.from({ length: 56 }, (_, index) => {
      const date = dateFromOffset("2026-08-01", index);
      const isSunday = new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0;
      return tx({ id: `weekly-${index}`, date, amount: 100 + (isSunday ? 50 : 0) });
    });

    const result = getSpendingForecasts(history, new Date(2026, 8, 25));

    assert.equal(result.method, "linear-regression");
    assert.equal(result.trainingDays, 56);
    assert.equal(result.activeExpenseDays, 56);
    assert.equal(result.trendPerWeek, 0);
    assert.equal(result.monthToDateSpending, 2650);
    assert.equal(result.monthEndProjection, 3200);
    assert.equal(result.next30DayProjection, 3250);
  });

  it("estimates a linear daily-spend trend in weekly units", () => {
    const history = Array.from({ length: 56 }, (_, index) => tx({
      id: `trend-${index}`,
      date: dateFromOffset("2026-08-01", index),
      amount: 100 + index * 2,
    }));

    const result = getSpendingForecasts(history, new Date(2026, 8, 25));

    assert.equal(result.method, "linear-regression");
    assert.equal(result.trendPerWeek, 14);
    assert.ok(result.next30DayProjection > result.recentWindowSpending);
  });

  it("keeps a run-rate estimate when history is long enough but too sparse for regression", () => {
    const sparseHistory = Array.from({ length: 8 }, (_, index) => tx({
      id: `sparse-${index}`,
      date: dateFromOffset("2026-08-16", index * 4),
    }));

    const result = getSpendingForecasts(sparseHistory, new Date(2026, 8, 15));

    assert.equal(result.trainingDays, 31);
    assert.equal(result.activeExpenseDays, 8);
    assert.equal(result.method, "run-rate");
    assert.equal(result.trendPerWeek, null);
  });
});
