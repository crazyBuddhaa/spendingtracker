import { categoryList, type Category, type Transaction } from "../types.ts";

const categories: readonly Category[] = categoryList;
export const TRANSACTIONS_STORAGE_KEY = "spendwise.transactions.v1";
const FORMAT_V1 = "spendwise.transactions.compact.v1";
const FORMAT_V2 = "spendwise.transactions.compact.v2";

/** [id, date, description, amount, direction, category, source, flags?, time?, note?] */
type CompactRecord = [string, string, string, number, 0 | 1, number, number, number?, string?, string?];

const FLAG_INTERNAL = 1;
const FLAG_OWN_ACCOUNT = 2;
const FLAG_MANUAL = 4;
const FLAG_LOCKED = 8;

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
      (transaction.categoryLocked ? FLAG_LOCKED : 0);
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
    if (transaction.time || transaction.note) record.push(transaction.time ?? "");
    if (transaction.note) record.push(transaction.note);
    if (!transaction.time && !transaction.note && !flags) record.pop();
    return record;
  });
  return JSON.stringify({ format: FORMAT_V2, sources, categories, records });
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
      (compact.format !== FORMAT_V1 && compact.format !== FORMAT_V2) ||
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
      const [id, date, description, amount, direction, category, source, flags = 0, time, note] = record as CompactRecord;
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
      if (typeof flags === "number") {
        if (flags & FLAG_INTERNAL) transaction.internalTransfer = true;
        if (flags & FLAG_OWN_ACCOUNT) transaction.ownAccountCandidate = true;
        if (flags & FLAG_MANUAL) transaction.manual = true;
        if (flags & FLAG_LOCKED) transaction.categoryLocked = true;
      }
      if (typeof time === "string" && /^\d{2}:\d{2}(?::\d{2})?$/.test(time)) transaction.time = time;
      if (typeof note === "string" && note.trim()) transaction.note = note.slice(0, 280);
      return [transaction];
    });
  } catch {
    return [];
  }
}
