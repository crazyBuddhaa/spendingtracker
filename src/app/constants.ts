import type { Period } from "../lib/insights";
import type { Category, Transaction } from "../types";

export type Page = "overview" | "accounts" | "transactions" | "review" | "bills" | "insights" | "recipients" | "budgets" | "savings" | "betting" | "data";

export const pageTitles: Record<Page, string> = {
  overview: "Overview",
  accounts: "Accounts",
  transactions: "Transactions",
  review: "Classification review",
  bills: "Bills & cash flow",
  insights: "Insights",
  recipients: "Recipients",
  budgets: "Budgets",
  savings: "Savings",
  betting: "Betting",
  data: "Data & rules",
};

export const periodOptions: { value: Period; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "12m", label: "Last 12 months" },
  { value: "this-year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom dates…" },
];

export const categoryColors: Record<Category, string> = {
  Income: "#317a60",
  Refunds: "#58a37f",
  "Food & groceries": "#e5aa51",
  Transport: "#8d7bd1",
  "Bills & utilities": "#5da1a0",
  "Airtime & data": "#4f9bd0",
  Shopping: "#e17e73",
  "Rent & housing": "#a7745a",
  Business: "#3f6f8f",
  "Cash withdrawal": "#c9a227",
  Transfers: "#7b8c93",
  Betting: "#d47f57",
  "Bank fees": "#9a8b7a",
  Health: "#c56f91",
  Entertainment: "#5286b6",
  Education: "#b99557",
  Other: "#a6aaa4",
};

export function initialLetter(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || "B";
}

export interface Change {
  text: string;
  direction: "up" | "down" | null;
}

export function relativeChange(current: number, previous: number): Change {
  if (previous === 0) return { text: current === 0 ? "No change" : "Nothing in the previous period", direction: null };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { text: "About the same as previous", direction: null };
  return { text: `${change > 0 ? "+" : ""}${Math.round(change)}% vs previous period`, direction: change > 0 ? "up" : "down" };
}

export function sortNewestFirst(a: Transaction, b: Transaction): number {
  return b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? "");
}