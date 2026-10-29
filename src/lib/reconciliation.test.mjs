import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditLedger,
  buildMovementReport,
  matchTransfers,
  normaliseMutationLog,
  normaliseStatementSnapshots,
  reconcileStatement,
  suggestInferredRecords,
} from "./reconciliation.ts";
import { inspectStoredTransactions, serializeTransactions } from "./transactionStorage.ts";

function row(overrides) {
  return {
    id: overrides.id ?? `t-${Math.random().toString(36).slice(2)}`,
    date: overrides.date ?? "2026-10-10",
    description: overrides.description ?? "Payment",
    amount: overrides.amount ?? 1000,
    direction: overrides.direction ?? "expense",
    category: overrides.category ?? "Other",
    source: overrides.source ?? "Bank A",
    ...overrides,
  };
}

describe("auditLedger", () => {
  it("reports exact duplicate rows without removing them", () => {
    const transactions = [
      row({ id: "a", description: "Groceries", amount: 5000 }),
      row({ id: "b", description: "Groceries", amount: 5000, time: "09:30" }),
    ];
    const issues = auditLedger(transactions);
    const duplicate = issues.find((issue) => issue.kind === "exact-duplicate");
    assert.ok(duplicate, "expected an exact-duplicate issue");
    assert.deepEqual(duplicate.transactionIds.includes("a") && duplicate.transactionIds.includes("b"), true);
    assert.equal(transactions.length, 2, "the audit must never drop rows");
  });

  it("flags same-day cross-account rows as near-duplicates", () => {
    const issues = auditLedger([
      row({ id: "a", description: "POS meal", amount: 2500, source: "OPay" }),
      row({ id: "b", description: "POS meal", amount: 2500, source: "GTBank" }),
    ]);
    const near = issues.find((issue) => issue.kind === "near-duplicate");
    assert.ok(near, "expected a near-duplicate issue");
    assert.match(near.message, /OPay and GTBank/);
  });

  it("detects idle months between recorded activity", () => {
    const issues = auditLedger([
      row({ id: "a", date: "2026-08-01", source: "GTBank" }),
      row({ id: "b", date: "2026-10-02", source: "GTBank" }),
      row({ id: "c", date: "2026-10-03", source: "GTBank" }),
    ]);
    const gap = issues.find((issue) => issue.kind === "period-gap");
    assert.ok(gap, "expected a period-gap issue");
    assert.match(gap.message, /2026-09/);
  });

  it("stays quiet on clean, dense ledgers", () => {
    const transactions = [];
    for (let day = 1; day <= 20; day += 1) {
      transactions.push(row({ id: `x${day}`, date: `2026-10-${String(day).padStart(2, "0")}`, description: `Shop ${day}`, amount: 1000 + day }));
    }
    assert.deepEqual(auditLedger(transactions).filter((issue) => issue.kind !== "period-gap"), []);
  });
});

describe("matchTransfers", () => {
  it("links money that left one wallet and arrived in another", () => {
    const result = matchTransfers([
      row({ id: "out", description: "Transfer to GTBank", amount: 20000, date: "2026-10-05", source: "OPay", category: "Transfers", ownAccountCandidate: true }),
      row({ id: "in", description: "Credit", amount: 20000, date: "2026-10-06", source: "GTBank", direction: "income", category: "Income", ownAccountCandidate: true }),
    ]);
    assert.equal(result.links.length, 1);
    assert.equal(result.links[0].outId, "out");
    assert.equal(result.links[0].inId, "in");
    assert.ok(result.links[0].confidence >= 0.7);
    assert.match(result.links[0].reason, /left OPay/);
    assert.equal(result.unmatched.length, 0);
  });

  it("keeps rows outside the confidence window unmatched", () => {
    const result = matchTransfers([
      row({ id: "out", description: "Send money", amount: 9000, date: "2026-10-01", source: "OPay", category: "Transfers" }),
      row({ id: "mistake", description: "Unrelated salary", amount: 9000, date: "2026-10-20", source: "GTBank", direction: "income", category: "Income" }),
    ]);
    assert.deepEqual(result.links, []);
    assert.equal(result.unmatched.length, 1);
    assert.equal(result.unmatched[0].transaction.id, "out");
    assert.match(result.unmatched[0].reason, /no matching arrival/);
  });

  it("never links a row to itself twice", () => {
    const result = matchTransfers([
      row({ id: "out1", description: "Transfer", amount: 1000, date: "2026-10-01", source: "OPay", category: "Transfers" }),
      row({ id: "in1", description: "Transfer", amount: 1000, date: "2026-10-01", source: "GTBank", direction: "income", category: "Transfers" }),
      row({ id: "out2", description: "Transfer", amount: 1000, date: "2026-10-01", source: "Access", category: "Transfers" }),
      row({ id: "in2", description: "Transfer", amount: 1000, date: "2026-10-01", source: "PalmPay", direction: "income", category: "Transfers" }),
    ]);
    assert.equal(result.links.length, 2);
    const used = result.links.flatMap((link) => [link.outId, link.inId]);
    assert.equal(new Set(used).size, 4, "each transaction links at most once");
  });
});

