import { supportedCurrencies, type AccountPreferences, type Transaction } from "../types.ts";

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  accountCurrencies: {},
  displayCurrency: "NGN",
  showConverted: false,
  rates: {},
};

const validCurrencies = new Set<string>(supportedCurrencies);

export function normaliseAccountPreferences(value: unknown): AccountPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_ACCOUNT_PREFERENCES };
  const stored = value as Partial<AccountPreferences>;
  const accountCurrencies: Record<string, string> = {};
  if (stored.accountCurrencies && typeof stored.accountCurrencies === "object") {
    for (const [account, currency] of Object.entries(stored.accountCurrencies)) {
      if (account.trim() && typeof currency === "string" && validCurrencies.has(currency)) accountCurrencies[account.trim().slice(0, 50)] = currency;
    }
  }
  const rates: Record<string, number> = {};
  if (stored.rates && typeof stored.rates === "object") {
    for (const [currency, rate] of Object.entries(stored.rates)) {
      if (validCurrencies.has(currency) && typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[currency] = rate;
    }
  }
  return {
    accountCurrencies,
    displayCurrency: typeof stored.displayCurrency === "string" && validCurrencies.has(stored.displayCurrency) ? stored.displayCurrency : "NGN",
    showConverted: stored.showConverted === true,
    rates,
  };
}

export function accountCurrency(account: string, preferences: AccountPreferences): string {
  return preferences.accountCurrencies[account] ?? "NGN";
}

export function convertAccountAmount(amount: number, currency: string, preferences: AccountPreferences): number | null {
  if (currency === preferences.displayCurrency) return amount;
  const rate = preferences.rates[currency];
  return typeof rate === "number" && rate > 0 ? amount * rate : null;
}

export interface AccountSummary {
  name: string;
  currency: string;
  count: number;
  income: number;
  expenses: number;
  net: number;
  latestDate: string;
}

export function summariseAccounts(transactions: Transaction[], preferences: AccountPreferences): AccountSummary[] {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const rows = groups.get(transaction.source) ?? [];
    rows.push(transaction);
    groups.set(transaction.source, rows);
  }
  // Keep configured accounts visible even before their first transaction.
  for (const account of Object.keys(preferences.accountCurrencies)) if (!groups.has(account)) groups.set(account, []);
  return [...groups.entries()].map(([name, rows]) => {
    const active = rows.filter((transaction) => !transaction.internalTransfer);
    const income = active.filter((transaction) => transaction.direction === "income").reduce((sum, transaction) => sum + transaction.amount, 0);
    const expenses = active.filter((transaction) => transaction.direction === "expense").reduce((sum, transaction) => sum + transaction.amount, 0);
    return {
      name,
      currency: accountCurrency(name, preferences),
      count: rows.length,
      income,
      expenses,
      net: income - expenses,
      latestDate: rows.reduce((latest, transaction) => transaction.date > latest ? transaction.date : latest, ""),
    };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
