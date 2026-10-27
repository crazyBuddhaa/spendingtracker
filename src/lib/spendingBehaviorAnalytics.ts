import type { Category, Transaction } from "../types.ts";

export interface BehaviorDateRange {
  start: string | null;
  end: string | null;
}

type AnalysisStatus = "ready" | "limited" | "insufficient";

const DAY_MS = 86_400_000;
const DISCRETIONARY_CATEGORIES = new Set<Category>(["Shopping", "Entertainment", "Betting"]);
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? round(((current - previous) / previous) * 100) : null;
}

function isExternalExpense(transaction: Transaction): boolean {
  return transaction.direction === "expense"
    && !transaction.internalTransfer
    && Number.isFinite(transaction.amount)
    && transaction.amount > 0
    && parseIsoDate(transaction.date) !== null;
}

function isExternalIncome(transaction: Transaction): boolean {
  return transaction.direction === "income"
    && transaction.category !== "Refunds"
    && !transaction.internalTransfer
    && Number.isFinite(transaction.amount)
    && transaction.amount > 0
    && parseIsoDate(transaction.date) !== null;
}

function matchesRange(date: string, range: BehaviorDateRange): boolean {
  let start = parseIsoDate(range.start) === null ? null : range.start;
  let end = parseIsoDate(range.end) === null ? null : range.end;
  if (start && end && start > end) [start, end] = [end, start];
  return (!start || date >= start) && (!end || date <= end);
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

export interface SmallExpenseCategory {
  category: Category;
  amount: number;
  count: number;
}

export interface SmallExpenseAccumulation {
  status: AnalysisStatus;
  transactionCount: number;
  smallTransactionCount: number;
  threshold: number | null;
  smallSpend: number;
  totalSpend: number;
  shareOfSpending: number;
  topCategories: SmallExpenseCategory[];
}

/** Defines "small" as the lowest-value quarter of this period's expenses. */
export function getSmallExpenseAccumulation(
  transactions: Transaction[],
  range: BehaviorDateRange = { start: null, end: null },
): SmallExpenseAccumulation {
  const expenses = transactions.filter((transaction) =>
    isExternalExpense(transaction) && matchesRange(transaction.date, range));
  const totalSpend = round(expenses.reduce((sum, transaction) => sum + transaction.amount, 0));
  if (expenses.length < 8) {
    return {
      status: "insufficient",
      transactionCount: expenses.length,
      smallTransactionCount: 0,
      threshold: null,
      smallSpend: 0,
      totalSpend,
      shareOfSpending: 0,
      topCategories: [],
    };
  }

  const threshold = percentile(expenses.map((transaction) => transaction.amount), 0.25);
  const smallExpenses = expenses.filter((transaction) => transaction.amount <= threshold);
  const byCategory = new Map<Category, SmallExpenseCategory>();
  for (const transaction of smallExpenses) {
    const current = byCategory.get(transaction.category) ?? { category: transaction.category, amount: 0, count: 0 };
    current.amount += transaction.amount;
    current.count += 1;
    byCategory.set(transaction.category, current);
  }
  const smallSpend = round(smallExpenses.reduce((sum, transaction) => sum + transaction.amount, 0));

  return {
    status: "ready",
    transactionCount: expenses.length,
    smallTransactionCount: smallExpenses.length,
    threshold: round(threshold),
    smallSpend,
    totalSpend,
    shareOfSpending: totalSpend > 0 ? round((smallSpend / totalSpend) * 100) : 0,
    topCategories: [...byCategory.values()].sort((a, b) => b.amount - a.amount).slice(0, 3)
      .map((item) => ({ ...item, amount: round(item.amount) })),
  };
}

export interface LifestyleInflationAnalysis {
  status: "signal" | "spending-outpaced" | "stable" | "insufficient";
  previousPeriod: string;
  recentPeriod: string;
  previousIncomeMonths: number;
  recentIncomeMonths: number;
  previousExpenseMonths: number;
  recentExpenseMonths: number;
  previousAverageIncome: number | null;
  recentAverageIncome: number | null;
  previousAverageSpending: number | null;
  recentAverageSpending: number | null;
  incomeChangePercent: number | null;
  spendingChangePercent: number | null;
  spendingShareChangePoints: number | null;
}

function monthKey(year: number, monthIndex: number): string {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthWindow(anchorMonth: string, startOffset: number, endOffset: number): string[] {
  const [year, month] = anchorMonth.split("-").map(Number);
  return Array.from({ length: endOffset - startOffset + 1 }, (_, index) =>
    monthKey(year, month - 1 + startOffset + index));
}

function monthWindowLabel(keys: string[]): string {
  if (!keys.length) return "—";
  const first = new Date(`${keys[0]}-01T00:00:00.000Z`);
  const last = new Date(`${keys[keys.length - 1]}-01T00:00:00.000Z`);
  const firstMonth = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(first);
  const lastMonth = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(last);
  const lastYear = last.getUTCFullYear();
  return first.getUTCFullYear() === lastYear
    ? `${firstMonth}–${lastMonth} ${lastYear}`
    : `${firstMonth} ${first.getUTCFullYear()}–${lastMonth} ${lastYear}`;
}

/** Compares the latest three complete months with the preceding three. */
export function getLifestyleInflationAnalysis(
  transactions: Transaction[],
  asOfDate?: string | null,
): LifestyleInflationAnalysis {
  const validDates = transactions.map((transaction) => parseIsoDate(transaction.date))
    .filter((timestamp): timestamp is number => timestamp !== null);
  const anchorTimestamp = parseIsoDate(asOfDate) ?? (validDates.length ? Math.max(...validDates) : null);
  const empty: LifestyleInflationAnalysis = {
    status: "insufficient",
    previousPeriod: "—",
    recentPeriod: "—",
    previousIncomeMonths: 0,
    recentIncomeMonths: 0,
    previousExpenseMonths: 0,
    recentExpenseMonths: 0,
    previousAverageIncome: null,
    recentAverageIncome: null,
    previousAverageSpending: null,
    recentAverageSpending: null,
    incomeChangePercent: null,
    spendingChangePercent: null,
    spendingShareChangePoints: null,
  };
  if (anchorTimestamp === null) return empty;

  const anchor = new Date(anchorTimestamp);
  const anchorMonth = monthKey(anchor.getUTCFullYear(), anchor.getUTCMonth());
  const recentMonths = monthWindow(anchorMonth, -3, -1);
  const previousMonths = monthWindow(anchorMonth, -6, -4);
  const relevantMonths = new Set([...previousMonths, ...recentMonths]);
  const monthly = new Map<string, { income: number; expenses: number; refunds: number }>();
  for (const key of relevantMonths) monthly.set(key, { income: 0, expenses: 0, refunds: 0 });

  for (const transaction of transactions) {
    if (parseIsoDate(transaction.date) === null || !relevantMonths.has(transaction.date.slice(0, 7)) || transaction.internalTransfer) continue;
    const bucket = monthly.get(transaction.date.slice(0, 7));
    if (!bucket) continue;
    if (transaction.direction === "expense" && Number.isFinite(transaction.amount) && transaction.amount > 0) {
      bucket.expenses += transaction.amount;
    } else if (transaction.direction === "income" && transaction.category === "Refunds" && Number.isFinite(transaction.amount)) {
      bucket.refunds += transaction.amount;
    } else if (isExternalIncome(transaction)) {
      bucket.income += transaction.amount;
    }
  }

  const summarize = (keys: string[]) => {
    const rows = keys.map((key) => {
      const row = monthly.get(key)!;
      return { income: row.income, spending: Math.max(0, row.expenses - row.refunds) };
    });
    const incomeRows = rows.filter((row) => row.income > 0);
    const expenseRows = rows.filter((row) => row.spending > 0);
    return {
      incomeMonths: incomeRows.length,
      expenseMonths: expenseRows.length,
      averageIncome: incomeRows.length ? rows.reduce((sum, row) => sum + row.income, 0) / incomeRows.length : null,
      averageSpending: expenseRows.length ? rows.reduce((sum, row) => sum + row.spending, 0) / expenseRows.length : null,
    };
  };
  const previous = summarize(previousMonths);
  const recent = summarize(recentMonths);
  const incomeChangePercent = previous.averageIncome && recent.averageIncome
    ? percentChange(recent.averageIncome, previous.averageIncome)
    : null;
  const spendingChangePercent = previous.averageSpending && recent.averageSpending
    ? percentChange(recent.averageSpending, previous.averageSpending)
    : null;
  const spendingShareChangePoints = previous.averageIncome && recent.averageIncome &&
    previous.averageSpending !== null && recent.averageSpending !== null
    ? round(((recent.averageSpending / recent.averageIncome) - (previous.averageSpending / previous.averageIncome)) * 100)
    : null;

  let status: LifestyleInflationAnalysis["status"] = "insufficient";
  const enoughCoverage = previous.incomeMonths >= 2 && recent.incomeMonths >= 2 &&
    previous.expenseMonths >= 2 && recent.expenseMonths >= 2;
  if (enoughCoverage && incomeChangePercent !== null && spendingChangePercent !== null) {
    if (incomeChangePercent >= 5 && spendingChangePercent >= 10 && spendingChangePercent - incomeChangePercent >= 10) {
      status = "signal";
    } else if (spendingChangePercent >= 10 && spendingChangePercent - incomeChangePercent >= 5) {
      status = "spending-outpaced";
    } else {
      status = "stable";
    }
  }

  return {
    status,
    previousPeriod: monthWindowLabel(previousMonths),
    recentPeriod: monthWindowLabel(recentMonths),
    previousIncomeMonths: previous.incomeMonths,
    recentIncomeMonths: recent.incomeMonths,
    previousExpenseMonths: previous.expenseMonths,
    recentExpenseMonths: recent.expenseMonths,
    previousAverageIncome: previous.averageIncome === null ? null : round(previous.averageIncome),
    recentAverageIncome: recent.averageIncome === null ? null : round(recent.averageIncome),
    previousAverageSpending: previous.averageSpending === null ? null : round(previous.averageSpending),
    recentAverageSpending: recent.averageSpending === null ? null : round(recent.averageSpending),
    incomeChangePercent,
    spendingChangePercent,
    spendingShareChangePoints,
  };
}

export interface SpendingContextAnalysis {
  status: AnalysisStatus;
  activeDays: number;
  highSpendDays: number;
  highSpendThreshold: number | null;
  commonHighSpendWeekday: string | null;
  commonHighSpendWeekdayCount: number;
  commonHighSpendDayPart: string | null;
  commonHighSpendDayPartCount: number;
  topCategory: { category: Category; amount: number; count: number } | null;
}

function minuteOfDay(value: string | undefined): number | null {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function dayPart(minute: number): string {
  const hour = Math.floor(minute / 60);
  if (hour < 5 || hour >= 22) return "Overnight";
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

/** Finds recurring day, time, and category context on the period's high-spend days. */
export function getSpendingContextAnalysis(
  transactions: Transaction[],
  range: BehaviorDateRange = { start: null, end: null },
): SpendingContextAnalysis {
  const byDate = new Map<string, {
    timestamp: number;
    amount: number;
    categories: Map<Category, { amount: number; count: number }>;
    parts: Map<string, number>;
  }>();

  for (const transaction of transactions) {
    if (!isExternalExpense(transaction) || !matchesRange(transaction.date, range)) continue;
    const timestamp = parseIsoDate(transaction.date)!;
    const entry = byDate.get(transaction.date) ?? {
      timestamp,
      amount: 0,
      categories: new Map<Category, { amount: number; count: number }>(),
      parts: new Map<string, number>(),
    };
    entry.amount += transaction.amount;
    const category = entry.categories.get(transaction.category) ?? { amount: 0, count: 0 };
    category.amount += transaction.amount;
    category.count += 1;
    entry.categories.set(transaction.category, category);
    const minute = minuteOfDay(transaction.time);
    if (minute !== null) {
      const part = dayPart(minute);
      entry.parts.set(part, (entry.parts.get(part) ?? 0) + transaction.amount);
    }
    byDate.set(transaction.date, entry);
  }

  const activeDays = [...byDate.values()];
  const empty: SpendingContextAnalysis = {
    status: activeDays.length < 8 ? "insufficient" : "ready",
    activeDays: activeDays.length,
    highSpendDays: 0,
    highSpendThreshold: null,
    commonHighSpendWeekday: null,
    commonHighSpendWeekdayCount: 0,
    commonHighSpendDayPart: null,
    commonHighSpendDayPartCount: 0,
    topCategory: null,
  };
  if (activeDays.length < 8) return empty;

  const highSpendThreshold = percentile(activeDays.map((day) => day.amount), 0.75);
  const highDays = activeDays.filter((day) => day.amount >= highSpendThreshold);
  const weekdays = new Map<string, number>();
  const parts = new Map<string, number>();
  const categories = new Map<Category, { amount: number; count: number }>();

  for (const day of highDays) {
    const weekday = WEEKDAY_NAMES[new Date(day.timestamp).getUTCDay()];
    weekdays.set(weekday, (weekdays.get(weekday) ?? 0) + 1);
    const dominantPart = [...day.parts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dominantPart) parts.set(dominantPart, (parts.get(dominantPart) ?? 0) + 1);
    for (const [categoryName, value] of day.categories) {
      const current = categories.get(categoryName) ?? { amount: 0, count: 0 };
      current.amount += value.amount;
      current.count += value.count;
      categories.set(categoryName, current);
    }
  }

  const mostCommon = (values: Map<string, number>): [string, number] | null =>
    [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
  const weekday = mostCommon(weekdays);
  const part = mostCommon(parts);
  const topCategory = [...categories.entries()].sort((a, b) => b[1].amount - a[1].amount)[0];

  return {
    status: "ready",
    activeDays: activeDays.length,
    highSpendDays: highDays.length,
    highSpendThreshold: round(highSpendThreshold),
    commonHighSpendWeekday: weekday?.[0] ?? null,
    commonHighSpendWeekdayCount: weekday?.[1] ?? 0,
    commonHighSpendDayPart: part?.[0] ?? null,
    commonHighSpendDayPartCount: part?.[1] ?? 0,
    topCategory: topCategory
      ? { category: topCategory[0], amount: round(topCategory[1].amount), count: topCategory[1].count }
      : null,
  };
}

export interface PossibleImpulseCluster {
  date: string;
  startMinute: number;
  endMinute: number;
  amount: number;
  transactionCount: number;
  categories: Category[];
}

export interface PossibleImpulseAnalysis {
  status: AnalysisStatus;
  totalDiscretionaryTransactions: number;
  timedDiscretionaryTransactions: number;
  timedCoveragePercent: number;
  clusterCount: number;
  clusteredTransactionCount: number;
  clusteredSpend: number;
  clusters: PossibleImpulseCluster[];
}

/** Flags short clusters of discretionary expenses, not a person's intent or state of mind. */
export function getPossibleImpulseSpending(
  transactions: Transaction[],
  range: BehaviorDateRange = { start: null, end: null },
): PossibleImpulseAnalysis {
  const discretionary = transactions.filter((transaction) =>
    isExternalExpense(transaction) &&
    matchesRange(transaction.date, range) &&
    DISCRETIONARY_CATEGORIES.has(transaction.category));
  const byDate = new Map<string, Array<{ transaction: Transaction; minute: number }>>();
  let timedDiscretionaryTransactions = 0;
  for (const transaction of transactions) {
    if (!isExternalExpense(transaction) || !matchesRange(transaction.date, range)) continue;
    const minute = minuteOfDay(transaction.time);
    if (minute === null) continue;
    if (DISCRETIONARY_CATEGORIES.has(transaction.category)) timedDiscretionaryTransactions += 1;
    const entries = byDate.get(transaction.date) ?? [];
    entries.push({ transaction, minute });
    byDate.set(transaction.date, entries);
  }

  const clusters: PossibleImpulseCluster[] = [];
  for (const [date, entries] of byDate) {
    entries.sort((a, b) => a.minute - b.minute || a.transaction.id.localeCompare(b.transaction.id));
    let session: typeof entries = [];
    const saveSession = () => {
      const purchases = session.filter((entry) => DISCRETIONARY_CATEGORIES.has(entry.transaction.category));
      if (purchases.length >= 2 && session[session.length - 1].minute - session[0].minute <= 60) {
        clusters.push({
          date,
          startMinute: session[0].minute,
          endMinute: session[session.length - 1].minute,
          amount: round(purchases.reduce((sum, entry) => sum + entry.transaction.amount, 0)),
          transactionCount: purchases.length,
          categories: [...new Set(purchases.map((entry) => entry.transaction.category))],
        });
      }
      session = [];
    };

    for (const entry of entries) {
      const previous = session[session.length - 1];
      if (previous && entry.minute - previous.minute > 60) saveSession();
      session.push(entry);
    }
    if (session.length) saveSession();
  }

  const totalDiscretionaryTransactions = discretionary.length;
  const timedCoveragePercent = totalDiscretionaryTransactions
    ? round((timedDiscretionaryTransactions / totalDiscretionaryTransactions) * 100)
    : 0;
  const clusteredTransactionCount = clusters.reduce((sum, cluster) => sum + cluster.transactionCount, 0);
  const status: AnalysisStatus = totalDiscretionaryTransactions < 4 || timedCoveragePercent < 50
    ? "limited"
    : "ready";

  return {
    status,
    totalDiscretionaryTransactions,
    timedDiscretionaryTransactions,
    timedCoveragePercent,
    clusterCount: clusters.length,
    clusteredTransactionCount,
    clusteredSpend: round(clusters.reduce((sum, cluster) => sum + cluster.amount, 0)),
    clusters: clusters.sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date)).slice(0, 4),
  };
}

export interface PaydaySpendingAnalysis {
  status: AnalysisStatus;
  windowDays: number;
  paydayCyclesWithSpending: number;
  paydayWindowDays: number;
  baselineDays: number;
  paydaySpend: number;
  baselineSpend: number;
  paydayAveragePerDay: number;
  baselineAveragePerDay: number;
  differencePercent: number | null;
}

/**
 * Compares spending on each recorded income date and the next three calendar
 * days with the other calendar days in the requested range.
 */
export function getPaydaySpendingAnalysis(
  transactions: Transaction[],
  range: BehaviorDateRange = { start: null, end: null },
  windowDays = 3,
): PaydaySpendingAnalysis {
  const safeWindowDays = Number.isFinite(windowDays) ? Math.max(0, Math.floor(windowDays)) : 3;
  const expenses = transactions.filter((transaction) =>
    isExternalExpense(transaction) && matchesRange(transaction.date, range));
  const datedExpenseTimestamps = expenses.map((transaction) => parseIsoDate(transaction.date)!);
  let start = parseIsoDate(range.start) ?? (datedExpenseTimestamps.length ? Math.min(...datedExpenseTimestamps) : null);
  let end = parseIsoDate(range.end) ?? (datedExpenseTimestamps.length ? Math.max(...datedExpenseTimestamps) : null);
  if (start !== null && end !== null && start > end) [start, end] = [end, start];
  const incomeDates = [...new Set(transactions.filter(isExternalIncome).map((transaction) => transaction.date))].sort();
  const spendByDate = new Map<string, number>();
  for (const transaction of expenses) {
    spendByDate.set(transaction.date, (spendByDate.get(transaction.date) ?? 0) + transaction.amount);
  }

  let paydayWindowDays = 0;
  let baselineDays = 0;
  let paydaySpend = 0;
  let baselineSpend = 0;
  let incomeIndex = 0;
  let latestIncomeDate: string | null = null;
  const cyclesWithSpending = new Set<string>();
  if (start !== null && end !== null) {
    for (let timestamp = start; timestamp <= end; timestamp += DAY_MS) {
      const date = isoDate(timestamp);
      while (incomeIndex < incomeDates.length && incomeDates[incomeIndex] <= date) {
        latestIncomeDate = incomeDates[incomeIndex];
        incomeIndex += 1;
      }
      const incomeTimestamp = parseIsoDate(latestIncomeDate);
      const daysSinceIncome = incomeTimestamp === null ? null : Math.floor((timestamp - incomeTimestamp) / DAY_MS);
      const amount = spendByDate.get(date) ?? 0;
      if (daysSinceIncome !== null && daysSinceIncome >= 0 && daysSinceIncome <= safeWindowDays) {
        paydayWindowDays += 1;
        paydaySpend += amount;
        if (amount > 0 && latestIncomeDate) cyclesWithSpending.add(latestIncomeDate);
      } else {
        baselineDays += 1;
        baselineSpend += amount;
      }
    }
  }

  const paydayAveragePerDay = paydayWindowDays ? round(paydaySpend / paydayWindowDays) : 0;
  const baselineAveragePerDay = baselineDays ? round(baselineSpend / baselineDays) : 0;
  const differencePercent = baselineAveragePerDay > 0
    ? percentChange(paydayAveragePerDay, baselineAveragePerDay)
    : null;

  return {
    status: cyclesWithSpending.size >= 2 && baselineDays >= 7 ? "ready" : "insufficient",
    windowDays: safeWindowDays,
    paydayCyclesWithSpending: cyclesWithSpending.size,
    paydayWindowDays,
    baselineDays,
    paydaySpend: round(paydaySpend),
    baselineSpend: round(baselineSpend),
    paydayAveragePerDay,
    baselineAveragePerDay,
    differencePercent,
  };
}
