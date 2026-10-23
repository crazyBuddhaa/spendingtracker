import type { Category, Transaction } from "../types.ts";
import { counterpartyName } from "./analytics.ts";

export type CashflowKind = "income" | "expense" | "refund";

export interface CashflowTimelineEntry {
  transaction: Transaction;
  name: string;
  kind: CashflowKind;
  minuteOfDay: number | null;
}

export interface IncomePurchaseMatch {
  incomeDate: string;
  purchaseDate: string;
  purchaseName: string;
  purchaseCategory: Category;
  calendarDays: number;
  elapsedMinutes: number | null;
}

export interface TimeToFirstPurchaseAnalytics {
  incomeDates: number;
  matchedIncomeDates: number;
  medianCalendarDays: number | null;
  timedSameDayPurchases: number;
  medianSameDayMinutes: number | null;
  matches: IncomePurchaseMatch[];
}

export interface SpendingSession {
  date: string;
  startMinute: number;
  endMinute: number;
  amount: number;
  transactionCount: number;
  categories: Category[];
}

export interface SpendingSessionAnalytics {
  timedTransactions: number;
  sessionCount: number;
  groupedTransactionCount: number;
  averageSessionAmount: number;
  largestSessions: SpendingSession[];
}

export interface DayPartSummary {
  key: "overnight" | "morning" | "afternoon" | "evening";
  label: string;
  hours: string;
  amount: number;
  transactionCount: number;
  averageTransactionAmount: number;
  shareOfTimedSpending: number;
}

export interface CalendarPeriodSummary {
  label: "Weekdays" | "Weekends";
  days: number;
  amount: number;
  transactionCount: number;
  averagePerDay: number;
}

export interface TimePeriodPatterns {
  byDayPart: DayPartSummary[];
  timedTransactions: number;
  untimedTransactions: number;
  totalDatedExpenses: number;
  totalTimedSpending: number;
  weekday: CalendarPeriodSummary;
  weekend: CalendarPeriodSummary;
  weekendVsWeekdayAveragePercent: number | null;
}

const DAY_MS = 86_400_000;
const DISCRETIONARY_CATEGORIES = new Set<Category>(["Shopping", "Entertainment", "Betting"]);
const DAY_PARTS = [
  { key: "overnight", label: "Overnight", hours: "22:00–04:59" },
  { key: "morning", label: "Morning", hours: "05:00–11:59" },
  { key: "afternoon", label: "Afternoon", hours: "12:00–16:59" },
  { key: "evening", label: "Evening", hours: "17:00–21:59" },
] as const;

