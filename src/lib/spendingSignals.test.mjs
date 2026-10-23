import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSpendingAnomalies, getUnusualSpendingTimes } from "./spendingSignals.ts";

function tx(overrides = {}) {
  return {
    id: `tx-${Math.random()}`,
    date: "2026-10-01",
    time: "08:30:00",
    description: "Market purchase | Bank",
    amount: 100,
    direction: "expense",
    category: "Food & groceries",
    internalTransfer: false,
    ...overrides,
  };
}

describe("personal spending signals", () => {
  it("flags only time windows that are rare in a sufficient personal history", () => {
    const history = Array.from({ length: 20 }, (_, index) => tx({
      id: `history-${index}`,
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      time: `08:${String(index % 60).padStart(2, "0")}:00`,
    }));
    const unusual = tx({ id: "late", date: "2026-10-01", time: "23:15:00", amount: 4000 });
    const ordinary = tx({ id: "usual", date: "2026-10-01", time: "08:50:00" });
    const result = getUnusualSpendingTimes([unusual, ordinary], [...history, unusual, ordinary]);

    assert.equal(result.unusualCount, 1);
    assert.equal(result.eligibleTransactions, 2);
    assert.equal(result.items[0].transactionId, "late");
    assert.equal(result.items[0].windowStartHour, 21);
    assert.equal(result.items[0].priorTimedTransactions, 20);
    assert.equal(result.items[0].windowTransactionCount, 0);
  });

  it("does not call a time unusual without the minimum history or for internal transfers", () => {
    const history = Array.from({ length: 19 }, (_, index) => tx({
      id: `history-${index}`,
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    }));
    const late = tx({ id: "late", date: "2026-10-01", time: "23:15:00" });
    const internal = tx({ id: "internal", date: "2026-10-02", time: "23:15:00", internalTransfer: true });
    const result = getUnusualSpendingTimes([late, internal], [...history, late, internal]);

    assert.equal(result.unusualCount, 0);
    assert.equal(result.eligibleTransactions, 0);
  });

  it("flags a large purchase against five or more earlier same-category expenses", () => {
    const history = [100, 110, 90, 105, 95].map((amount, index) => tx({
      id: `prior-${index}`,
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      amount,
    }));
    const outlier = tx({ id: "outlier", date: "2026-10-01", amount: 250 });
    const ordinary = tx({ id: "ordinary", date: "2026-10-02", amount: 150 });
    const lowHistory = tx({ id: "few-comparisons", date: "2026-10-03", category: "Healthcare", amount: 5000 });
    const result = getSpendingAnomalies([outlier, ordinary, lowHistory], [...history, outlier, ordinary, lowHistory]);

    assert.equal(result.anomalyCount, 1);
    assert.equal(result.eligibleTransactions, 2);
    assert.equal(result.items[0].transactionId, "outlier");
    assert.equal(result.items[0].categoryMedian, 100);
    assert.equal(result.items[0].threshold, 200);
    assert.equal(result.items[0].priorCategoryTransactions, 5);
  });

  it("uses earlier dates only and excludes internal transfers from the category baseline", () => {
    const futureAndInternal = [
      ...[1, 2, 3, 4].map((index) => tx({
        id: `prior-${index}`,
        date: `2026-09-0${index}`,
        amount: 100,
      })),
      tx({ id: "internal-prior", date: "2026-09-05", amount: 100000, internalTransfer: true }),
    ];
    const target = tx({ id: "target", date: "2026-09-06", amount: 500 });
    const result = getSpendingAnomalies([target], [...futureAndInternal, target]);
    assert.equal(result.eligibleTransactions, 0);
    assert.equal(result.anomalyCount, 0);
  });
});
