import type { Transaction } from "../types.ts";

/** Treats "GTBank", "gtbank (1)" and "GTBank - Copy" as the same statement source. */
function normaliseAccountLabel(source: string): string {
  return source
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/\s+(?:copy|kopie)(?:\s*\d+)?$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transactionKey(transaction: Transaction): string {
  return [
    transaction.date,
    transaction.description.toLowerCase().replace(/\s+/g, " ").trim(),
    transaction.amount.toFixed(2),
    normaliseAccountLabel(transaction.source),
  ].join("|");
}

export function findNewTransactions(existing: Transaction[], imported: Transaction[]): Transaction[] {
  const existingIds = new Set(existing.map((transaction) => transaction.id));
  const existingCounts = new Map<string, number>();
  for (const transaction of existing) {
    const key = transactionKey(transaction);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  const importedCounts = new Map<string, number>();
  const newTransactions: Transaction[] = [];
  for (const transaction of imported) {
    const key = transactionKey(transaction);
    const occurrence = importedCounts.get(key) ?? 0;
    importedCounts.set(key, occurrence + 1);
    if (existingIds.has(transaction.id)) continue;
    existingIds.add(transaction.id);
    if (occurrence < (existingCounts.get(key) ?? 0)) continue;
    newTransactions.push(transaction);
  }
  return newTransactions;
}
