import type { Category, Transaction } from "../types.ts";

const categories: Category[] = [
  "Income",
  "Food & groceries",
  "Transport",
  "Bills & utilities",
  "Shopping",
  "Transfers",
  "Betting",
  "Bank fees",
  "Health",
  "Entertainment",
  "Education",
  "Other",
];

type CompactRecord = [string, string, string, number, 0 | 1, number, number, number?];

function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Transaction>;
  return (
    typeof item.id === "string" &&
    typeof item.date === "string" &&
    typeof item.description === "string" &&
    typeof item.amount === "number" &&
    (item.direction === "income" || item.direction === "expense") &&
    typeof item.category === "string" &&
    categories.includes(item.category as Category) &&
    typeof item.source === "string"
  );
}

export function serializeTransactions(transactions: Transaction[]): string {
  const sources = [...new Set(transactions.map((transaction) => transaction.source))];
  const sourceIndexes = new Map(sources.map((source, index) => [source, index]));
  const categoryIndexes = new Map(categories.map((category, index) => [category, index]));
  const records: CompactRecord[] = transactions.map((transaction) => {
    const flags = (transaction.internalTransfer ? 1 : 0) | (transaction.ownAccountCandidate ? 2 : 0);
    return [
      transaction.id,
      transaction.date,
      transaction.description,
      transaction.amount,
      transaction.direction === "income" ? 1 : 0,
      categoryIndexes.get(transaction.category) ?? categoryIndexes.get("Other")!,
      sourceIndexes.get(transaction.source) ?? 0,
      flags || undefined,
    ];
  });
  return JSON.stringify({ format: "spendwise.transactions.compact.v1", sources, categories, records });
}

export function parseStoredTransactions(serialized: string): Transaction[] {
  try {
    const value: unknown = JSON.parse(serialized);
    if (Array.isArray(value)) return value.filter(isTransaction);
    if (!value || typeof value !== "object") return [];
    const compact = value as {
      format?: unknown;
      sources?: unknown;
      categories?: unknown;
      records?: unknown;
    };
    if (
      compact.format !== "spendwise.transactions.compact.v1" ||
      !Array.isArray(compact.sources) ||
      !Array.isArray(compact.categories) ||
      !Array.isArray(compact.records)
    ) {
      return [];
    }
    const sources = compact.sources as string[];
    const storedCategories = compact.categories as string[];
    const validCategories = new Set(categories);
    return compact.records.flatMap((record): Transaction[] => {
      if (!Array.isArray(record) || record.length < 7) return [];
      const [id, date, description, amount, direction, category, source, flags = 0] = record as CompactRecord;
      const categoryName = storedCategories[category];
      const sourceName = sources[source];
      if (
        typeof id !== "string" ||
        typeof date !== "string" ||
        typeof description !== "string" ||
        typeof amount !== "number" ||
        (direction !== 0 && direction !== 1) ||
        typeof categoryName !== "string" ||
        !validCategories.has(categoryName as Category) ||
        typeof sourceName !== "string"
      ) {
        return [];
      }
      const transaction: Transaction = {
        id,
        date,
        description,
        amount,
        direction: direction === 1 ? "income" : "expense",
        category: categoryName as Category,
        source: sourceName,
      };
      if (typeof flags === "number" && (flags & 1) !== 0) transaction.internalTransfer = true;
      if (typeof flags === "number" && (flags & 2) !== 0) transaction.ownAccountCandidate = true;
      return [transaction];
    });
  } catch {
    return [];
  }
}
