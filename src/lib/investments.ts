import {
  investmentActions,
  investmentAssetTypes,
  type InvestmentAction,
  type InvestmentAssetType,
  type InvestmentRecord,
  type InvestmentStore,
  type InvestmentValuation,
} from "../types.ts";

export type { InvestmentStore };

/**
 * Investment analytics over a local, manual ledger. Every figure depends on what
 * is recorded: returns that need unit data stay null until the rows carry units,
 * and paper value only exists where the user has marked one. No live prices.
 */

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const isoMonthPattern = /^\d{4}-\d{2}$/;

function positiveFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function inList<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** Reads saved investment data defensively; unreadable rows are dropped, never repaired. */
export function normaliseInvestments(value: unknown): InvestmentStore {
  const store = (value && typeof value === "object" ? value : {}) as { records?: unknown; valuations?: unknown };
  const records: InvestmentRecord[] = Array.isArray(store.records)
    ? store.records.flatMap((entry): InvestmentRecord[] => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Partial<InvestmentRecord>;
        const amount = positiveFinite(record.amount);
        const date = typeof record.date === "string" && isoDatePattern.test(record.date) ? record.date : undefined;
        const asset = text(record.asset, 120);
        const action = investmentActions.includes(record.action as InvestmentAction) ? record.action as InvestmentAction : undefined;
        if (!amount || !date || !asset || !action) return [];
        return [{
          id: typeof record.id === "string" && record.id.trim() ? record.id : `inv-${date}-${Math.random().toString(36).slice(2, 9)}`,
          date,
          assetType: inList(record.assetType, investmentAssetTypes, "Other"),
          action,
          asset,
          amount,
          units: positiveFinite(record.units),
          pricePerUnit: positiveFinite(record.pricePerUnit),
          broker: text(record.broker, 60) ?? "Manual entry",
          ...(text(record.note, 280) ? { note: text(record.note, 280) } : {}),
        }];
      })
    : [];
  const valuations: InvestmentValuation[] = Array.isArray(store.valuations)
    ? store.valuations.flatMap((entry): InvestmentValuation[] => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Partial<InvestmentValuation>;
        const marketValue = positiveFinite(item.marketValue);
        const asOf = typeof item.asOf === "string" && isoDatePattern.test(item.asOf) ? item.asOf : undefined;
        const asset = text(item.asset, 120);
        if (!marketValue || !asOf || !asset) return [];
        return [{
          id: typeof item.id === "string" && item.id.trim() ? item.id : `val-${asset.toLowerCase()}-${Math.random().toString(36).slice(2, 9)}`,
          asset,
          marketValue,
          asOf,
          ...(text(item.note, 280) ? { note: text(item.note, 280) } : {}),
        }];
      })
    : [];
  return { records, valuations };
}

const round = (value: number) => Math.round(value * 100) / 100;

function assetKey(record: { asset: string }): string {
  return record.asset.toLowerCase().trim();
}

export interface AssetAnalytics {
  asset: string;
  assetType: InvestmentAssetType;
  brokers: string[];
  eventCount: number;
  firstEventDate: string;
  lastEventDate: string;
  bought: number;
  sold: number;
  income: number;
  fees: number;
  /** Cash paid into the asset, including fees. */
  moneyIn: number;
  /** Cash that came back: sale proceeds plus income. */
  moneyBack: number;
  /** Money in minus sales proceeds; what remains committed if nothing else moves. */
  netInvested: number;
  unitsKnown: boolean;
  unitsBought: number;
  unitsSold: number;
  heldUnits: number | null;
  /** Weighted by units over buy rows; null when a buy row lacks its unit count. */
  averageCostPerUnit: number | null;
  /** What the still-held part of the position cost. */
  remainingCost: number;
  /** Sales proceeds minus the average cost of the units sold; null without unit data. */
  realizedProfit: number | null;
  valuations: InvestmentValuation[];
  latestValuation: InvestmentValuation | null;
  unrealizedProfit: number | null;
  /** Realized + income + unrealized, relative to money in. */
  totalReturn: number | null;
  roi: number | null;
}

export interface AggregateAnalytics {
  label: string;
  eventCount: number;
  moneyIn: number;
  moneyBack: number;
  realizedProfit: number;
  income: number;
  paperValue: number;
  netFlow: number;
  roi: number | null;
}

export interface MonthlyFlow {
  label: string;
  invested: number;
  returned: number;
  income: number;
  net: number;
}

export interface InvestmentInsights {
  assets: AssetAnalytics[];
  totals: AggregateAnalytics;
  byType: AggregateAnalytics[];
  byBroker: AggregateAnalytics[];
  monthly: MonthlyFlow[];
  valuationCount: number;
}

