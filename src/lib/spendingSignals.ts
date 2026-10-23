import type { Transaction } from "../types.ts";

const MIN_TIME_HISTORY = 20;
const MIN_CATEGORY_HISTORY = 5;
const MAX_RESULTS = 6;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function isExternalExpense(transaction: Transaction): boolean {
  return transaction.direction === "expense"
    && !transaction.internalTransfer
    && Number.isFinite(transaction.amount)
    && transaction.amount > 0
    && isValidDate(transaction.date);
}

function minuteOfDay(value: string | undefined): number | null {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function transactionName(transaction: Transaction): string {
  return transaction.description.split("|")[0].replace(/\s+/g, " ").trim() || transaction.category;
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface TimedExpense {
  transaction: Transaction;
  minute: number;
  window: number;
}

export interface UnusualSpendingTime {
  transactionId: string;
  date: string;
  time: string;
  name: string;
  amount: number;
  windowStartHour: number;
  windowTransactionCount: number;
  priorTimedTransactions: number;
  historicalSharePercent: number;
}

export interface UnusualSpendingTimeAnalysis {
  items: UnusualSpendingTime[];
  unusualCount: number;
  eligibleTransactions: number;
}

/**
 * Flags a purchase only when it falls in a rarely used three-hour window in
 * the person's own earlier history. It does not treat any hour as inherently
 * suspicious and requires a minimum personal baseline.
 */
export function getUnusualSpendingTimes(
  selectedTransactions: Transaction[],
  allTransactions: Transaction[],
): UnusualSpendingTimeAnalysis {
  const toTimedExpense = (transaction: Transaction): TimedExpense | null => {
    if (!isExternalExpense(transaction)) return null;
    const minute = minuteOfDay(transaction.time);
    return minute === null ? null : { transaction, minute, window: Math.floor(minute / 180) };
  };
  const groupByDate = (transactions: Transaction[]) => {
    const grouped = new Map<string, TimedExpense[]>();
    for (const transaction of transactions) {
      const timed = toTimedExpense(transaction);
      if (!timed) continue;
      const group = grouped.get(transaction.date) ?? [];
      group.push(timed);
      grouped.set(transaction.date, group);
    }
    return grouped;
  };

  const historyByDate = groupByDate(allTransactions);
  const selectedByDate = groupByDate(selectedTransactions);
  const historyDates = [...historyByDate.keys()].sort();
  const targetDates = [...selectedByDate.keys()].sort();
  const priorWindowCounts = Array.from({ length: 8 }, () => 0);
  let priorTimedTransactions = 0;
  let historyIndex = 0;
  let eligibleTransactions = 0;
  const unusual: UnusualSpendingTime[] = [];

  for (const date of targetDates) {
    while (historyIndex < historyDates.length && historyDates[historyIndex] < date) {
      for (const item of historyByDate.get(historyDates[historyIndex]) ?? []) {
        priorWindowCounts[item.window] += 1;
        priorTimedTransactions += 1;
      }
      historyIndex += 1;
    }
    if (priorTimedTransactions < MIN_TIME_HISTORY) continue;

    for (const item of selectedByDate.get(date) ?? []) {
      eligibleTransactions += 1;
      const windowTransactionCount = priorWindowCounts[item.window];
      const historicalSharePercent = (windowTransactionCount / priorTimedTransactions) * 100;
      if (windowTransactionCount > 1 || historicalSharePercent > 5) continue;
      unusual.push({
        transactionId: item.transaction.id,
        date,
        time: item.transaction.time!,
        name: transactionName(item.transaction),
        amount: round(item.transaction.amount),
        windowStartHour: item.window * 3,
        windowTransactionCount,
        priorTimedTransactions,
        historicalSharePercent: round(historicalSharePercent),
      });
    }
  }

  unusual.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  return {
    items: unusual.slice(0, MAX_RESULTS),
    unusualCount: unusual.length,
    eligibleTransactions,
  };
}

export interface SpendingAnomaly {
  transactionId: string;
  date: string;
  time?: string;
  name: string;
  category: Transaction["category"];
  amount: number;
  categoryMedian: number;
  threshold: number;
  priorCategoryTransactions: number;
  multipleOfMedian: number;
}

export interface SpendingAnomalyAnalysis {
  items: SpendingAnomaly[];
  anomalyCount: number;
  eligibleTransactions: number;
}

/**
 * Flags high-value purchases relative to the same category's earlier history.
 * The robust threshold is at least twice the category median, and detection
 * requires five same-category expenses from the preceding twelve months.
 */
export function getSpendingAnomalies(
  selectedTransactions: Transaction[],
  allTransactions: Transaction[],
): SpendingAnomalyAnalysis {
  const historyByCategory = new Map<Transaction["category"], Transaction[]>();
  for (const transaction of allTransactions) {
    if (!isExternalExpense(transaction)) continue;
    const group = historyByCategory.get(transaction.category) ?? [];
    group.push(transaction);
    historyByCategory.set(transaction.category, group);
  }
  for (const group of historyByCategory.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date));
  }

  const findDateIndex = (history: Transaction[], date: string): number => {
    let low = 0;
    let high = history.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (history[middle].date < date) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const selectedByMonth = new Map<string, Transaction[]>();
  for (const transaction of selectedTransactions) {
    if (!isExternalExpense(transaction)) continue;
    const month = transaction.date.slice(0, 7);
    const group = selectedByMonth.get(month) ?? [];
    group.push(transaction);
    selectedByMonth.set(month, group);
  }

  const anomalies: SpendingAnomaly[] = [];
  let eligibleTransactions = 0;
  for (const [month, monthTransactions] of selectedByMonth) {
    const [year, monthNumber] = month.split("-").map(Number);
    const baselineStartDate = new Date(Date.UTC(year, monthNumber - 1 - 12, 1)).toISOString().slice(0, 10);
    const monthStartDate = `${month}-01`;
    const targetByCategory = new Map<Transaction["category"], Transaction[]>();
    for (const transaction of monthTransactions) {
      const group = targetByCategory.get(transaction.category) ?? [];
      group.push(transaction);
      targetByCategory.set(transaction.category, group);
    }

    for (const [category, targets] of targetByCategory) {
      const history = historyByCategory.get(category) ?? [];
      const startIndex = findDateIndex(history, baselineStartDate);
      const endIndex = findDateIndex(history, monthStartDate);
      const priorTransactions = history.slice(startIndex, endIndex);
      if (priorTransactions.length < MIN_CATEGORY_HISTORY) continue;
      eligibleTransactions += targets.length;

      const priorAmounts = priorTransactions.map((item) => item.amount);
      const categoryMedian = median(priorAmounts);
      const medianAbsoluteDeviation = median(priorAmounts.map((amount) => Math.abs(amount - categoryMedian)));
      const threshold = categoryMedian + Math.max(categoryMedian, 3 * 1.4826 * medianAbsoluteDeviation);
      for (const transaction of targets) {
        if (transaction.amount <= threshold) continue;
        anomalies.push({
          transactionId: transaction.id,
          date: transaction.date,
          time: transaction.time,
          name: transactionName(transaction),
          category,
          amount: round(transaction.amount),
          categoryMedian: round(categoryMedian),
          threshold: round(threshold),
          priorCategoryTransactions: priorTransactions.length,
          multipleOfMedian: categoryMedian > 0 ? round(transaction.amount / categoryMedian) : 0,
        });
      }
    }
  }

  anomalies.sort((a, b) => b.multipleOfMedian - a.multipleOfMedian || b.date.localeCompare(a.date));
  return {
    items: anomalies.slice(0, MAX_RESULTS),
    anomalyCount: anomalies.length,
    eligibleTransactions,
  };
}
