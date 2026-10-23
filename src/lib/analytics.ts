import type { Budget, Category, RecipientProfile, Transaction } from "../types.ts";
import { similarityKey } from "./categorise.ts";
import { resolveTransactionParty } from "./recipientProfiles.ts";

const round = (value: number) => Math.round(value * 100) / 100;

function isSpending(transaction: Transaction): boolean {
  return transaction.direction === "expense" && !transaction.internalTransfer;
}

function isEarning(transaction: Transaction): boolean {
  return transaction.direction === "income" && !transaction.internalTransfer && transaction.category !== "Refunds";
}

/* ---------------------------------------------------------------- fees */

export interface FeeSummary {
  total: number;
  count: number;
  byType: Array<{ label: string; amount: number; count: number }>;
  shareOfSpending: number;
}

export function getFeeSummary(transactions: Transaction[]): FeeSummary {
  const groups = new Map<string, { label: string; amount: number; count: number }>();
  let spending = 0;
  for (const transaction of transactions) {
    if (!isSpending(transaction)) continue;
    spending += transaction.amount;
    if (transaction.category !== "Bank fees") continue;
    const label = transaction.description.split("|")[0].replace(/\s+/g, " ").trim() || "Fee";
    const key = label.toLowerCase();
    const group = groups.get(key) ?? { label, amount: 0, count: 0 };
    group.amount += transaction.amount;
    group.count += 1;
    groups.set(key, group);
  }
  const byType = [...groups.values()].map((group) => ({ ...group, amount: round(group.amount) })).sort((a, b) => b.amount - a.amount);
  const total = round(byType.reduce((sum, group) => sum + group.amount, 0));
  return {
    total,
    count: byType.reduce((sum, group) => sum + group.count, 0),
    byType,
    shareOfSpending: spending > 0 ? (total / spending) * 100 : 0,
  };
}

/* ----------------------------------------------------- payees & payers */

export interface Counterparty {
  key: string;
  name: string;
  count: number;
  amount: number;
  lastDate: string;
  category: Category;
}

