import { categoryList, type Category, type Transaction } from "../types.ts";

const categories: readonly Category[] = categoryList;
export const TRANSACTIONS_STORAGE_KEY = "spendwise.transactions.v1";
const FORMAT_V1 = "spendwise.transactions.compact.v1";
const FORMAT_V2 = "spendwise.transactions.compact.v2";
const FORMAT_V3 = "spendwise.transactions.compact.v3";

/** [id, date, description, amount, direction, category, source, flags?, time?, note?, rejectedCategory?] */
type CompactRecord = [string, string, string, number, 0 | 1, number, number, number?, string?, string?, number?];

const FLAG_INTERNAL = 1;
const FLAG_OWN_ACCOUNT = 2;
const FLAG_MANUAL = 4;
const FLAG_LOCKED = 8;
const FLAG_INFERRED = 16;

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
    const flags = (transaction.internalTransfer ? FLAG_INTERNAL : 0) |
      (transaction.ownAccountCandidate ? FLAG_OWN_ACCOUNT : 0) |
      (transaction.manual ? FLAG_MANUAL : 0) |
      (transaction.categoryLocked ? FLAG_LOCKED : 0) |
      (transaction.inferred ? FLAG_INFERRED : 0);
    const record: CompactRecord = [
      transaction.id,
      transaction.date,
      transaction.description,
      transaction.amount,
      transaction.direction === "income" ? 1 : 0,
      categoryIndexes.get(transaction.category) ?? categoryIndexes.get("Other")!,
      sourceIndexes.get(transaction.source) ?? 0,
      flags,
    ];
    if (transaction.time || transaction.note || transaction.rejectedSuggestion) record.push(transaction.time ?? "");
    if (transaction.note || transaction.rejectedSuggestion) record.push(transaction.note ?? "");
    if (transaction.rejectedSuggestion) record.push(categoryIndexes.get(transaction.rejectedSuggestion) ?? categoryIndexes.get("Other")!);
    if (!transaction.time && !transaction.note && !transaction.rejectedSuggestion && !flags) record.pop();
    return record;
  });
  return JSON.stringify({ format: FORMAT_V3, sources, categories, records });
}

export type StoredTransactionsStatus = "empty" | "ok" | "corrupt";

export interface StoredTransactionsInspection {
  status: StoredTransactionsStatus;
  transactions: Transaction[];
  /** Records that were present but could not be read. */
  dropped: number;
  /** Human-readable explanation when status is "corrupt". */
  reason?: string;
}

function corrupt(reason: string): StoredTransactionsInspection {
  return { status: "corrupt", transactions: [], dropped: 0, reason };
}

/**
 * Reads saved history without hiding damage. An unreadable value is reported as
 * "corrupt" so the app can stop saving over data the user may still want to recover.
 */
export function inspectStoredTransactions(serialized: string | null): StoredTransactionsInspection {
  if (serialized === null) return { status: "empty", transactions: [], dropped: 0 };

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return corrupt("The saved history is not valid JSON.");
  }

  if (Array.isArray(value)) {
    const transactions = value.filter(isTransaction);
    if (transactions.length === 0) {
      return value.length === 0
        ? { status: "empty", transactions, dropped: 0 }
        : corrupt("The saved history contains no readable transactions.");
    }
    return { status: "ok", transactions, dropped: value.length - transactions.length };
  }

  if (!value || typeof value !== "object") return corrupt("The saved history has an unrecognised shape.");

  const compact = value as {
    format?: unknown;
    sources?: unknown;
    categories?: unknown;
    records?: unknown;
  };
  if (
    (compact.format !== FORMAT_V1 && compact.format !== FORMAT_V2 && compact.format !== FORMAT_V3) ||
    !Array.isArray(compact.sources) ||
    !Array.isArray(compact.categories) ||
    !Array.isArray(compact.records)
  ) {
    return corrupt("The saved history uses an unrecognised format.");
  }

  const sources = compact.sources as string[];
  const storedCategories = compact.categories as string[];
  const validCategories = new Set<string>(categories);
  const transactions: Transaction[] = [];
  let dropped = 0;

  for (const record of compact.records) {
    if (!Array.isArray(record) || record.length < 7) {
      dropped += 1;
      continue;
    }
    const [id, date, description, amount, direction, category, source, flags = 0, time, note, rejectedSuggestion] = record as CompactRecord;
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
      dropped += 1;
      continue;
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
    if (typeof flags === "number") {
      if (flags & FLAG_INTERNAL) transaction.internalTransfer = true;
      if (flags & FLAG_OWN_ACCOUNT) transaction.ownAccountCandidate = true;
      if (flags & FLAG_MANUAL) transaction.manual = true;
      if (flags & FLAG_LOCKED) transaction.categoryLocked = true;
      if (flags & FLAG_INFERRED) transaction.inferred = true;
    }
    if (typeof time === "string" && /^\d{2}:\d{2}(?::\d{2})?$/.test(time)) transaction.time = time;
    if (typeof note === "string" && note.trim()) transaction.note = note.slice(0, 280);
    const rejectedCategory = typeof rejectedSuggestion === "number" ? storedCategories[rejectedSuggestion] : undefined;
    if (typeof rejectedCategory === "string" && validCategories.has(rejectedCategory)) transaction.rejectedSuggestion = rejectedCategory as Category;
    transactions.push(transaction);
  }

  return {
    status: transactions.length === 0 ? "empty" : "ok",
    transactions,
    dropped,
  };
}

/** Convenience wrapper that returns only the readable transactions. */
export function parseStoredTransactions(serialized: string): Transaction[] {
  return inspectStoredTransactions(serialized).transactions;
}
