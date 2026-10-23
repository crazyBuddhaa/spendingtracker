import type { Transaction } from "../types.ts";
import { counterpartyName } from "./analytics.ts";

export interface HourlySpendBucket {
  hour: number;
  amount: number;
  count: number;
  averageAmount: number;
}

export interface HeatmapCell {
  hour: number;
  amount: number;
  count: number;
}

export interface HeatmapRow {
  day: string;
  cells: HeatmapCell[];
}

export interface SpendingTimeAnalytics {
  byHour: HourlySpendBucket[];
  heatmap: HeatmapRow[];
  totalSpending: number;
  totalTimedSpending: number;
  spendingTransactions: number;
  timedTransactions: number;
  untimedTransactions: number;
  timeCoverageByCount: number;
  timeCoverageByAmount: number;
}

export interface SpendingTimelineEntry {
  transaction: Transaction;
  name: string;
  minuteOfDay: number | null;
}

const MINUTES_PER_DAY = 24 * 60;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date;
}

function minuteOfDay(time: string | undefined): number | null {
  const match = time?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const roundAmount = (amount: number) => Math.round(amount * 100) / 100;

/** Aggregate timed expenses into clock-hour totals and a weekday/hour heatmap. */
export function getSpendingTimeAnalytics(transactions: Transaction[]): SpendingTimeAnalytics {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0, count: 0 }));
  const heatmap = WEEKDAYS.map((day) => ({
    day,
    cells: Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0, count: 0 })),
  }));
  let totalSpending = 0;
  let totalTimedSpending = 0;
  let spendingTransactions = 0;
  let timedTransactions = 0;

  for (const transaction of transactions) {
    if (transaction.direction !== "expense" || transaction.internalTransfer) continue;
    const amount = Number.isFinite(transaction.amount) ? transaction.amount : 0;
    totalSpending += amount;
    spendingTransactions += 1;
    if (!isValidIsoDate(transaction.date)) continue;
    const minute = minuteOfDay(transaction.time);
    if (minute === null) continue;

    const hour = Math.floor(minute / 60);
    const weekday = new Date(`${transaction.date}T00:00:00.000Z`).getUTCDay();
    hourly[hour].amount += amount;
    hourly[hour].count += 1;
    heatmap[weekday].cells[hour].amount += amount;
    heatmap[weekday].cells[hour].count += 1;
    totalTimedSpending += amount;
    timedTransactions += 1;
  }

  return {
    byHour: hourly.map((bucket) => ({
      ...bucket,
      amount: roundAmount(bucket.amount),
      averageAmount: bucket.count ? roundAmount(bucket.amount / bucket.count) : 0,
    })),
    heatmap: heatmap.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({ ...cell, amount: roundAmount(cell.amount) })),
    })),
    totalSpending: roundAmount(totalSpending),
    totalTimedSpending: roundAmount(totalTimedSpending),
    spendingTransactions,
    timedTransactions,
    untimedTransactions: spendingTransactions - timedTransactions,
    timeCoverageByCount: spendingTransactions ? timedTransactions / spendingTransactions : 0,
    timeCoverageByAmount: totalSpending > 0 ? totalTimedSpending / totalSpending : 0,
  };
}

/** Recent spending in reverse chronological order; records without a time sort last within a day. */
export function getSpendingTimeline(transactions: Transaction[], limit = 20): SpendingTimelineEntry[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  return transactions
    .filter((transaction) =>
      transaction.direction === "expense" &&
      !transaction.internalTransfer &&
      isValidIsoDate(transaction.date))
    .map((transaction) => ({
      transaction,
      name: counterpartyName(transaction.description) || "Spending",
      minuteOfDay: minuteOfDay(transaction.time),
    }))
    .sort((a, b) => {
      const dateOrder = b.transaction.date.localeCompare(a.transaction.date);
      if (dateOrder) return dateOrder;
      if (a.minuteOfDay === null) return b.minuteOfDay === null ? b.transaction.id.localeCompare(a.transaction.id) : 1;
      if (b.minuteOfDay === null) return -1;
      return b.minuteOfDay - a.minuteOfDay || b.transaction.id.localeCompare(a.transaction.id);
    })
    .slice(0, safeLimit);
}

export function formatHour(hour: number): string {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  return `${String(normalized).padStart(2, "0")}:00`;
}

export function formatMinuteOfDay(minute: number): string {
  const normalized = ((Math.floor(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
