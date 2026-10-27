import test from "node:test";
import assert from "node:assert/strict";
import { advanceDueDate, getBillOccurrences, projectCashFlow } from "./recurringBills.ts";
import { convertAccountAmount, normaliseAccountPreferences, summariseAccounts } from "./accounts.ts";

const bill = (overrides = {}) => ({
  id: "rent", name: "Rent", amount: 1000, direction: "expense", category: "Rent & housing",
  account: "Bank", currency: "NGN", frequency: "monthly", nextDueDate: "2026-01-31", ...overrides,
});

test("monthly and yearly recurrence clamps short months without invalid dates", () => {
  assert.equal(advanceDueDate("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(advanceDueDate("2024-02-29", "yearly"), "2025-02-28");
  assert.equal(advanceDueDate("2026-01-01", "weekly"), "2026-01-08");
});

test("occurrences include repeated active bills and exclude paused bills", () => {
  const rows = getBillOccurrences([
    bill({ nextDueDate: "2026-01-01" }),
    bill({ id: "internet", name: "Internet", amount: 50, frequency: "weekly", nextDueDate: "2026-01-02" }),
    bill({ id: "paused", paused: true }),
  ], "2026-01-01", "2026-01-31");
  assert.equal(rows.filter((row) => row.bill.id === "rent").length, 1);
  assert.equal(rows.filter((row) => row.bill.id === "internet").length, 5);
  assert.equal(rows.some((row) => row.bill.id === "paused"), false);
});

test("cash-flow projection applies income and bills chronologically and skips unknown rates", () => {
  const result = projectCashFlow([
    bill({ nextDueDate: "2026-01-02" }),
    bill({ id: "salary", name: "Salary", amount: 2500, direction: "income", nextDueDate: "2026-01-03" }),
    bill({ id: "usd", currency: "USD", amount: 20, nextDueDate: "2026-01-04" }),
  ], "2026-01-01", 500, 5, (amount, currency) => currency === "USD" ? null : amount);
  assert.deepEqual(result.points.map((point) => point.balance), [500, -500, 2000, 2000, 2000]);
  assert.equal(result.totalIncome, 2500);
  assert.equal(result.totalExpenses, 1000);
  assert.equal(result.skipped[0].id, "usd");
});

test("account preferences preserve native amounts and convert only with a manual rate", () => {
  const preferences = normaliseAccountPreferences({
    accountCurrencies: { "USD card": "USD" }, displayCurrency: "NGN", showConverted: true, rates: { USD: 1500 },
  });
  const summaries = summariseAccounts([
    { id: "1", date: "2026-01-01", description: "Coffee", amount: 4, direction: "expense", category: "Food & groceries", source: "USD card" },
  ], preferences);
  assert.equal(summaries[0].expenses, 4);
  assert.equal(convertAccountAmount(4, "USD", preferences), 6000);
  assert.equal(convertAccountAmount(4, "GBP", preferences), null);
});
