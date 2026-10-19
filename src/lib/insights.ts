import type { Category, Transaction } from "../types.ts";

export type Period = "30d" | "90d" | "this-month" | "last-month" | "12m" | "this-year" | "all" | "custom";

/** Inclusive ISO date bounds; null means open-ended. */
export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface Totals {
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
  transactionCount: number;
  /** Refunds and reversals; they reduce spending instead of counting as income. */
  refunds: number;
}

export interface CategoryTotal {
  category: Category;
  amount: number;
  count: number;
  share: number;
}

export interface MonthTotal {
  month: string;
  label: string;
  income: number;
  expenses: number;
}

export function getPeriodStart(period: Period, now = new Date()): Date | null {
  const { start } = resolvePeriod(period, now);
  return start ? new Date(`${start}T00:00:00`) : null;
}

export function resolvePeriod(period: Period, now = new Date(), custom: DateRange = { start: null, end: null }): DateRange {
  const today = toIsoDate(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "30d":
      start.setDate(start.getDate() - 29);
      return { start: toIsoDate(start), end: today };
    case "90d":
      start.setDate(start.getDate() - 89);
      return { start: toIsoDate(start), end: today };
    case "this-month":
      return { start: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
    case "last-month":
      return {
        start: toIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "12m":
      return { start: toIsoDate(new Date(now.getFullYear(), now.getMonth() - 11, 1)), end: today };
    case "this-year":
      return { start: `${now.getFullYear()}-01-01`, end: today };
    case "custom": {
      const [from, to] = custom.start && custom.end && custom.start > custom.end
        ? [custom.end, custom.start]
        : [custom.start, custom.end];
      return { start: from || null, end: to || null };
    }
    default:
      return { start: null, end: null };
  }
}

/** The equally long window just before `range`, used for "vs previous" comparisons. */
export function previousRange(period: Period, range: DateRange): DateRange | null {
  if (!range.start || !range.end) return null;
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  if (period === "this-month" || period === "last-month" || period === "12m" || period === "this-year") {
    const months = period === "12m" ? 12 : period === "this-year" ? 12 : 1;
    const previousStart = new Date(start.getFullYear(), start.getMonth() - months, start.getDate());
    const previousEnd = new Date(end.getFullYear(), end.getMonth() - months, Math.min(end.getDate(), daysInMonth(end.getFullYear(), end.getMonth() - months)));
    return { start: toIsoDate(previousStart), end: toIsoDate(previousEnd) };
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return { start: toIsoDate(previousStart), end: toIsoDate(previousEnd) };
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function filterByRange(transactions: Transaction[], range: DateRange): Transaction[] {
  return transactions.filter((transaction) =>
    (!range.start || transaction.date >= range.start) && (!range.end || transaction.date <= range.end));
}

export function filterByPeriod(transactions: Transaction[], period: Period, now = new Date()): Transaction[] {
  return filterByRange(transactions, resolvePeriod(period, now));
}

/** Monthly income/spending for every month the range covers (or the data covers, when open-ended). */
export function getMonthlySeries(transactions: Transaction[], range: DateRange): MonthTotal[] {
  const dates = transactions.map((transaction) => transaction.date).filter(Boolean).sort();
  const first = range.start ?? dates[0];
  const last = range.end ?? dates[dates.length - 1];
  if (!first || !last) return [];
  const cursor = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1);
  const stop = new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1, 1);
  const multiYear = first.slice(0, 4) !== last.slice(0, 4);
  const months: MonthTotal[] = [];
  while (cursor <= stop && months.length < 240) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("en", { month: "short" }).format(cursor);
    months.push({ month: key, label: multiYear ? `${label} ${String(cursor.getFullYear()).slice(2)}` : label, income: 0, expenses: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const byMonth = new Map(months.map((month) => [month.month, month]));
  for (const transaction of filterByRange(transactions, range)) {
    if (transaction.internalTransfer) continue;
    const month = byMonth.get(transaction.date.slice(0, 7));
    if (!month) continue;
    if (transaction.direction === "income" && transaction.category === "Refunds") month.expenses -= transaction.amount;
    else if (transaction.direction === "income") month.income += transaction.amount;
    else month.expenses += transaction.amount;
  }
  for (const month of months) month.expenses = Math.max(month.expenses, 0);
  return months;
}

export function calculateTotals(transactions: Transaction[]): Totals {
  let income = 0;
  let grossExpenses = 0;
  let refunds = 0;
  let transactionCount = 0;
  for (const transaction of transactions) {
    if (transaction.internalTransfer) continue;
    transactionCount += 1;
    if (transaction.direction === "expense") grossExpenses += transaction.amount;
    else if (transaction.category === "Refunds") refunds += transaction.amount;
    else income += transaction.amount;
  }
  const expenses = Math.max(grossExpenses - refunds, 0);
  return {
    income,
    expenses,
    net: income - expenses,
    savingsRate: income > 0 ? ((income - expenses) / income) * 100 : 0,
    transactionCount,
    refunds,
  };
}

export function getCategoryTotals(transactions: Transaction[]): CategoryTotal[] {
  const map = new Map<Category, { amount: number; count: number }>();
  for (const transaction of transactions) {
    if (transaction.direction !== "expense" || transaction.internalTransfer) continue;
    const current = map.get(transaction.category) ?? { amount: 0, count: 0 };
    current.amount += transaction.amount;
    current.count += 1;
    map.set(transaction.category, current);
  }
  const total = [...map.values()].reduce((sum, entry) => sum + entry.amount, 0);
  return [...map.entries()]
    .map(([category, value]) => ({
      category,
      ...value,
      share: total > 0 ? (value.amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function getMonthlyTotals(transactions: Transaction[], count = 6, now = new Date()): MonthTotal[] {
  const months: MonthTotal[] = [];
  const first = new Date(now.getFullYear(), now.getMonth() - count + 1, 1);
  for (let i = 0; i < count; i += 1) {
    const date = new Date(first.getFullYear(), first.getMonth() + i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      month: key,
      label: new Intl.DateTimeFormat("en", { month: "short" }).format(date),
      income: 0,
      expenses: 0,
    });
  }
  const totalsByMonth = new Map(months.map((month) => [month.month, month]));
  for (const transaction of transactions) {
    if (transaction.internalTransfer) continue;
    const month = totalsByMonth.get(transaction.date.slice(0, 7));
    if (!month) continue;
    if (transaction.direction === "income" && transaction.category === "Refunds") month.expenses -= transaction.amount;
    else if (transaction.direction === "income") month.income += transaction.amount;
    else month.expenses += transaction.amount;
  }
  for (const month of months) month.expenses = Math.max(month.expenses, 0);
  return months;
}

export function largestExpense(transactions: Transaction[]): Transaction | undefined {
  return transactions
    .filter((transaction) => transaction.direction === "expense" && !transaction.internalTransfer)
    .sort((a, b) => b.amount - a.amount)[0];
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
