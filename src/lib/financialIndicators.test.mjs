import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getBudgetDeviationAnalysis,
  getFinancialBehaviorIndicators,
  getFinancialIndicatorAnalysis,
  getFinancialLeakAnalysis,
  getIncomeSourceBreakdown,
} from "./financialIndicators.ts";

const tx = (overrides) => ({
  id: overrides.id,
  date: "2026-10-10",
  description: "Test transaction",
  amount: 100,
  direction: "expense",
  category: "Other",
  source: "Test account",
  ...overrides,
});

describe("financial indicators", () => {
  it("calculates selected-period cashflow after refunds and excludes internal transfers", () => {
    const result = getFinancialBehaviorIndicators([
      tx({ id: "income", direction: "income", category: "Income", amount: 1000 }),
      tx({ id: "expense", amount: 700 }),
      tx({ id: "refund", direction: "income", category: "Refunds", amount: 100 }),
      tx({ id: "own-transfer", direction: "income", amount: 800, internalTransfer: true }),
    ]);
    assert.deepEqual(result, {
      income: 1000,
      spending: 600,
      net: 400,
      savingsRate: 40,
      spendingToIncomePercent: 60,
      transactionCount: 2,
    });
  });

  it("classifies income with transparent rules and excludes refunds and own-account candidates", () => {
    const result = getIncomeSourceBreakdown([
      tx({ id: "salary", description: "ACME SALARY PAYMENT", direction: "income", category: "Income", amount: 5000 }),
      tx({ id: "client", description: "Invoice payment from Studio", direction: "income", category: "Business", amount: 2000 }),
      tx({ id: "interest", description: "Interest earned", direction: "income", category: "Income", amount: 300 }),
      tx({ id: "refund", direction: "income", category: "Refunds", amount: 100 }),
      tx({ id: "candidate", direction: "income", category: "Income", amount: 4000, ownAccountCandidate: true }),
    ]);
    assert.equal(result.total, 7300);
    assert.equal(result.count, 3);
    assert.equal(result.excludedOwnAccountCandidates, 1);
    assert.equal(result.groups.find((item) => item.type === "employment")?.confidence, "high");
    assert.equal(result.groups.find((item) => item.type === "business")?.confidence, "medium");
    assert.equal(result.groups.find((item) => item.type === "investment")?.amount, 300);
    assert.equal(result.byType.reduce((sum, item) => sum + item.amount, 0), 7300);
  });

  it("detects repeated lower-value outflows and recurring payments without calling them fraud", () => {
    const transactions = [
      ...[1, 2, 3, 4].map((day) => tx({
        id: `cafe-${day}`,
        date: `2026-10-${String(day).padStart(2, "0")}`,
        description: "Cafe North",
        amount: 100,
        category: "Food & groceries",
      })),
      ...[
        ["2026-08-01", "stream-1"],
        ["2026-09-01", "stream-2"],
        ["2026-10-01", "stream-3"],
      ].map(([date, id]) => tx({ id, date, description: "StreamCo", amount: 3000, category: "Entertainment" })),
      ...[500, 800, 1200, 1500].map((amount, index) => tx({
        id: `larger-${index}`,
        date: `2026-10-${String(index + 5).padStart(2, "0")}`,
        amount,
      })),
    ];
    const result = getFinancialLeakAnalysis(transactions, { start: "2026-10-01", end: "2026-10-31" });
    assert.equal(result.status, "ready");
    assert.equal(result.repeatedPayees[0].name, "Cafe North");
    assert.equal(result.repeatedPayees[0].count, 4);
    assert.equal(result.recurringPayments[0].name, "StreamCo");
    assert.equal(result.recurringMonthlyTotal, 3000);
  });

  it("distinguishes actual budget overspend from a pace-based projection", () => {
    const result = getBudgetDeviationAnalysis(
      [tx({ id: "rent", amount: 900, category: "Rent & housing" })],
      [{ category: "Rent & housing", monthlyLimit: 1000 }],
      "2026-10",
      new Date(2026, 9, 10),
    );
    assert.equal(result.budgetsChecked, 1);
    assert.equal(result.deviations[0].status, "warning");
    assert.equal(result.deviations[0].spent, 900);
    assert.equal(result.deviations[0].projected, 2790);
    assert.equal(result.deviations[0].projectedDifference, 1790);
    assert.match(result.deviations[0].explanation, /projected to finish/);
  });

  it("returns only explainable, data-backed insights for the selected month", () => {
    const result = getFinancialIndicatorAnalysis(
      [
        tx({ id: "salary", direction: "income", category: "Income", description: "Monthly salary from Acme", amount: 1000 }),
        tx({ id: "rent", category: "Rent & housing", amount: 1200 }),
      ],
      { start: "2026-10-01", end: "2026-10-31" },
      [{ category: "Rent & housing", monthlyLimit: 1000 }],
      [],
      new Date(2026, 9, 10),
    );
    assert.equal(result.month, "2026-10");
    assert.ok(result.insights.some((item) => item.id === "spending-above-income"));
    assert.ok(result.insights.some((item) => item.id === "budget-deviation"));
    assert.ok(result.insights.every((item) => item.evidence.length > 0));
  });
});
