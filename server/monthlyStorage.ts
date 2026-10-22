import { categoryList, type Transaction } from "../src/types.ts";
import type { R2Bucket } from "./bindings.ts";

export const MAX_MONTHLY_DATASET_BYTES = 8 * 1024 * 1024;
export const MAX_MONTHLY_RECORDS = 50_000;
export const MAX_JSONL_RECORD_BYTES = 64 * 1024;
export const MAX_MONTHLY_SUMMARY_BYTES = 256 * 1024;

export type MonthlyStorageErrorCode =
  | "invalid_scope"
  | "invalid_generation"
  | "invalid_data"
  | "too_large"
  | "corrupt_object"
  | "storage_unavailable";

const storageErrorStatus: Record<MonthlyStorageErrorCode, number> = {
  invalid_scope: 400,
  invalid_generation: 400,
  invalid_data: 400,
  too_large: 413,
  corrupt_object: 500,
  storage_unavailable: 503,
};

export class MonthlyStorageError extends Error {
  readonly status: number;
  readonly code: MonthlyStorageErrorCode;
  constructor(code: MonthlyStorageErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = storageErrorStatus[code];
  }
}

export interface MonthlyStorageScope {
  userEmail: string;
  accountId: string;
  year: number;
  month: number;
}

export interface TransactionOverride {
  id: string;
  operation: "patch" | "delete";
  updatedAt: number;
  patch?: Partial<Transaction>;
}

export interface MonthlyObjectKeys {
  transactions: string;
  summary: string;
  overrides: string;
}

function assertScope(scope: MonthlyStorageScope): void {
  const email = scope.userEmail.trim().toLowerCase();
  if (!email || email.length > 254 || !email.includes("@")) {
    throw new MonthlyStorageError("invalid_scope", "A verified user identity is required.");
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(scope.accountId)) {
    throw new MonthlyStorageError("invalid_scope", "The account reference is invalid.");
  }
  if (!Number.isInteger(scope.year) || scope.year < 1900 || scope.year > 9999) {
    throw new MonthlyStorageError("invalid_scope", "The year is invalid.");
  }
  if (!Number.isInteger(scope.month) || scope.month < 1 || scope.month > 12) {
    throw new MonthlyStorageError("invalid_scope", "The month is invalid.");
  }
}

function assertGeneration(generation: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generation)) {
    throw new MonthlyStorageError("invalid_generation", "The object generation is invalid.");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Object keys are always constructed here from authenticated identity and validated scope values. */
export async function monthlyObjectKeys(
  scope: MonthlyStorageScope,
  generation: string,
): Promise<MonthlyObjectKeys> {
  assertScope(scope);
  assertGeneration(generation);
  const owner = (await sha256Hex(scope.userEmail.trim().toLowerCase())).slice(0, 24);
  const month = String(scope.month).padStart(2, "0");
  const base = `transaction-data/v1/${owner}/accounts/${scope.accountId}/${scope.year}/${month}`;
  return {
    transactions: `${base}/transactions/${generation}.jsonl`,
    summary: `${base}/summary/${generation}.json`,
    overrides: `${base}/overrides/${generation}.jsonl`,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDateInScope(value: string, scope: MonthlyStorageScope): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || Number(match[1]) !== scope.year || Number(match[2]) !== scope.month) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTransaction(value: unknown, scope: MonthlyStorageScope): value is Transaction {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || !value.id || value.id.length > 100) return false;
  if (typeof value.date !== "string" || !validDateInScope(value.date, scope)) return false;
  if (typeof value.description !== "string" || value.description.length > 10_000) return false;
  if (typeof value.amount !== "number" || !Number.isFinite(value.amount) || value.amount < 0) return false;
  if (value.direction !== "income" && value.direction !== "expense") return false;
  if (typeof value.category !== "string" || !(categoryList as readonly string[]).includes(value.category)) return false;
  if (typeof value.source !== "string" || value.source.length > 1_000) return false;
  for (const key of ["internalTransfer", "ownAccountCandidate", "manual", "categoryLocked"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
  }
  if (value.time !== undefined && (typeof value.time !== "string" || value.time.length > 32)) return false;
  if (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 10_000)) return false;
  return true;
}

function isOverride(value: unknown): value is TransactionOverride {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || !value.id || value.id.length > 100) return false;
  if (value.operation !== "patch" && value.operation !== "delete") return false;
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return false;
  if (value.operation === "patch") {
    if (!isPlainObject(value.patch)) return false;
    if (value.patch.id !== undefined && value.patch.id !== value.id) return false;
  } else if (value.patch !== undefined) {
    return false;
  }
  return true;
}