describe("reconcileStatement", () => {
  const snapshot = {
    id: "snap-1",
    account: "GTBank",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    openingBalance: 1000,
    closingBalance: 26000,
    declaredTotalIn: 30000,
    declaredTotalOut: 5000,
    recordedBy: "manual",
    createdAt: "2026-10-29T20:00:00.000Z",
  };

  it("shows zero differences when the ledger explains the statement", () => {
    const result = reconcileStatement([
      row({ id: "a", description: "Salary", amount: 30000, direction: "income", category: "Income", source: "GTBank", date: "2026-10-05" }),
      row({ id: "b", description: "Food", amount: 5000, direction: "expense", category: "Food & groceries", source: "GTBank", date: "2026-10-06" }),
    ], snapshot);
    assert.equal(result.deltaDifference, 0);
    assert.equal(result.inDifference, 0);
    assert.equal(result.outDifference, 0);
    assert.match(result.reason, /matches the declared figures/);
  });

  it("reports unexplained movement with its arithmetic", () => {
    const result = reconcileStatement([
      row({ id: "a", description: "Salary", amount: 22000, direction: "income", category: "Income", source: "GTBank", date: "2026-10-05" }),
    ], snapshot);
    assert.equal(result.inDifference, 8000);
    assert.equal(result.deltaDifference, 3000);
    assert.match(result.reason, /exceeds recorded credits by 8000\.00/);
  });

  it("ignores internal transfers and rows from other accounts", () => {
    const result = reconcileStatement([
      row({ id: "a", description: "Savings pot", amount: 30000, direction: "expense", category: "Transfers", internalTransfer: true, source: "GTBank", date: "2026-10-06" }),
      row({ id: "b", description: "Other account salary", amount: 30000, direction: "income", category: "Income", source: "OPay", date: "2026-10-06" }),
    ], snapshot);
    assert.equal(result.recordedIn, 0);
    assert.equal(result.recordedCount, 0);
    assert.equal(result.inDifference, 30000);
  });
});

describe("suggestInferredRecords", () => {
  it("suggests a clearly labelled income correction for a missing credit", () => {
    const snapshot = {
      id: "snap-2",
      account: "GTBank",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      declaredTotalIn: 30000,
      recordedBy: "manual",
      createdAt: "2026-10-29T20:00:00.000Z",
    };
    const result = {
      ...reconcileStatement([
        row({ id: "a", description: "Salary", amount: 22000, direction: "income", category: "Income", source: "GTBank", date: "2026-10-05" }),
      ], snapshot),
    };
    const suggestions = suggestInferredRecords([], snapshot, result);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].direction, "income");
    assert.equal(suggestions[0].amount, 8000);
    assert.match(suggestions[0].description, /(inferred)/);
    assert.match(suggestions[0].basis, /declared money in of 30000\.00 but recorded credits/);
    const added = { ...row({ description: suggestions[0].description }), inferred: true };
    assert.equal(serializeTransactions([added]).includes("Unrecorded money in (inferred)"), true);
    const roundTrip = inspectStoredTransactions(serializeTransactions([added]));
    assert.equal(roundTrip.transactions[0].inferred, true, "the inferred marker must survive storage");
  });

  it("stays quiet when there is nothing unexplained", () => {
    const snapshot = {
      id: "snap-3",
      account: "GTBank",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      recordedBy: "manual",
      createdAt: "2026-10-29T20:00:00.000Z",
    };
    assert.deepEqual(suggestInferredRecords([], snapshot, { ...reconcileStatement([], snapshot), snapshotId: snapshot.id }), []);
  });
});

describe("buildMovementReport", () => {
  it("separates spending, transfers, fees, refunds, and unresolved movements", () => {
    const transactions = [
      row({ id: "a", description: "Groceries", amount: 1000, category: "Food & groceries" }),
      row({ id: "b", description: "Transfer to Bayo", amount: 5000, category: "Transfers" }),
      row({ id: "c", description: "USSD charge", amount: 25, category: "Bank fees" }),
      row({ id: "d", description: "Refund", amount: 300, direction: "income", category: "Refunds" }),
      row({ id: "e", description: "OWealth redemption", amount: 700, internalTransfer: true, category: "Transfers" }),
      row({ id: "f", description: "Transfer", amount: 1200, category: "Transfers" }),
    ];
    const unmatched = [{ transaction: { id: "f" }, role: "sent", reason: "unmatched" }];
    const report = buildMovementReport(transactions, unmatched, false);
    assert.equal(report.actualSpending, 1000);
    assert.equal(report.transfersOut, 6200);
    assert.equal(report.bankFees, 25);
    assert.equal(report.refunds, 300);
    assert.equal(report.internalMoves, 700);
    assert.equal(report.unresolvedOut, 1200);
  });
});

describe("normalisers", () => {
  it("drops unreadable snapshots and keeps valid ones", () => {
    const snapshots = normaliseStatementSnapshots([
      null,
      { id: "s1", account: "GTBank", periodStart: "2026-10-01", periodEnd: "2026-09-30", recordedBy: "manual" }, // inverted range
      { id: "s2", account: "OPay", periodStart: "2026-09-01", periodEnd: "2026-09-30", recordedBy: "import", createdAt: "", declaredTotalIn: 10.5 },
    ]);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].declaredTotalIn, 10.5);
  });

  it("drops junk mutation entries and keeps real ones", () => {
    const log = normaliseMutationLog([
      { id: "m1", at: "2026-10-29T20:00:00.000Z", kind: "delete", detail: "Removed 1 transaction" },
      { id: "m2", at: "2026-10-29T20:00:00.000Z", kind: "explode", detail: "nope" },
      { at: "nope", kind: "delete", detail: "missing id" },
    ]);
    assert.equal(log.length, 1);
    assert.equal(log[0].kind, "delete");
  });
});