function assetAnalyticsFor(store: InvestmentStore, key: string): AssetAnalytics | null {
  const rows = store.records
    .filter((record) => assetKey(record) === key)
    .sort((first, second) => first.date.localeCompare(second.date));
  if (!rows.length) return null;
  const bought = round(rows.filter((row) => row.action === "buy").reduce((sum, row) => sum + row.amount, 0));
  const sold = round(rows.filter((row) => row.action === "sell").reduce((sum, row) => sum + row.amount, 0));
  const income = round(rows.filter((row) => row.action === "income").reduce((sum, row) => sum + row.amount, 0));
  const fees = round(rows.filter((row) => row.action === "fee").reduce((sum, row) => sum + row.amount, 0));
  const buyRows = rows.filter((row) => row.action === "buy");
  const sellRows = rows.filter((row) => row.action === "sell");
  const unitsBought = round(buyRows.reduce((sum, row) => sum + (row.units ?? 0), 0));
  const unitsSold = round(sellRows.reduce((sum, row) => sum + (row.units ?? 0), 0));
  const unitsKnown = unitsBought > 0;
  const costInputs = buyRows.map((row) => ({
    units: row.units ?? 0,
    cost: row.units !== undefined && row.pricePerUnit !== undefined ? row.units * row.pricePerUnit : row.amount,
  }));
  const weightedUnits = costInputs.reduce((sum, item) => sum + item.units, 0);
  const averageCostPerUnit = unitsKnown && weightedUnits > 0
    ? round(costInputs.reduce((sum, item) => sum + item.cost, 0) / weightedUnits)
    : null;
  const heldUnits = unitsKnown ? round(unitsBought - unitsSold) : null;
  const remainingCost = averageCostPerUnit !== null
    ? round(Math.max(heldUnits ?? 0, 0) * averageCostPerUnit)
    : round(Math.max(bought + fees - sold, 0));
  const realizedProfit = averageCostPerUnit !== null
    ? round(sellRows.reduce((sum, row) => sum + (row.amount - (row.units ?? 0) * averageCostPerUnit), 0))
    : null;
  const assetValuations = store.valuations
    .filter((item) => assetKey(item) === key)
    .sort((first, second) => second.asOf.localeCompare(first.asOf));
  const latestValuation = assetValuations[0] ?? null;
  const unrealizedProfit = latestValuation ? round(latestValuation.marketValue - remainingCost) : null;
  const moneyIn = round(bought + fees);
  const totalReturn = realizedProfit === null && unrealizedProfit === null && income === 0
    ? null
    : round((realizedProfit ?? 0) + income + (unrealizedProfit ?? 0));
  return {
    asset: rows[rows.length - 1].asset,
    assetType: rows[0].assetType,
    brokers: [...new Set(rows.map((row) => row.broker))],
    eventCount: rows.length,
    firstEventDate: rows[0].date,
    lastEventDate: rows[rows.length - 1].date,
    bought,
    sold,
    income,
    fees,
    moneyIn,
    moneyBack: round(sold + income),
    netInvested: round(moneyIn - sold),
    unitsKnown,
    unitsBought,
    unitsSold,
    heldUnits,
    averageCostPerUnit,
    remainingCost,
    realizedProfit,
    valuations: [...assetValuations].reverse(),
    latestValuation,
    unrealizedProfit,
    totalReturn,
    roi: moneyIn > 0 && totalReturn !== null ? round((totalReturn / moneyIn) * 100) : null,
  };
}

/** Realized profit summed over assets; missing unit data simply contributes nothing. */
function sumRealized(assets: AssetAnalytics[]): number {
  return round(assets.reduce((sum, asset) => sum + (asset.realizedProfit ?? 0), 0));
}

function aggregate(label: string, rows: InvestmentRecord[], assetsOf: (ids: string[]) => AssetAnalytics[]): AggregateAnalytics {
  const keys = rows.map((row) => assetKey(row));
  const assets = assetsOf([...new Set(keys)]);
  const moneyIn = round(rows.filter((row) => row.action === "buy" || row.action === "fee").reduce((sum, row) => sum + row.amount, 0));
  const returned = round(rows.filter((row) => row.action === "sell").reduce((sum, row) => sum + row.amount, 0));
  const income = round(rows.filter((row) => row.action === "income").reduce((sum, row) => sum + row.amount, 0));
  const paperValue = round(assets.reduce((sum, asset) => sum + (asset.latestValuation?.marketValue ?? 0), 0));
  const realized = sumRealized(assets);
  return {
    label,
    eventCount: rows.length,
    moneyIn,
    moneyBack: round(returned + income),
    realizedProfit: realized,
    income,
    paperValue,
    netFlow: round(returned + income - moneyIn),
    roi: moneyIn > 0 ? round(((realized + income) / moneyIn) * 100) : null,
  };
}

function monthlyFlow(records: InvestmentRecord[]): MonthlyFlow[] {
  const months = new Map<string, MonthlyFlow>();
  for (const record of records) {
    const label = record.date.slice(0, 7);
    if (!isoMonthPattern.test(label)) continue;
    const row = months.get(label) ?? { label, invested: 0, returned: 0, income: 0, net: 0 };
    if (record.action === "buy" || record.action === "fee") row.invested += record.amount;
    else if (record.action === "sell") row.returned += record.amount;
    else row.income += record.amount;
    row.net = round((row.returned + row.income) - row.invested);
    months.set(label, row);
  }
  return [...months.values()].sort((first, second) => second.label.localeCompare(first.label));
}

/**
 * Full insights snapshot: per-asset rows, aggregate totals, type and broker
 * breakdowns, and a monthly flow.
 */
export function getInvestmentInsights(records: InvestmentRecord[], valuations: InvestmentValuation[]): InvestmentInsights {
  const store: InvestmentStore = { records, valuations };
  const assetsOf = (keys: string[]): AssetAnalytics[] => keys
    .map((key) => assetAnalyticsFor(store, key))
    .filter((asset): asset is AssetAnalytics => asset !== null);
  const assetKeys = [...new Set(records.map((row) => assetKey(row)))];
  const typeGroups = [...new Set(records.map((row) => row.assetType))];
  const brokerGroups = [...new Set(records.map((row) => row.broker))];
  return {
    assets: assetsOf(assetKeys),
    totals: aggregate("All", records, assetsOf),
    byType: typeGroups.map((label) => aggregate(label, records.filter((row) => row.assetType === label), assetsOf)),
    byBroker: brokerGroups.map((label) => aggregate(label, records.filter((row) => row.broker === label), assetsOf)),
    monthly: monthlyFlow(records),
    valuationCount: valuations.filter((valuation) => assetKeys.includes(assetKey(valuation))).length,
  };
}
