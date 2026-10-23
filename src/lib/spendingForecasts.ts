import type { Transaction } from "../types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SpendingForecasts {
  asOfDate: string;
  monthToDateSpending: number;
  monthHistoryDays: number;
  daysInMonth: number;
  monthEndProjection: number | null;
  recentWindowStart: string;
  recentWindowDays: number;
  recentWindowSpending: number;
  next30DayProjection: number | null;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

/**
 * Projects total spending from recorded expense/refund rows. These are simple
 * run-rate estimates, not forecasts that account for seasonality or upcoming bills.
 */
export function getSpendingForecasts(transactions: Transaction[], asOf = new Date()): SpendingForecasts {
  const asOfDate = isoDate(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const year = asOf.getFullYear();
  const monthIndex = asOf.getMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthStart = isoDate(year, monthIndex, 1);
  const recentWindowStart = new Date(dayNumber(asOfDate) * DAY_MS - 29 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const datedRows = transactions.filter((transaction) =>
    validDate(transaction.date) && transaction.date <= asOfDate,
  );
  const earliestDate = datedRows.reduce<string | null>(
    (earliest, transaction) => !earliest || transaction.date < earliest ? transaction.date : earliest,
    null,
  );
  const recentWindowDays = earliestDate
    ? Math.min(30, dayNumber(asOfDate) - dayNumber(earliestDate < recentWindowStart ? recentWindowStart : earliestDate) + 1)
    : 0;
  const monthHistoryStart = earliestDate && earliestDate > monthStart ? earliestDate : monthStart;
  const monthHistoryDays = earliestDate && monthHistoryStart <= asOfDate
    ? dayNumber(asOfDate) - dayNumber(monthHistoryStart) + 1
    : 0;

  let monthNet = 0;
  let recentNet = 0;
  let monthHasActivity = false;
  let recentHasActivity = false;
  for (const transaction of datedRows) {
    if (transaction.internalTransfer || !Number.isFinite(transaction.amount) || transaction.amount <= 0) continue;
    const isExpense = transaction.direction === "expense";
    const isRefund = transaction.direction === "income" && transaction.category === "Refunds";
    if (!isExpense && !isRefund) continue;
    const signedAmount = isExpense ? transaction.amount : -transaction.amount;
    if (transaction.date >= monthStart) {
      monthNet += signedAmount;
      monthHasActivity = true;
    }
    if (transaction.date >= recentWindowStart) {
      recentNet += signedAmount;
      recentHasActivity = true;
    }
  }

  const monthToDateSpending = round(Math.max(0, monthNet));
  const recentWindowSpending = round(Math.max(0, recentNet));
  const monthEndProjection = monthHistoryDays >= 7 && monthHasActivity
    ? round((monthToDateSpending / monthHistoryDays) * daysInMonth)
    : null;
  const next30DayProjection = recentWindowDays >= 14 && recentHasActivity
    ? round((recentWindowSpending / recentWindowDays) * 30)
    : null;

  return {
    asOfDate,
    monthToDateSpending,
    monthHistoryDays,
    daysInMonth,
    monthEndProjection,
    recentWindowStart,
    recentWindowDays,
    recentWindowSpending,
    next30DayProjection,
  };
}
