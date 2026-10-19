import type { Transaction } from "../types.ts";

/**
 * Wire format for a transaction sent to / received from the cloud API:
 * [id, date, time, description, amount, direction (1 = income), category, source, flags, note]
 */
export type SyncRow = [string, string, string, string, number, 0 | 1, string, string, number, string];

/** A row coming back from the server; `deleted` rows are tombstones. */
export interface ServerRow {
  row: SyncRow;
  deleted: boolean;
  updatedAt: number;
}

export const FLAG_INTERNAL = 1;
export const FLAG_OWN_ACCOUNT = 2;
export const FLAG_MANUAL = 4;
export const FLAG_LOCKED = 8;

export const MAX_ROWS_PER_REQUEST = 2000;
export const COLLECTION_NAMES = ["savingsGoals", "savingsCircles", "bets", "rules", "budgets"] as const;
export type CollectionName = typeof COLLECTION_NAMES[number];

export function toSyncRow(transaction: Transaction): SyncRow {
  const flags = (transaction.internalTransfer ? FLAG_INTERNAL : 0) |
    (transaction.ownAccountCandidate ? FLAG_OWN_ACCOUNT : 0) |
    (transaction.manual ? FLAG_MANUAL : 0) |
    (transaction.categoryLocked ? FLAG_LOCKED : 0);
  return [
    transaction.id,
    transaction.date,
    transaction.time ?? "",
    transaction.description,
    transaction.amount,
    transaction.direction === "income" ? 1 : 0,
    transaction.category,
    transaction.source,
    flags,
    transaction.note ?? "",
  ];
}

export function fromSyncRow(row: SyncRow, isCategory: (value: string) => boolean): Transaction | null {
  if (!isValidSyncRow(row) || !isCategory(row[6])) return null;
  const [id, date, time, description, amount, direction, category, source, flags, note] = row;
  const transaction: Transaction = {
    id,
    date,
    description,
    amount,
    direction: direction === 1 ? "income" : "expense",
    category: category as Transaction["category"],
    source,
  };
  if (time) transaction.time = time;
  if (note) transaction.note = note;
  if (flags & FLAG_INTERNAL) transaction.internalTransfer = true;
  if (flags & FLAG_OWN_ACCOUNT) transaction.ownAccountCandidate = true;
  if (flags & FLAG_MANUAL) transaction.manual = true;
  if (flags & FLAG_LOCKED) transaction.categoryLocked = true;
  return transaction;
}

/** Structural validation shared by the browser and the API. */
export function isValidSyncRow(value: unknown): value is SyncRow {
  if (!Array.isArray(value) || value.length !== 10) return false;
  const [id, date, time, description, amount, direction, category, source, flags, note] = value;
  return (
    typeof id === "string" && id.length > 0 && id.length <= 100 &&
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    typeof time === "string" && (time === "" || /^\d{2}:\d{2}(?::\d{2})?$/.test(time)) &&
    typeof description === "string" && description.length <= 500 &&
    typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount < 1e13 &&
    (direction === 0 || direction === 1) &&
    typeof category === "string" && category.length > 0 && category.length <= 40 &&
    typeof source === "string" && source.length <= 80 &&
    typeof flags === "number" && Number.isInteger(flags) && flags >= 0 && flags < 256 &&
    typeof note === "string" && note.length <= 280
  );
}

/** True when two transactions would serialise to the same row. */
export function sameRow(a: Transaction, b: Transaction): boolean {
  const left = toSyncRow(a);
  const right = toSyncRow(b);
  return left.every((value, index) => value === right[index]);
}
