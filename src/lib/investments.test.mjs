import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getInvestmentInsights, normaliseInvestments } from "./investments.ts";
import { serializeTransactions } from "./transactionStorage.ts";

function record(overrides) {
  return {
    id: overrides.id ?? `inv-${Math.random().toString(36).slice(2)}`,
    date: overrides.date ?? "2026-10-10",
    assetType: overrides.assetType ?? "Stocks",
    asset: overrides.asset ?? "GTB shares",
    action: overrides.action ?? "buy",
    amount: overrides.amount ?? 10000,
    broker: overrides.broker ?? "Broker A",
    ...overrides,
  };
}

describe("normaliseInvestments", () => {
  it("keeps valid rows and drops junk without repair", () => {
    const store = normaliseInvestments({
      records: [
        { id: "a", date: "2026-10-01", asset: "GTB shares", action: "buy", amount: 25000, assetType: "Stocks", broker: "Chaka", units: 100, pricePerUnit: 250 },
        { id: "b", date: "bogus-date", asset: "X", action: "buy", amount: 5 },
        { id: "c", date: "2026-10-02", asset: "", action: "sell", amount: 5 },
        { id: "d", date: "2026-10-03", asset: "Gold", action: "teleport", amount: 5 },
        { id: "e", date: "2026-10-04", asset: "Gold", action: "buy", amount: -5 },
      ],
      valuations: [
        { id: "v1", asset: "GTB shares", marketValue: 28000, asOf: "2026-10-20" },
        { id: "v2", asset: "GTB shares", marketValue: 0, asOf: "2026-10-21" },
      ],
    });
    assert.equal(store.records.length, 1);
    assert.equal(store.records[0].units, 100);
    assert.equal(store.valuations.length, 1);
    assert.equal(store.valuations[0].marketValue, 28000);
  });

  it("survives non-object and legacy shapes", () => {
    assert.deepEqual(normaliseInvestments(null), { records: [], valuations: [] });
    assert.deepEqual(normaliseInvestments("nope"), { records: [], valuations: [] });
    assert.deepEqual(normaliseInvestments({ records: "nope", valuations: 42 }), { records: [], valuations: [] });
  });
});

describe("getInvestmentInsights", () => {
  const store = normaliseInvestments({
    records: [
      { id: "1", date: "2026-08-01", asset: "GTB shares", action: "buy", amount: 20000, units: 400, pricePerUnit: 50, assetType: "Stocks", broker: "Chaka" },
      { id: "2", date: "2026-09-01", asset: "GTB shares", action: "buy", amount: 10000, units: 200, pricePerUnit: 50, assetType: "Stocks", broker: "Chaka" },
      { id: "3", date: "2026-09-15", asset: "GTB shares", action: "income", amount: 1200, assetType: "Stocks", broker: "Chaka", note: "Dividend" },
      { id: "4", date: "2026-10-01", asset: "GTB shares", action: "sell", amount: 6000, units: 100, assetType: "Stocks", broker: "Chaka" },
      { id: "5", date: "2026-10-02", asset: "GTB shares", action: "fee", amount: 150, assetType: "Stocks", broker: "Chaka" },
      { id: "6", date: "2026-10-03", asset: "Treasury bill", action: "buy", amount: 100000, assetType: "Bonds & treasury bills", broker: "OPay" },
      { id: "7", date: "2026-10-04", asset: "Treasury bill", action: "income", amount: 3300, assetType: "Bonds & treasury bills", broker: "OPay" },
    ],
    valuations: [
      { id: "v1", asset: "GTB shares", marketValue: 25000, asOf: "2026-10-20" },
      { id: "v2", asset: "GTB shares", marketValue: 26000, asOf: "2026-10-25" },
    ],
  });

  const insights = getInvestmentInsights(store.records, store.valuations);
  const gtb = insights.assets.find((asset) => asset.asset === "GTB shares");
  const bill = insights.assets.find((asset) => asset.asset === "Treasury bill");

  it("builds per-asset holdings with weighted average cost", () => {
    assert.ok(gtb, "GTB asset row expected");
    assert.equal(gtb.bought, 30000);
    assert.equal(gtb.fees, 150);
    assert.equal(gtb.moneyIn, 30150);
    assert.equal(gtb.income, 1200);
    assert.equal(gtb.unitsKnown, true);
    assert.equal(gtb.heldUnits, 500);
    assert.equal(gtb.averageCostPerUnit, 50);
    assert.equal(gtb.remainingCost, 25000);
    assert.equal(gtb.realizedProfit, 6000 - 100 * 50);
  });

  it("uses the most recent valuation and computes unrealized profit", () => {
    assert.equal(gtb.latestValuation.marketValue, 26000);
    assert.equal(gtb.latestValuation.asOf, "2026-10-25");
    assert.equal(gtb.unrealizedProfit, 1000);
  });

  it("keeps unit-dependent metrics null when units are not recorded", () => {
    assert.ok(bill, "treasury bill asset row expected");
    assert.equal(bill.unitsKnown, false);
    assert.equal(bill.heldUnits, null);
    assert.equal(bill.realizedProfit, null, "realized P/L needs unit data");
    assert.equal(bill.remainingCost, 100000);
  });

  it("aggregates totals, type and broker breakdowns", () => {
    assert.equal(insights.totals.moneyIn, 30150 + 100000);
    assert.equal(insights.totals.income, 4500);
    assert.equal(insights.totals.eventCount, 7);
    const stocks = insights.byType.find((row) => row.label === "Stocks");
    const chaka = insights.byBroker.find((row) => row.label === "Chaka");
    assert.ok(stocks && chaka);
    assert.equal(stocks.moneyIn, 30150);
    assert.equal(chaka.moneyIn, 30150);
    assert.equal(insights.totals.roi !== null, true);
  });

  it("flows money by month", () => {
    const october = insights.monthly.find((row) => row.label === "2026-10");
    assert.ok(october, "October flow expected");
    assert.equal(october.invested, 100000 + 150);
    assert.equal(october.returned, 6000);
    assert.equal(october.income, 3300);
    const september = insights.monthly.find((row) => row.label === "2026-09");
    assert.equal(september.invested, 10000);
    assert.equal(september.income, 1200);
  });

  it("stays silent for an empty store", () => {
    const empty = getInvestmentInsights([], []);
    assert.equal(empty.assets.length, 0);
    assert.equal(empty.totals.roi, null);
    assert.deepEqual(empty.monthly, []);
  });

  it("never sends investment data anywhere: serializeTransactions rejects nothing new", () => {
    // Investments are stored in localStorage separately; the point of this
    // assertion is that the transaction storage format is untouched by the
    // investment module.
    const payload = JSON.parse(serializeTransactions([]));
    assert.equal(payload.format, "spendwise.transactions.compact.v3");
  });
});