function parseIsoDate(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function minuteOfDay(value: string | undefined): number | null {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function roundAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isExternalExpense(transaction: Transaction): boolean {
  return transaction.direction === "expense" && !transaction.internalTransfer;
}

function isIncome(transaction: Transaction): boolean {
  return transaction.direction === "income" &&
    transaction.category !== "Refunds" &&
    !transaction.internalTransfer;
}

/** Mixes income, refunds, and expenses in a newest-first cashflow timeline. */
export function getIncomeSpendingTimeline(transactions: Transaction[], limit = 24): CashflowTimelineEntry[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 24;
  return transactions
    .filter((transaction) =>
      !transaction.internalTransfer &&
      parseIsoDate(transaction.date) !== null &&
      (transaction.direction === "expense" || transaction.direction === "income"))
    .map((transaction): CashflowTimelineEntry => ({
      transaction,
      name: counterpartyName(transaction.description) || (transaction.direction === "income" ? "Income" : "Spending"),
      kind: transaction.direction === "expense"
        ? "expense"
        : transaction.category === "Refunds"
          ? "refund"
          : "income",
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

/**
 * For each income date, finds the first subsequent purchase in the default
 * discretionary categories before the next income date. Same-day matches
 * require valid times for every income and the purchase on that date.
 */
export function getTimeToFirstDiscretionaryPurchase(transactions: Transaction[]): TimeToFirstPurchaseAnalytics {
  const incomeByDate = new Map<string, Transaction[]>();
  const expensesByDate = new Map<string, Array<{ transaction: Transaction; minute: number | null }>>();

  for (const transaction of transactions) {
    if (!parseIsoDate(transaction.date)) continue;
    if (isIncome(transaction)) {
      const group = incomeByDate.get(transaction.date) ?? [];
      group.push(transaction);
      incomeByDate.set(transaction.date, group);
    } else if (isExternalExpense(transaction) && DISCRETIONARY_CATEGORIES.has(transaction.category)) {
      const group = expensesByDate.get(transaction.date) ?? [];
      group.push({ transaction, minute: minuteOfDay(transaction.time) });
      expensesByDate.set(transaction.date, group);
    }
  }

  const incomeEvents = [...incomeByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => {
      const minutes = entries.map((entry) => minuteOfDay(entry.time));
      return {
        date,
        latestIncomeMinute: minutes.every((minute): minute is number => minute !== null)
          ? Math.max(...minutes)
          : null,
      };
    });

  const matches: IncomePurchaseMatch[] = [];
  for (let index = 0; index < incomeEvents.length; index += 1) {
    const event = incomeEvents[index];
    const nextIncomeDate = incomeEvents[index + 1]?.date ?? null;
    const candidateDates = [...expensesByDate.keys()]
      .filter((date) => date >= event.date && (!nextIncomeDate || date < nextIncomeDate))
      .sort();

    let first: IncomePurchaseMatch | null = null;
    for (const date of candidateDates) {
      const candidates = [...(expensesByDate.get(date) ?? [])].sort((a, b) => {
        if (a.minute === null) return b.minute === null ? a.transaction.id.localeCompare(b.transaction.id) : 1;
        if (b.minute === null) return -1;
        return a.minute - b.minute || a.transaction.id.localeCompare(b.transaction.id);
      });
      for (const candidate of candidates) {
        let elapsedMinutes: number | null = null;
        if (date === event.date) {
          if (
            event.latestIncomeMinute === null ||
            candidate.minute === null ||
            candidate.minute <= event.latestIncomeMinute
          ) continue;
          elapsedMinutes = candidate.minute - event.latestIncomeMinute;
        }
        const incomeTimestamp = parseIsoDate(event.date)!;
        const purchaseTimestamp = parseIsoDate(date)!;
        first = {
          incomeDate: event.date,
          purchaseDate: date,
          purchaseName: counterpartyName(candidate.transaction.description) || candidate.transaction.category,
          purchaseCategory: candidate.transaction.category,
          calendarDays: Math.floor((purchaseTimestamp - incomeTimestamp) / DAY_MS),
          elapsedMinutes,
        };
        break;
      }
      if (first) break;
    }
    if (first) matches.push(first);
  }

  const sameDayMinutes = matches
    .map((match) => match.elapsedMinutes)
    .filter((value): value is number => value !== null);

  return {
    incomeDates: incomeEvents.length,
    matchedIncomeDates: matches.length,
    medianCalendarDays: median(matches.map((match) => match.calendarDays)),
    timedSameDayPurchases: sameDayMinutes.length,
    medianSameDayMinutes: median(sameDayMinutes),
    matches: matches.sort((a, b) => b.incomeDate.localeCompare(a.incomeDate)).slice(0, 6),
  };
}

/** Groups timed expense transactions on the same date into 60-minute sessions. */
export function getSpendingSessionAnalytics(
  transactions: Transaction[],
  inactivityGapMinutes = 60,
): SpendingSessionAnalytics {
  const groupedByDate = new Map<string, Array<{ transaction: Transaction; minute: number }>>();
  let timedTransactions = 0;

  for (const transaction of transactions) {
    if (!isExternalExpense(transaction) || !parseIsoDate(transaction.date)) continue;
    const minute = minuteOfDay(transaction.time);
    if (minute === null) continue;
    timedTransactions += 1;
    const group = groupedByDate.get(transaction.date) ?? [];
    group.push({ transaction, minute });
    groupedByDate.set(transaction.date, group);
  }

  const sessions: SpendingSession[] = [];
  for (const [date, entries] of groupedByDate) {
    entries.sort((a, b) => a.minute - b.minute || a.transaction.id.localeCompare(b.transaction.id));
    let current: Array<{ transaction: Transaction; minute: number }> = [];
    const saveCurrent = () => {
      if (current.length >= 2) {
        sessions.push({
          date,
          startMinute: current[0].minute,
          endMinute: current[current.length - 1].minute,
          amount: roundAmount(current.reduce((sum, entry) => sum + entry.transaction.amount, 0)),
          transactionCount: current.length,
          categories: [...new Set(current.map((entry) => entry.transaction.category))],
        });
      }
      current = [];
    };

    for (const entry of entries) {
      const previous = current[current.length - 1];
      if (previous && entry.minute - previous.minute > inactivityGapMinutes) saveCurrent();
      current.push(entry);
    }
    saveCurrent();
  }

  const groupedTransactionCount = sessions.reduce((sum, session) => sum + session.transactionCount, 0);
  const orderedBySpend = sessions.sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date));
  const totalSessionSpend = orderedBySpend.reduce((sum, session) => sum + session.amount, 0);

  return {
    timedTransactions,
    sessionCount: sessions.length,
    groupedTransactionCount,
    averageSessionAmount: sessions.length ? roundAmount(totalSessionSpend / sessions.length) : 0,
    largestSessions: orderedBySpend.slice(0, 6),
  };
}

function calendarDayCounts(start: number, end: number): { days: number; weekdays: number; weekends: number } {
  const days = Math.max(0, Math.floor((end - start) / DAY_MS) + 1);
  const fullWeeks = Math.floor(days / 7);
  const remainder = days % 7;
  let extraWeekdays = 0;
  const startDay = new Date(start).getUTCDay();
  for (let offset = 0; offset < remainder; offset += 1) {
    const day = (startDay + offset) % 7;
    if (day !== 0 && day !== 6) extraWeekdays += 1;
  }
  const weekdays = fullWeeks * 5 + extraWeekdays;
  return { days, weekdays, weekends: days - weekdays };
}

function periodSummary(
  label: CalendarPeriodSummary["label"],
  days: number,
  amount: number,
  transactionCount: number,
): CalendarPeriodSummary {
  return {
    label,
    days,
    amount: roundAmount(amount),
    transactionCount,
    averagePerDay: days ? roundAmount(amount / days) : 0,
  };
}

/** Compares timed dayparts and weekday/weekend daily averages for the selected period. */
export function getTimePeriodPatterns(
  transactions: Transaction[],
  range: { start: string | null; end: string | null } = { start: null, end: null },
): TimePeriodPatterns {
  const datedExpenses: Array<{ transaction: Transaction; timestamp: number }> = [];
  for (const transaction of transactions) {
    if (!isExternalExpense(transaction) || !Number.isFinite(transaction.amount)) continue;
    const timestamp = parseIsoDate(transaction.date);
    if (timestamp !== null) datedExpenses.push({ transaction, timestamp });
  }

  const dates = datedExpenses.map((entry) => entry.timestamp).sort((a, b) => a - b);
  let start = parseIsoDate(range.start) ?? dates[0] ?? null;
  let end = parseIsoDate(range.end) ?? dates[dates.length - 1] ?? null;
  if (start !== null && end !== null && start > end) [start, end] = [end, start];
  const periodExpenses = datedExpenses.filter(({ timestamp }) =>
    (start === null || timestamp >= start) && (end === null || timestamp <= end));

  const parts = DAY_PARTS.map((part) => ({
    key: part.key,
    label: part.label,
    hours: part.hours,
    amount: 0,
    transactionCount: 0,
  }));
  const weekdayAmounts = { amount: 0, transactionCount: 0 };
  const weekendAmounts = { amount: 0, transactionCount: 0 };
  let timedTransactions = 0;
  let untimedTransactions = 0;
  let totalTimedSpending = 0;

  for (const { transaction, timestamp } of periodExpenses) {
    const weekday = new Date(timestamp).getUTCDay();
    const dayType = weekday === 0 || weekday === 6 ? weekendAmounts : weekdayAmounts;
    dayType.amount += transaction.amount;
    dayType.transactionCount += 1;

    const minute = minuteOfDay(transaction.time);
    if (minute === null) {
      untimedTransactions += 1;
      continue;
    }
    timedTransactions += 1;
    totalTimedSpending += transaction.amount;
    const hour = Math.floor(minute / 60);
    const partIndex = hour < 5 || hour >= 22 ? 0 : hour < 12 ? 1 : hour < 17 ? 2 : 3;
    parts[partIndex].amount += transaction.amount;
    parts[partIndex].transactionCount += 1;
  }

  const periodDays = start !== null && end !== null
    ? calendarDayCounts(start, end)
    : { days: 0, weekdays: 0, weekends: 0 };
  const weekday = periodSummary("Weekdays", periodDays.weekdays, weekdayAmounts.amount, weekdayAmounts.transactionCount);
  const weekend = periodSummary("Weekends", periodDays.weekends, weekendAmounts.amount, weekendAmounts.transactionCount);

  return {
    byDayPart: parts.map((part) => ({
      ...part,
      amount: roundAmount(part.amount),
      averageTransactionAmount: part.transactionCount ? roundAmount(part.amount / part.transactionCount) : 0,
      shareOfTimedSpending: totalTimedSpending > 0 ? part.amount / totalTimedSpending : 0,
    })),
    timedTransactions,
    untimedTransactions,
    totalDatedExpenses: periodExpenses.length,
    totalTimedSpending: roundAmount(totalTimedSpending),
    weekday,
    weekend,
    weekendVsWeekdayAveragePercent: weekday.averagePerDay
      ? Math.round(((weekend.averagePerDay - weekday.averagePerDay) / weekday.averagePerDay) * 10_000) / 100
      : null,
  };
}
