import type { BetRecord } from "../types.ts";

const settledStatuses = new Set(["won", "lost", "void", "cashed-out"]);

export interface BetAggregate {
  label: string;
  betCount: number;
  settledCount: number;
  settledStake: number;
  settledReturn: number;
  net: number;
  roi: number | null;
  wins: number;
  losses: number;
  decisiveCount: number;
  winRate: number | null;
}

export interface BettingInsights {
  betCount: number;
  totalStaked: number;
  totalReturned: number;
  settledCount: number;
  settledStake: number;
  settledReturn: number;
  settledNet: number;
  roi: number | null;
  wins: number;
  losses: number;
  decisiveCount: number;
  winRate: number | null;
  openCount: number;
  openStake: number;
  otherCount: number;
  averageStake: number | null;
  medianStake: number | null;
  averageSettledNet: number | null;
  settledReturnRate: number | null;
  positiveSettledCount: number;
  negativeSettledCount: number;
  evenSettledCount: number;
  activeDays: number;
  capturedEvents: number;
  hiddenEvents: number;
  averageEventsPerBet: number | null;
  bestBet: BetRecord | null;
  lowestNetBet: BetRecord | null;
  outcomeCounts: Record<BetRecord["status"], number>;
  byCategory: BetAggregate[];
  byBetType: BetAggregate[];
  bySource: BetAggregate[];
  byDay: BetAggregate[];
  byMonth: BetAggregate[];
}

function isSettled(bet: BetRecord): boolean {
  return settledStatuses.has(bet.status);
}

function netOf(bet: BetRecord): number {
  return bet.returnAmount - bet.stake;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function aggregate(label: string, bets: BetRecord[]): BetAggregate {
  const settled = bets.filter(isSettled);
  const wins = bets.filter((bet) => bet.status === "won").length;
  const losses = bets.filter((bet) => bet.status === "lost").length;
  const settledStake = sum(settled.map((bet) => bet.stake));
  const settledReturn = sum(settled.map((bet) => bet.returnAmount));
  const decisiveCount = wins + losses;

  return {
    label,
    betCount: bets.length,
    settledCount: settled.length,
    settledStake,
    settledReturn,
    net: settledReturn - settledStake,
    roi: settledStake > 0 ? ((settledReturn - settledStake) / settledStake) * 100 : null,
    wins,
    losses,
    decisiveCount,
    winRate: decisiveCount > 0 ? (wins / decisiveCount) * 100 : null,
  };
}

function groupBy(
  bets: BetRecord[],
  keyFor: (bet: BetRecord) => string,
): BetAggregate[] {
  const groups = new Map<string, BetRecord[]>();
  for (const bet of bets) {
    const key = keyFor(bet).trim() || "Unspecified";
    const group = groups.get(key);
    if (group) group.push(bet);
    else groups.set(key, [bet]);
  }
  return [...groups.entries()]
    .map(([label, group]) => aggregate(label, group))
    .sort((a, b) => b.net - a.net || b.betCount - a.betCount || a.label.localeCompare(b.label));
}

function groupByPeriod(
  bets: BetRecord[],
  periodFor: (date: string) => string,
): BetAggregate[] {
  const groups = new Map<string, BetRecord[]>();
  for (const bet of bets) {
    if (!validIsoDate(bet.date)) continue;
    const period = periodFor(bet.date);
    const group = groups.get(period);
    if (group) group.push(bet);
    else groups.set(period, [bet]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, group]) => aggregate(label, group));
}

export function getBettingInsights(bets: BetRecord[]): BettingInsights {
  const settled = bets.filter(isSettled);
  const wins = bets.filter((bet) => bet.status === "won").length;
  const losses = bets.filter((bet) => bet.status === "lost").length;
  const decisiveCount = wins + losses;
  const totalStaked = sum(bets.map((bet) => bet.stake));
  const totalReturned = sum(bets.map((bet) => bet.returnAmount));
  const settledStake = sum(settled.map((bet) => bet.stake));
  const settledReturn = sum(settled.map((bet) => bet.returnAmount));
  const settledNet = settledReturn - settledStake;
  const stakes = bets.map((bet) => bet.stake);
  const netValues = settled.map(netOf);
  const outcomeCounts: BettingInsights["outcomeCounts"] = {
    won: 0,
    lost: 0,
    open: 0,
    void: 0,
    "cashed-out": 0,
    other: 0,
  };
  for (const bet of bets) outcomeCounts[bet.status] += 1;

  return {
    betCount: bets.length,
    totalStaked,
    totalReturned,
    settledCount: settled.length,
    settledStake,
    settledReturn,
    settledNet,
    roi: settledStake > 0 ? (settledNet / settledStake) * 100 : null,
    wins,
    losses,
    decisiveCount,
    winRate: decisiveCount > 0 ? (wins / decisiveCount) * 100 : null,
    openCount: outcomeCounts.open,
    openStake: sum(bets.filter((bet) => bet.status === "open").map((bet) => bet.stake)),
    otherCount: outcomeCounts.other,
    averageStake: bets.length ? totalStaked / bets.length : null,
    medianStake: median(stakes),
    averageSettledNet: settled.length ? settledNet / settled.length : null,
    settledReturnRate: settledStake > 0 ? (settledReturn / settledStake) * 100 : null,
    positiveSettledCount: netValues.filter((value) => value > 0).length,
    negativeSettledCount: netValues.filter((value) => value < 0).length,
    evenSettledCount: netValues.filter((value) => value === 0).length,
    activeDays: new Set(bets.filter((bet) => validIsoDate(bet.date)).map((bet) => bet.date)).size,
    capturedEvents: sum(bets.map((bet) => bet.events.length)),
    hiddenEvents: sum(bets.map((bet) => Math.max(0, bet.hiddenEvents))),
    averageEventsPerBet: bets.length
      ? sum(bets.map((bet) => bet.events.length + Math.max(0, bet.hiddenEvents))) / bets.length
      : null,
    bestBet: settled.length ? settled.reduce((best, bet) => netOf(bet) > netOf(best) ? bet : best) : null,
    lowestNetBet: settled.length ? settled.reduce((worst, bet) => netOf(bet) < netOf(worst) ? bet : worst) : null,
    outcomeCounts,
    byCategory: groupBy(bets, (bet) => bet.category),
    byBetType: groupBy(bets, (bet) => bet.betType),
    bySource: groupBy(bets, (bet) => bet.source),
    byDay: groupByPeriod(bets, (date) => date),
    byMonth: groupByPeriod(bets, (date) => date.slice(0, 7)),
  };
}
