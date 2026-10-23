import type { Transaction } from "../types.ts";

export interface DailySpendPoint {
  date: string;
  amount: number;
  transactionCount: number;
}

export interface WeeklySpendPoint {
  weekStart: string;
  weekEnd: string;
  amount: number;
  transactionCount: number;
  daysInPeriod: number;
}

export interface SpendingPatternAnalytics {
  start: string | null;
  end: string | null;
  calendarDays: number;
  totalSpending: number;
  transactionCount: number;
  averageDailySpending: number;
  weeklyPace: number;
  averageTransactionsPerDay: number;
  transactionsPerWeek: number;
  dailyTrend: DailySpendPoint[];
  weeklyTrend: WeeklySpendPoint[];
  peakDay: DailySpendPoint | null;
  peakWeek: WeeklySpendPoint | null;
  peakFrequencyWeek: WeeklySpendPoint | null;
  velocityChangePercent: number | null;
  frequencyChangePercent: number | null;
}

const DAY_MS = 86_400_000;
const DAILY_CHART_DAYS = 30;
const WEEKLY_CHART_WEEKS = 16;

function parseIsoDate(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function mondayOf(timestamp: number): number {
  const day = new Date(timestamp).getUTCDay();
  return timestamp - ((day + 6) % 7) * DAY_MS;
}

function roundAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

function daysInRange(start: number, end: number): number {
  return Math.floor((end - start) / DAY_MS) + 1;
}

function countBetween(map: Map<string, { amount: number; transactionCount: number }>, start: number, end: number) {
  let amount = 0;
  let transactionCount = 0;
  for (let day = start; day <= end; day += DAY_MS) {
    const value = map.get(isoDate(day));
    amount += value?.amount ?? 0;
    transactionCount += value?.transactionCount ?? 0;
  }
  return { amount, transactionCount };
}

/**
 * Summarize expense pace and transaction frequency over an inclusive ISO date range.
 * Daily charts show the latest 30 days and weekly charts the latest 16 weeks in-range.
 */
export function getSpendingPatternAnalytics(
  transactions: Transaction[],
  range: { start: string | null; end: string | null } = { start: null, end: null },
): SpendingPatternAnalytics {
  const validSpend: Array<{ transaction: Transaction; timestamp: number }> = [];

  for (const transaction of transactions) {
    if (transaction.direction !== "expense" || transaction.internalTransfer) continue;
    const timestamp = parseIsoDate(transaction.date);
    if (timestamp === null || !Number.isFinite(transaction.amount)) continue;
    validSpend.push({ transaction, timestamp });
  }

  const dates = validSpend.map(({ timestamp }) => timestamp).sort((a, b) => a - b);
  let start = parseIsoDate(range.start) ?? dates[0] ?? null;
  let end = parseIsoDate(range.end) ?? dates[dates.length - 1] ?? null;
  if (start !== null && end !== null && start > end) [start, end] = [end, start];

  if (start === null || end === null) {
    return {
      start: null,
      end: null,
      calendarDays: 0,
      totalSpending: 0,
      transactionCount: 0,
      averageDailySpending: 0,
      weeklyPace: 0,
      averageTransactionsPerDay: 0,
      transactionsPerWeek: 0,
      dailyTrend: [],
      weeklyTrend: [],
      peakDay: null,
      peakWeek: null,
      peakFrequencyWeek: null,
      velocityChangePercent: null,
      frequencyChangePercent: null,
    };
  }

  const byDay = new Map<string, { amount: number; transactionCount: number }>();
  const byWeek = new Map<string, { amount: number; transactionCount: number }>();
  let totalSpending = 0;
  let transactionCount = 0;

  for (const { transaction, timestamp } of validSpend) {
    if (timestamp < start || timestamp > end) continue;
    const date = isoDate(timestamp);
    const day = byDay.get(date) ?? { amount: 0, transactionCount: 0 };
    day.amount += transaction.amount;
    day.transactionCount += 1;
    byDay.set(date, day);

    const weekStart = isoDate(mondayOf(timestamp));
    const week = byWeek.get(weekStart) ?? { amount: 0, transactionCount: 0 };
    week.amount += transaction.amount;
    week.transactionCount += 1;
    byWeek.set(weekStart, week);

    totalSpending += transaction.amount;
    transactionCount += 1;
  }

  const calendarDays = daysInRange(start, end);
  const averageDailySpending = calendarDays ? totalSpending / calendarDays : 0;
  const averageTransactionsPerDay = calendarDays ? transactionCount / calendarDays : 0;

  let peakDay: DailySpendPoint | null = null;
  for (const [date, value] of byDay) {
    const point = { date, amount: roundAmount(value.amount), transactionCount: value.transactionCount };
    if (!peakDay || point.amount > peakDay.amount || (point.amount === peakDay.amount && point.date > peakDay.date)) {
      peakDay = point;
    }
  }

  let peakWeek: WeeklySpendPoint | null = null;
  let peakFrequencyWeek: WeeklySpendPoint | null = null;
  for (const [weekStart, value] of byWeek) {
    const weekStartTimestamp = parseIsoDate(weekStart)!;
    const weekEndTimestamp = weekStartTimestamp + 6 * DAY_MS;
    const point: WeeklySpendPoint = {
      weekStart,
      weekEnd: isoDate(weekEndTimestamp),
      amount: roundAmount(value.amount),
      transactionCount: value.transactionCount,
      daysInPeriod: Math.max(0, daysInRange(Math.max(start, weekStartTimestamp), Math.min(end, weekEndTimestamp))),
    };
    if (!peakWeek || point.amount > peakWeek.amount || (point.amount === peakWeek.amount && point.weekStart > peakWeek.weekStart)) {
      peakWeek = point;
    }
    if (
      !peakFrequencyWeek ||
      point.transactionCount > peakFrequencyWeek.transactionCount ||
      (point.transactionCount === peakFrequencyWeek.transactionCount && point.weekStart > peakFrequencyWeek.weekStart)
    ) {
      peakFrequencyWeek = point;
    }
  }

  const dailyStart = Math.max(start, end - (DAILY_CHART_DAYS - 1) * DAY_MS);
  const dailyTrend: DailySpendPoint[] = [];
  for (let day = dailyStart; day <= end; day += DAY_MS) {
    const date = isoDate(day);
    const value = byDay.get(date);
    dailyTrend.push({
      date,
      amount: roundAmount(value?.amount ?? 0),
      transactionCount: value?.transactionCount ?? 0,
    });
  }

  const lastWeekStart = mondayOf(end);
  const firstVisibleWeek = Math.max(mondayOf(start), lastWeekStart - (WEEKLY_CHART_WEEKS - 1) * 7 * DAY_MS);
  const weeklyTrend: WeeklySpendPoint[] = [];
  for (let week = firstVisibleWeek; week <= lastWeekStart; week += 7 * DAY_MS) {
    const weekEnd = week + 6 * DAY_MS;
    const clippedStart = Math.max(start, week);
    const clippedEnd = Math.min(end, weekEnd);
    if (clippedStart > clippedEnd) continue;
    const value = byWeek.get(isoDate(week)) ?? { amount: 0, transactionCount: 0 };
    weeklyTrend.push({
      weekStart: isoDate(week),
      weekEnd: isoDate(weekEnd),
      amount: roundAmount(value.amount),
      transactionCount: value.transactionCount,
      daysInPeriod: daysInRange(clippedStart, clippedEnd),
    });
  }

  let velocityChangePercent: number | null = null;
  let frequencyChangePercent: number | null = null;
  if (calendarDays >= 14) {
    const recent = countBetween(byDay, end - 6 * DAY_MS, end);
    const previous = countBetween(byDay, end - 13 * DAY_MS, end - 7 * DAY_MS);
    velocityChangePercent = percentageChange(recent.amount, previous.amount);
    frequencyChangePercent = percentageChange(recent.transactionCount, previous.transactionCount);
  }

  return {
    start: isoDate(start),
    end: isoDate(end),
    calendarDays,
    totalSpending: roundAmount(totalSpending),
    transactionCount,
    averageDailySpending: roundAmount(averageDailySpending),
    weeklyPace: roundAmount(averageDailySpending * 7),
    averageTransactionsPerDay,
    transactionsPerWeek: averageTransactionsPerDay * 7,
    dailyTrend,
    weeklyTrend,
    peakDay,
    peakWeek,
    peakFrequencyWeek,
    velocityChangePercent,
    frequencyChangePercent,
  };
}