export function serializeJsonl<T>(
  records: readonly T[],
  validate: (record: unknown) => record is T,
  maxBytes = MAX_MONTHLY_DATASET_BYTES,
  maxRecords = MAX_MONTHLY_RECORDS,
): string {
  if (!Array.isArray(records)) throw new MonthlyStorageError("invalid_data", "JSONL records must be a list.");
  if (records.length > maxRecords) throw new MonthlyStorageError("too_large", "The monthly dataset has too many records.");
  const lines: string[] = [];
  let byteLength = 0;
  for (const record of records) {
    if (!validate(record)) throw new MonthlyStorageError("invalid_data", "A JSONL record is not valid.");
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      throw new MonthlyStorageError("invalid_data", "A JSONL record could not be serialized.");
    }
    if (new TextEncoder().encode(line).byteLength > MAX_JSONL_RECORD_BYTES) {
      throw new MonthlyStorageError("too_large", "A JSONL record is too large.");
    }
    byteLength += new TextEncoder().encode(line).byteLength + 1;
    if (byteLength > maxBytes) throw new MonthlyStorageError("too_large", "The monthly object is too large.");
    lines.push(line);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function parseJsonl<T>(
  text: string,
  validate: (record: unknown) => record is T,
  maxBytes = MAX_MONTHLY_DATASET_BYTES,
  maxRecords = MAX_MONTHLY_RECORDS,
): T[] {
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new MonthlyStorageError("too_large", "The monthly object is too large.");
  }
  const records: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (new TextEncoder().encode(line).byteLength > MAX_JSONL_RECORD_BYTES) {
      throw new MonthlyStorageError("corrupt_object", "A stored JSONL record is too large.");
    }
    if (records.length >= maxRecords) {
      throw new MonthlyStorageError("too_large", "The monthly object has too many records.");
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new MonthlyStorageError("corrupt_object", "The stored JSONL object is malformed.");
    }
    if (!validate(value)) throw new MonthlyStorageError("corrupt_object", "The stored JSONL object contains an invalid record.");
    records.push(value);
  }
  return records;
}

async function readBoundedText(bucket: R2Bucket, key: string, maxBytes: number): Promise<string | null> {
  let object;
  try {
    object = await bucket.get(key);
  } catch {
    throw new MonthlyStorageError("storage_unavailable", "R2 could not read the monthly object.");
  }
  if (!object) return null;
  if (!Number.isFinite(object.size) || object.size < 0 || object.size > maxBytes) {
    throw new MonthlyStorageError("too_large", "The stored monthly object exceeds the size limit.");
  }
  const reader = object.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new MonthlyStorageError("too_large", "The stored monthly object exceeds the size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof MonthlyStorageError) throw error;
    throw new MonthlyStorageError("storage_unavailable", "R2 could not read the monthly object.");
  } finally {
    reader.releaseLock();
  }
}

async function writeText(bucket: R2Bucket, key: string, body: string, contentType: string, generation: string): Promise<void> {
  try {
    await bucket.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { generation, format: contentType.startsWith("application/json") ? "spendwise-monthly-summary-v1" : "spendwise-monthly-jsonl-v1" },
    });
  } catch {
    throw new MonthlyStorageError("storage_unavailable", "R2 could not write the monthly object.");
  }
}

export async function saveMonthlyTransactions(
  bucket: R2Bucket,
  scope: MonthlyStorageScope,
  generation: string,
  records: readonly Transaction[],
): Promise<{ count: number; bytes: number }> {
  const keys = await monthlyObjectKeys(scope, generation);
  const body = serializeJsonl(records, (value): value is Transaction => isTransaction(value, scope));
  await writeText(bucket, keys.transactions, body, "application/x-ndjson; charset=utf-8", generation);
  return { count: records.length, bytes: new TextEncoder().encode(body).byteLength };
}

export async function loadMonthlyTransactions(
  bucket: R2Bucket,
  scope: MonthlyStorageScope,
  generation: string,
): Promise<Transaction[] | null> {
  const keys = await monthlyObjectKeys(scope, generation);
  const text = await readBoundedText(bucket, keys.transactions, MAX_MONTHLY_DATASET_BYTES);
  return text === null ? null : parseJsonl(text, (value): value is Transaction => isTransaction(value, scope));
}

export async function saveMonthlySummary(
  bucket: R2Bucket,
  scope: MonthlyStorageScope,
  generation: string,
  summary: Record<string, unknown>,
): Promise<{ bytes: number }> {
  const keys = await monthlyObjectKeys(scope, generation);
  if (!isPlainObject(summary)) throw new MonthlyStorageError("invalid_data", "A monthly summary must be a JSON object.");
  let body: string;
  try {
    body = JSON.stringify(summary);
  } catch {
    throw new MonthlyStorageError("invalid_data", "The monthly summary could not be serialized.");
  }
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > MAX_MONTHLY_SUMMARY_BYTES) throw new MonthlyStorageError("too_large", "The monthly summary is too large.");
  await writeText(bucket, keys.summary, body, "application/json; charset=utf-8", generation);
  return { bytes };
}

export async function loadMonthlySummary(
  bucket: R2Bucket,
  scope: MonthlyStorageScope,
  generation: string,
): Promise<Record<string, unknown> | null> {
  const keys = await monthlyObjectKeys(scope, generation);
  const text = await readBoundedText(bucket, keys.summary, MAX_MONTHLY_SUMMARY_BYTES);
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MonthlyStorageError("corrupt_object", "The stored monthly summary is malformed.");
  }
  if (!isPlainObject(value)) throw new MonthlyStorageError("corrupt_object", "The stored monthly summary is invalid.");
  return value;
}

export async function saveMonthlyOverrides(
  bucket: R2Bucket,
  scope: MonthlyStorageScope,
  generation: string,
  records: readonly TransactionOverride[],
): Promise<{ count: number; bytes: number }> {
  const keys = await monthlyObjectKeys(scope, generation);
  const body = serializeJsonl(records, (value): value is TransactionOverride => isOverride(value));
  await writeText(bucket, keys.overrides, body, "application/x-ndjson; charset=utf-8", generation);
  return { count: records.length, bytes: new TextEncoder().encode(body).byteLength };
}

export async function loadMonthlyOverrides(
  bucket: R2Bucket,
  scope: MonthlyStorageScope,
  generation: string,
): Promise<TransactionOverride[] | null> {
  const keys = await monthlyObjectKeys(scope, generation);
  const text = await readBoundedText(bucket, keys.overrides, MAX_MONTHLY_DATASET_BYTES);
  return text === null ? null : parseJsonl(text, (value): value is TransactionOverride => isOverride(value));
}