/** Who the money goes to (or comes from), using the name in "Transfer to NAME | …" lines or the merchant text. */
export function counterpartyName(description: string): string {
  const transfer = description.match(/^transfer\s+(?:to|from)\s+([^|]+)/i);
  const raw = transfer ? transfer[1] : description.split("|")[0];
  if (/^betting\b/i.test(description)) return `Betting · ${description.split("|").pop()?.trim() ?? ""}`.trim();
  if (/^(?:airtime|mobile data)\b/i.test(description)) return `${description.split("|")[0].trim()} · ${description.split("|").pop()?.trim() ?? ""}`;
  return raw.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").replace(/[\s\-–|,.]+$/, "").trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

export function getTopCounterparties(transactions: Transaction[], direction: "expense" | "income", limit = 10): Counterparty[] {
  const groups = new Map<string, Counterparty>();
  for (const transaction of transactions) {
    if (direction === "expense" ? !isSpending(transaction) : !isEarning(transaction)) continue;
    if (transaction.category === "Bank fees") continue;
    const name = counterpartyName(transaction.description);
    const key = name.toLowerCase();
    if (!key) continue;
    const group = groups.get(key) ?? { key, name, count: 0, amount: 0, lastDate: transaction.date, category: transaction.category };
    group.count += 1;
    group.amount += transaction.amount;
    if (transaction.date > group.lastDate) group.lastDate = transaction.date;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, amount: round(group.amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/* --------------------------------------------------- spending rhythm */

export interface SpendingRhythm {
  days: number;
  dailyAverage: number;
  byWeekday: Array<{ label: string; amount: number; average: number }>;
  busiestWeekday: string | null;
}

export function getSpendingRhythm(transactions: Transaction[], start: string | null, end: string | null): SpendingRhythm {
  const spending = transactions.filter(isSpending);
  const dates = spending.map((transaction) => transaction.date).sort();
  const from = start ?? dates[0];
  const to = end ?? dates[dates.length - 1];
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const totals = labels.map(() => 0);
  const weekdayCounts = labels.map(() => 0);
  let days = 0;
  if (from && to) {
    const cursor = new Date(`${from}T00:00:00`);
    const stop = new Date(`${to}T00:00:00`);
    while (cursor <= stop && days < 20_000) {
      weekdayCounts[cursor.getDay()] += 1;
      days += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  for (const transaction of spending) totals[new Date(`${transaction.date}T00:00:00`).getDay()] += transaction.amount;
  const total = totals.reduce((sum, value) => sum + value, 0);
  const byWeekday = labels.map((label, index) => ({
    label,
    amount: round(totals[index]),
    average: weekdayCounts[index] ? round(totals[index] / weekdayCounts[index]) : 0,
  }));
  const busiest = [...byWeekday].sort((a, b) => b.average - a.average)[0];
  return {
    days,
    dailyAverage: days ? round(total / days) : 0,
    byWeekday,
    busiestWeekday: busiest && busiest.average > 0 ? busiest.label : null,
  };
}

/* -------------------------------------------------- recurring payments */

export interface RecurringPayment {
  key: string;
  name: string;
  category: Category;
  cadence: RecurringCadence;
  occurrences: number;
  typicalAmount: number;
  lastDate: string;
  nextExpected: string;
  monthlyCost: number;
}

export type RecurringCadence = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

export function recurringCadenceLabel(cadence: RecurringCadence): string {
  return {
    weekly: "Weekly",
    fortnightly: "Fortnightly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
  }[cadence];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00`);
  const targetMonth = new Date(value.getFullYear(), value.getMonth() + months, 1);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  const nextDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(value.getDate(), lastDay));
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`;
}

function nextRecurringDate(lastDate: string, cadence: RecurringCadence): string {
  if (cadence === "weekly") return addDays(lastDate, 7);
  if (cadence === "fortnightly") return addDays(lastDate, 14);
  if (cadence === "monthly") return addMonths(lastDate, 1);
  if (cadence === "quarterly") return addMonths(lastDate, 3);
  return addMonths(lastDate, 12);
}

/**
 * Finds payments to the same payee that repeat on a steady weekly-to-yearly rhythm
 * with similar amounts — subscriptions, rent, TV, data plans, and other regular bills.
 */
export function findRecurringPayments(transactions: Transaction[], profiles: RecipientProfile[] = []): RecurringPayment[] {
  const groups = new Map<string, { transactions: Transaction[]; name: string }>();
  for (const transaction of transactions) {
    if (!isSpending(transaction) || transaction.ownAccountCandidate || transaction.category === "Bank fees" || transaction.category === "Betting") continue;
    const party = resolveTransactionParty(transaction.description, profiles);
    const fallbackKey = similarityKey(transaction.description) + (/^(?:airtime|mobile data|tv)\b/i.test(transaction.description)
      ? `|${transaction.description.split("|").pop()?.trim().toLowerCase()}`
      : "");
    const key = party ? `${party.kind}:${party.key}` : fallbackKey;
    const group = groups.get(key) ?? { transactions: [], name: party?.name ?? counterpartyName(transaction.description) };
    group.transactions.push(transaction);
    if (party) group.name = party.name;
    groups.set(key, group);
  }

  const results: RecurringPayment[] = [];
  for (const [key, { transactions: group, name }] of groups) {
    if (group.length < 3) continue;
    // One payment per day is enough to read a rhythm.
    const byDay = new Map<string, number>();
    for (const transaction of group) byDay.set(transaction.date, (byDay.get(transaction.date) ?? 0) + transaction.amount);
    const days = [...byDay.keys()].sort();
    if (days.length < 3) continue;
    const gaps = days.slice(1).map((day, index) =>
      Math.round((new Date(`${day}T00:00:00`).getTime() - new Date(`${days[index]}T00:00:00`).getTime()) / 86_400_000));
    const recentGaps = gaps.slice(-6);
    const gap = median(recentGaps);
    const cadenceConfigs: Array<{
      cadence: RecurringCadence;
      min: number;
      max: number;
      tolerance: number;
      paymentsPerMonth: number;
    }> = [
      { cadence: "weekly", min: 6, max: 8, tolerance: 2, paymentsPerMonth: 52 / 12 },
      { cadence: "fortnightly", min: 12, max: 16, tolerance: 3, paymentsPerMonth: 26 / 12 },
      { cadence: "monthly", min: 26, max: 35, tolerance: 6, paymentsPerMonth: 1 },
      { cadence: "quarterly", min: 80, max: 100, tolerance: 15, paymentsPerMonth: 1 / 3 },
      { cadence: "yearly", min: 330, max: 400, tolerance: 45, paymentsPerMonth: 1 / 12 },
    ];
    const cadenceConfig = cadenceConfigs.find((item) => gap >= item.min && gap <= item.max);
    if (!cadenceConfig) continue;
    const cadence = cadenceConfig.cadence;
    const steady = recentGaps.filter((value) => Math.abs(value - gap) <= cadenceConfig.tolerance).length / recentGaps.length;
    if (steady < 0.6) continue;
    const amounts = days.slice(-6).map((day) => byDay.get(day)!);
    const typicalAmount = median(amounts);
    const similar = amounts.filter((amount) => Math.abs(amount - typicalAmount) <= Math.max(typicalAmount * 0.25, 100)).length / amounts.length;
    if (similar < 0.6) continue;
    const lastDate = days[days.length - 1];
    const lastTransaction = group.filter((transaction) => transaction.date === lastDate).at(-1) ?? group.at(-1)!;
    results.push({
      key,
      name,
      category: lastTransaction.category,
      cadence,
      occurrences: days.length,
      typicalAmount: round(typicalAmount),
      lastDate,
      nextExpected: nextRecurringDate(lastDate, cadence),
      monthlyCost: round(typicalAmount * cadenceConfig.paymentsPerMonth),
    });
  }
  return results.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.monthlyCost - a.monthlyCost);
}

/** Estimate only steady Transport payments, so other categories for the same payee cannot skew the fare. */
export function findRecurringTransportPayments(
  transactions: Transaction[],
  profiles: RecipientProfile[] = [],
): RecurringPayment[] {
  return findRecurringPayments(
    transactions.filter((transaction) => transaction.category === "Transport"),
    profiles,
  );
}

/* ----------------------------------------------------- monthly report */

export interface MonthReportRow {
  month: string;
  income: number;
  spending: number;
  refunds: number;
  net: number;
  fees: number;
  betting: number;
  transactions: number;
  topCategory: Category | null;
}

export function getMonthlyReport(transactions: Transaction[]): MonthReportRow[] {
  const months = new Map<string, MonthReportRow & { categories: Map<Category, number> }>();
  for (const transaction of transactions) {
    if (transaction.internalTransfer) continue;
    const key = transaction.date.slice(0, 7);
    const row = months.get(key) ?? {
      month: key, income: 0, spending: 0, refunds: 0, net: 0, fees: 0, betting: 0, transactions: 0, topCategory: null, categories: new Map(),
    };
    row.transactions += 1;
    if (transaction.direction === "income") {
      if (transaction.category === "Refunds") row.refunds += transaction.amount;
      else row.income += transaction.amount;
    } else {
      row.spending += transaction.amount;
      if (transaction.category === "Bank fees") row.fees += transaction.amount;
      if (transaction.category === "Betting") row.betting += transaction.amount;
      if (transaction.category !== "Transfers") {
        row.categories.set(transaction.category, (row.categories.get(transaction.category) ?? 0) + transaction.amount);
      }
    }
    months.set(key, row);
  }
  return [...months.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map(({ categories, ...row }) => {
      const spending = Math.max(row.spending - row.refunds, 0);
      return {
        ...row,
        income: round(row.income),
        spending: round(spending),
        refunds: round(row.refunds),
        fees: round(row.fees),
        betting: round(row.betting),
        net: round(row.income - spending),
        topCategory: [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      };
    });
}

export function monthlyReportToCsv(rows: MonthReportRow[]): string {
  const header = ["Month", "Income", "Spending (after refunds)", "Refunds", "Net", "Bank fees", "Betting", "Transactions", "Top category"];
  return [
    header.join(","),
    ...rows.map((row) => [
      row.month, row.income.toFixed(2), row.spending.toFixed(2), row.refunds.toFixed(2), row.net.toFixed(2),
      row.fees.toFixed(2), row.betting.toFixed(2), row.transactions, `"${row.topCategory ?? ""}"`,
    ].join(",")),
  ].join("\r\n");
}

/* ------------------------------------------------------------ budgets */

export interface BudgetStatus {
  category: Category;
  limit: number;
  spent: number;
  remaining: number;
  progress: number;
  /** Spending projected to month end at the current pace (only for the month in progress). */
  projected: number | null;
  status: "ok" | "warning" | "over";
}

/** Budget use for one calendar month (YYYY-MM). `today` decides whether the month is still in progress. */
export function getBudgetStatus(transactions: Transaction[], budgets: Budget[], month: string, today = new Date()): BudgetStatus[] {
  const spent = new Map<Category, number>();
  for (const transaction of transactions) {
    if (!isSpending(transaction) || !transaction.date.startsWith(month)) continue;
    spent.set(transaction.category, (spent.get(transaction.category) ?? 0) + transaction.amount);
  }
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const inProgress = today.getFullYear() === year && today.getMonth() === monthIndex;
  const elapsed = inProgress ? today.getDate() : days;
  return budgets
    .filter((budget) => budget.monthlyLimit > 0)
    .map((budget) => {
      const amount = round(spent.get(budget.category) ?? 0);
      const progress = amount / budget.monthlyLimit;
      const projected = inProgress && elapsed > 0 ? round((amount / elapsed) * days) : null;
      return {
        category: budget.category,
        limit: budget.monthlyLimit,
        spent: amount,
        remaining: round(budget.monthlyLimit - amount),
        progress,
        projected,
        status: progress >= 1 ? "over" : progress >= 0.8 || (projected !== null && projected > budget.monthlyLimit) ? "warning" : "ok",
      } satisfies BudgetStatus;
    })
    .sort((a, b) => b.progress - a.progress);
}

/** Average monthly spend per category over the full months in the data, used to suggest budget amounts. */
export function suggestBudget(transactions: Transaction[], category: Category, months = 3, today = new Date()): number {
  let total = 0;
  for (let offset = 1; offset <= months; offset += 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    total += transactions
      .filter((transaction) => isSpending(transaction) && transaction.category === category && transaction.date.startsWith(key))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
  }
  return Math.round(total / months / 100) * 100;
}
