import type { Category, Transaction } from "../types.ts";

export type Period = "30d" | "90d" | "12m" | "all";

export interface Totals {
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
  transactionCount: number;
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
  if (period === "all") return null;
  const start = new Date(now);
  if (period === "30d") start.setDate(start.getDate() - 29);
  if (period === "90d") start.setDate(start.getDate() - 89);
  if (period === "12m") start.setMonth(start.getMonth() - 11, 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function filterByPeriod(transactions: Transaction[], period: Period, now = new Date()): Transaction[] {
  const start = getPeriodStart(period, now);
  return transactions.filter((transaction) => !start || transaction.date >= toIsoDate(start));
}

export function calculateTotals(transactions: Transaction[]): Totals {
  const income = transactions.reduce(
    (total, transaction) => total + (transaction.direction === "income" ? transaction.amount : 0),
    0,
  );
  const expenses = transactions.reduce(
    (total, transaction) => total + (transaction.direction === "expense" ? transaction.amount : 0),
    0,
  );
  return {
    income,
    expenses,
    net: income - expenses,
    savingsRate: income > 0 ? ((income - expenses) / income) * 100 : 0,
    transactionCount: transactions.length,
  };
}

export function getCategoryTotals(transactions: Transaction[]): CategoryTotal[] {
  const map = new Map<Category, { amount: number; count: number }>();
  for (const transaction of transactions) {
    if (transaction.direction !== "expense") continue;
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
    const month = totalsByMonth.get(transaction.date.slice(0, 7));
    if (!month) continue;
    if (transaction.direction === "income") month.income += transaction.amount;
    else month.expenses += transaction.amount;
  }
  return months;
}

export function largestExpense(transactions: Transaction[]): Transaction | undefined {
  return transactions
    .filter((transaction) => transaction.direction === "expense")
    .sort((a, b) => b.amount - a.amount)[0];
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
