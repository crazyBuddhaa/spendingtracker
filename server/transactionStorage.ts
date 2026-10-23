import type { D1Database, R2Bucket } from "./bindings.ts";
import { isValidSyncRow, MAX_ROWS_PER_REQUEST, type SyncRow } from "../src/lib/syncFormat.ts";

export const MAX_TRANSACTION_SEGMENT_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_RECOVERY = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOMBSTONE_FIELDS = ["1970-01-01", "", "", 0, 0, "Other", "", 0, ""] as const;

export type TransactionStorageErrorCode =
  | "invalid_batch_id"
  | "idempotency_conflict"
  | "invalid_data"
  | "too_large"
  | "storage_unavailable"
  | "corrupt_object";

const errorStatus: Record<TransactionStorageErrorCode, number> = {
  invalid_batch_id: 400,
  idempotency_conflict: 409,
  invalid_data: 400,
  too_large: 413,
  storage_unavailable: 503,
  corrupt_object: 503,
};

export class TransactionStorageError extends Error {
  readonly status: number;
  readonly code: TransactionStorageErrorCode;

  constructor(code: TransactionStorageErrorCode, message: string) {
    super(message);
    this.name = "TransactionStorageError";
    this.code = code;
    this.status = errorStatus[code];
  }
}

interface SegmentEntry {
  id: string;
  deleted: boolean;
  row?: SyncRow;
}

interface TransactionSegment {
  format: "spendwise.transaction-segment.v1";
  batchId: string;
  entries: SegmentEntry[];
}

interface StoredBatch {
  batch_id: string;
  payload_sha256: string;
  sequence: number;
  status: "pending" | "committed";
}

interface TransactionIndexRow {
  id: string;
  updated_at: number;
  deleted: number;
  origin: number;
  batch_id: string | null;
  record_index: number;
  payload_sha256: string | null;
  batch_status: string | null;
  date: string | null;
  time: string | null;
  description: string | null;
  amount: number | null;
  direction: number | null;
  category: string | null;
  source: string | null;
  flags: number | null;
  note: string | null;
}

export interface StoredTransactionPage {
  rows: Array<[SyncRow, 0 | 1, number]>;
  next: string;
  hasMore: boolean;
  serverTime: number;
}

function normaliseEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !normalized.includes("@")) {
    throw new TransactionStorageError("invalid_data", "A verified user identity is required.");
  }
  return normalized;
}

function assertBatchId(batchId: string): void {
  if (!UUID_PATTERN.test(batchId)) {
    throw new TransactionStorageError("invalid_batch_id", "The transaction batch identifier is invalid.");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The caller can choose only a UUID; the identity namespace and R2 key are server-derived. */
export async function transactionSegmentKey(email: string, batchId: string): Promise<string> {
  const normalized = normaliseEmail(email);
  assertBatchId(batchId);
  const owner = (await sha256Hex(normalized)).slice(0, 24);
  return `transaction-data/v2/${owner}/segments/${batchId}.json`;
}

function segmentEntries(upserts: readonly SyncRow[], deletes: readonly string[]): SegmentEntry[] {
  const byId = new Map<string, SegmentEntry>();
  for (const row of upserts) {
    if (!isValidSyncRow(row)) {
      throw new TransactionStorageError("invalid_data", "A transaction record is not valid.");
    }
    byId.set(row[0], { id: row[0], deleted: false, row: [...row] as SyncRow });
  }
  // The established API applies deletes after upserts, so a duplicate id in both
  // lists resolves to a tombstone, matching the previous D1 behavior.
  for (const id of deletes) {
    if (typeof id !== "string" || id.length < 1 || id.length > 100) {
      throw new TransactionStorageError("invalid_data", "A transaction delete is not valid.");
    }
    byId.set(id, { id, deleted: true });
  }
  return [...byId.values()];
}

function parseSegment(value: unknown, batchId: string): TransactionSegment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TransactionStorageError("corrupt_object", "The stored transaction segment is invalid.");
  }
  const candidate = value as Partial<TransactionSegment>;
  if (
    candidate.format !== "spendwise.transaction-segment.v1" ||
    candidate.batchId !== batchId ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length < 1 ||
    candidate.entries.length > MAX_ROWS_PER_REQUEST
  ) {
    throw new TransactionStorageError("corrupt_object", "The stored transaction segment has an unsupported format.");
  }
  const seen = new Set<string>();
  for (const entry of candidate.entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.length > 100 ||
      typeof entry.deleted !== "boolean"
    ) {
      throw new TransactionStorageError("corrupt_object", "The stored transaction segment contains an invalid entry.");
    }
    if (seen.has(entry.id)) {
      throw new TransactionStorageError("corrupt_object", "The stored transaction segment contains duplicate ids.");
    }
    seen.add(entry.id);
    if (entry.deleted) {
      if (entry.row !== undefined) {
        throw new TransactionStorageError("corrupt_object", "A transaction tombstone contains transaction data.");
      }
    } else if (!isValidSyncRow(entry.row) || entry.row[0] !== entry.id) {
      throw new TransactionStorageError("corrupt_object", "The stored transaction segment contains an invalid record.");
    }
  }
  return candidate as TransactionSegment;
}

function makeSegment(batchId: string, entries: SegmentEntry[]): TransactionSegment {
  assertBatchId(batchId);
  const parsed = parseSegment({
    format: "spendwise.transaction-segment.v1",
    batchId,
    entries,
  }, batchId);
  return parsed;
}

async function readSegment(
  bucket: R2Bucket,
  email: string,
  batchId: string,
  expectedHash: string,
): Promise<TransactionSegment | null> {
  const key = await transactionSegmentKey(email, batchId);
  let object;
  try {
    object = await bucket.get(key);
  } catch {
    throw new TransactionStorageError("storage_unavailable", "R2 could not read the transaction segment.");
  }
  if (!object) return null;
  if (!Number.isFinite(object.size) || object.size < 0 || object.size > MAX_TRANSACTION_SEGMENT_BYTES) {
    throw new TransactionStorageError("corrupt_object", "The stored transaction segment exceeds the supported size.");
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
      if (byteLength > MAX_TRANSACTION_SEGMENT_BYTES) {
        await reader.cancel();
        throw new TransactionStorageError("corrupt_object", "The stored transaction segment exceeds the supported size.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof TransactionStorageError) throw error;
    throw new TransactionStorageError("storage_unavailable", "R2 could not read the transaction segment.");
  } finally {
    reader.releaseLock();
  }

  if (await sha256Hex(text) !== expectedHash) {
    throw new TransactionStorageError("corrupt_object", "The stored transaction segment failed its integrity check.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TransactionStorageError("corrupt_object", "The stored transaction segment is malformed.");
  }
  return parseSegment(value, batchId);
}

function manifestUnavailable(): TransactionStorageError {
  return new TransactionStorageError("storage_unavailable", "The transaction store is temporarily unavailable.");
}

async function findBatch(db: D1Database, email: string, batchId: string): Promise<StoredBatch | null> {
  try {
    return await db.prepare(
      `SELECT batch_id, payload_sha256, sequence, status
         FROM transaction_store_batches
        WHERE user_email = ?1 AND batch_id = ?2`,
    ).bind(email, batchId).first<StoredBatch>();
  } catch {
    throw manifestUnavailable();
  }
}

function assertSamePayload(batch: StoredBatch, hash: string): void {
  if (batch.payload_sha256 !== hash) {
    throw new TransactionStorageError(
      "idempotency_conflict",
      "This transaction batch identifier was already used for different changes.",
    );
  }
}

async function reserveBatch(
  db: D1Database,
  email: string,
  batchId: string,
  payloadHash: string,
  upsertCount: number,
  deleteCount: number,
): Promise<StoredBatch> {
  const now = Date.now();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO transaction_store_state (user_email, sequence, clear_sequence, updated_at)
         VALUES (?1, COALESCE((SELECT MAX(updated_at) FROM transactions WHERE user_email = ?1), 0), 0, ?2)
         ON CONFLICT (user_email) DO NOTHING`,
      ).bind(email, now),
      db.prepare(
        `UPDATE transaction_store_state
            SET sequence = MAX(
                  sequence + 1,
                  ?2,
                  COALESCE((SELECT MAX(updated_at) FROM transactions WHERE user_email = ?1), 0) + 1
                ),
                updated_at = MAX(updated_at, ?2)
          WHERE user_email = ?1`,
      ).bind(email, now),
      db.prepare(
        `INSERT INTO transaction_store_batches
           (user_email, batch_id, payload_sha256, sequence, upsert_count, delete_count, status, created_at)
         SELECT ?1, ?2, ?3, sequence, ?4, ?5, 'pending', ?6
           FROM transaction_store_state
          WHERE user_email = ?1`,
      ).bind(email, batchId, payloadHash, upsertCount, deleteCount, now),
    ]);
  } catch {
    // A simultaneous retry may have reserved the same idempotency key first.
    const raced = await findBatch(db, email, batchId);
    if (raced) {
      assertSamePayload(raced, payloadHash);
      return raced;
    }
    throw manifestUnavailable();
  }
  const batch = await findBatch(db, email, batchId);
  if (!batch) throw manifestUnavailable();
  assertSamePayload(batch, payloadHash);
  return batch;
}

async function finalizeBatch(
  db: D1Database,
  email: string,
  batch: StoredBatch,
  segment: TransactionSegment,
): Promise<void> {
  const events = segment.entries.map((entry, recordIndex) => ({
    id: entry.id,
    recordIndex,
    deleted: entry.deleted ? 1 : 0,
  }));
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO transaction_heads (user_email, id, batch_id, record_index, deleted, updated_at)
         SELECT ?1,
                json_extract(incoming.value, '$.id'),
                ?2,
                json_extract(incoming.value, '$.recordIndex'),
                json_extract(incoming.value, '$.deleted'),
                ?3
           FROM json_each(?4) AS incoming
          WHERE true
         ON CONFLICT (user_email, id) DO UPDATE SET
           batch_id = excluded.batch_id,
           record_index = excluded.record_index,
           deleted = excluded.deleted,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > transaction_heads.updated_at`,
      ).bind(email, batch.batch_id, batch.sequence, JSON.stringify(events)),
      db.prepare(
        `UPDATE transaction_store_batches
            SET status = 'committed'
          WHERE user_email = ?1 AND batch_id = ?2 AND status = 'pending'`,
      ).bind(email, batch.batch_id),
    ]);
  } catch {
    throw manifestUnavailable();
  }
}

async function uploadAndVerify(
  bucket: R2Bucket,
  email: string,
  batchId: string,
  body: string,
  hash: string,
): Promise<TransactionSegment> {
  const key = await transactionSegmentKey(email, batchId);
  try {
    await bucket.put(key, body, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { batchId, sha256: hash, format: "spendwise-transaction-segment-v1" },
    });
  } catch {
    throw new TransactionStorageError("storage_unavailable", "R2 could not write the transaction segment.");
  }
  const stored = await readSegment(bucket, email, batchId, hash);
  if (!stored) throw new TransactionStorageError("storage_unavailable", "R2 did not retain the transaction segment.");
  return stored;
}

async function recoverPendingBatches(db: D1Database, bucket: R2Bucket, email: string): Promise<void> {
  let pending: StoredBatch[];
  try {
    const result = await db.prepare(
      `SELECT batch_id, payload_sha256, sequence, status
         FROM transaction_store_batches
        WHERE user_email = ?1 AND status = 'pending'
        ORDER BY sequence
        LIMIT ?2`,
    ).bind(email, MAX_PENDING_RECOVERY).all<StoredBatch>();
    pending = result.results;
  } catch {
    throw manifestUnavailable();
  }

  for (const batch of pending) {
    try {
      const segment = await readSegment(bucket, email, batch.batch_id, batch.payload_sha256);
      if (segment) await finalizeBatch(db, email, batch, segment);
    } catch {
      // Keep an incomplete/corrupt batch pending. It is never exposed as committed
      // data, and a later retry can restore it from its original request.
    }
  }
}

export async function writeTransactionsToR2(
  db: D1Database,
  bucket: R2Bucket,
  email: string,
  batchId: string,
  upserts: readonly SyncRow[],
  deletes: readonly string[],
): Promise<{ updatedAt: number; upserted: number; deleted: number }> {
  const userEmail = normaliseEmail(email);
  assertBatchId(batchId);
  if (!Array.isArray(upserts) || !Array.isArray(deletes)) {
    throw new TransactionStorageError("invalid_data", "Transaction changes must be lists.");
  }
  const entries = segmentEntries(upserts, deletes);
  if (!entries.length) {
    return { updatedAt: Date.now(), upserted: 0, deleted: 0 };
  }

  const segment = makeSegment(batchId, entries);
  const body = JSON.stringify(segment);
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > MAX_TRANSACTION_SEGMENT_BYTES) {
    throw new TransactionStorageError("too_large", "The transaction batch is too large for one R2 segment.");
  }
  const payloadHash = await sha256Hex(body);

  // Recover any object that was written before a failed D1 finalize. Sequence
  // reservations ensure an older recovered batch cannot overwrite newer changes.
  await recoverPendingBatches(db, bucket, userEmail);

  let batch = await findBatch(db, userEmail, batchId);
  if (batch) {
    assertSamePayload(batch, payloadHash);
  } else {
    batch = await reserveBatch(db, userEmail, batchId, payloadHash, upserts.length, deletes.length);
  }

  const verified = await uploadAndVerify(bucket, userEmail, batchId, body, payloadHash);
  if (batch.status !== "committed") await finalizeBatch(db, userEmail, batch, verified);
  return { updatedAt: batch.sequence, upserted: upserts.length, deleted: deletes.length };
}

export async function clearTransactionsInStore(db: D1Database, email: string): Promise<number> {
  const userEmail = normaliseEmail(email);
  const now = Date.now();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO transaction_store_state (user_email, sequence, clear_sequence, updated_at)
         VALUES (?1, COALESCE((SELECT MAX(updated_at) FROM transactions WHERE user_email = ?1), 0), 0, ?2)
         ON CONFLICT (user_email) DO NOTHING`,
      ).bind(userEmail, now),
      db.prepare(
        `UPDATE transaction_store_state
            SET sequence = MAX(
                  sequence + 1,
                  ?2,
                  COALESCE((SELECT MAX(updated_at) FROM transactions WHERE user_email = ?1), 0) + 1
                ),
                clear_sequence = MAX(
                  sequence + 1,
                  ?2,
                  COALESCE((SELECT MAX(updated_at) FROM transactions WHERE user_email = ?1), 0) + 1
                ),
                updated_at = MAX(updated_at, ?2)
          WHERE user_email = ?1`,
      ).bind(userEmail, now),
    ]);
    const state = await db.prepare(
      "SELECT clear_sequence FROM transaction_store_state WHERE user_email = ?1",
    ).bind(userEmail).first<{ clear_sequence: number }>();
    return Number(state?.clear_sequence ?? now);
  } catch (error) {
    if (error instanceof TransactionStorageError) throw error;
    throw manifestUnavailable();
  }
}

function tombstoneRow(id: string): SyncRow {
  return [id, ...TOMBSTONE_FIELDS];
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

export async function listTransactionPage(
  db: D1Database,
  bucket: R2Bucket | undefined,
  email: string,
  after: string,
  limit: number,
): Promise<StoredTransactionPage> {
  const userEmail = normaliseEmail(email);
  const separator = after.indexOf(":");
  const afterTime = Number(separator >= 0 ? after.slice(0, separator) : after) || 0;
  const afterId = separator >= 0 ? after.slice(separator + 1) : "";
  const safeLimit = Math.max(1, Math.min(10_000, Math.floor(limit) || 5000));

  let result: { results: TransactionIndexRow[] };
  try {
    result = await db.prepare(
      `WITH user_state AS (
         SELECT COALESCE(
                  (SELECT clear_sequence FROM transaction_store_state WHERE user_email = ?1),
                  0
                ) AS clear_sequence
       ),
       candidates AS (
         SELECT h.id,
                CASE WHEN h.updated_at <= state.clear_sequence THEN state.clear_sequence ELSE h.updated_at END AS updated_at,
                CASE WHEN h.updated_at <= state.clear_sequence THEN 1 ELSE h.deleted END AS deleted,
                1 AS origin,
                CASE WHEN h.updated_at <= state.clear_sequence OR h.deleted = 1 THEN NULL ELSE h.batch_id END AS batch_id,
                CASE WHEN h.updated_at <= state.clear_sequence OR h.deleted = 1 THEN -1 ELSE h.record_index END AS record_index,
                CASE WHEN h.updated_at <= state.clear_sequence OR h.deleted = 1 THEN NULL ELSE b.payload_sha256 END AS payload_sha256,
                CASE WHEN h.updated_at <= state.clear_sequence OR h.deleted = 1 THEN NULL ELSE b.status END AS batch_status,
                NULL AS date, NULL AS time, NULL AS description, NULL AS amount, NULL AS direction,
                NULL AS category, NULL AS source, NULL AS flags, NULL AS note
           FROM transaction_heads AS h
           CROSS JOIN user_state AS state
           LEFT JOIN transaction_store_batches AS b
             ON b.user_email = h.user_email AND b.batch_id = h.batch_id
          WHERE h.user_email = ?1
         UNION ALL
         SELECT t.id,
                CASE WHEN t.updated_at <= state.clear_sequence THEN state.clear_sequence ELSE t.updated_at END AS updated_at,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN 1 ELSE 0 END AS deleted,
                0 AS origin,
                NULL AS batch_id, -1 AS record_index, NULL AS payload_sha256, NULL AS batch_status,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN '1970-01-01' ELSE t.date END AS date,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN '' ELSE t.time END AS time,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN '' ELSE t.description END AS description,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN 0 ELSE t.amount END AS amount,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN 0 ELSE t.direction END AS direction,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN 'Other' ELSE t.category END AS category,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN '' ELSE t.source END AS source,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN 0 ELSE t.flags END AS flags,
                CASE WHEN t.deleted = 1 OR t.updated_at <= state.clear_sequence THEN '' ELSE t.note END AS note
           FROM transactions AS t
           CROSS JOIN user_state AS state
          WHERE t.user_email = ?1
            AND NOT EXISTS (
              SELECT 1 FROM transaction_heads AS h
               WHERE h.user_email = t.user_email AND h.id = t.id
            )
       )
       SELECT id, updated_at, deleted, origin, batch_id, record_index, payload_sha256, batch_status,
              date, time, description, amount, direction, category, source, flags, note
         FROM candidates
        WHERE updated_at > ?2 OR (updated_at = ?2 AND id > ?3)
        ORDER BY updated_at, id
        LIMIT ?4`,
    ).bind(userEmail, afterTime, afterId, safeLimit + 1).all<TransactionIndexRow>();
  } catch {
    throw manifestUnavailable();
  }

  const page = result.results.slice(0, safeLimit);
  const segmentsToLoad = new Map<string, string>();
  for (const item of page) {
    if (item.origin !== 1 || Number(item.deleted)) continue;
    if (
      !item.batch_id ||
      !item.payload_sha256 ||
      item.batch_status !== "committed" ||
      !Number.isInteger(item.record_index) ||
      item.record_index < 0
    ) {
      throw new TransactionStorageError("storage_unavailable", "The transaction manifest is incomplete.");
    }
    const existingHash = segmentsToLoad.get(item.batch_id);
    if (existingHash && existingHash !== item.payload_sha256) {
      throw new TransactionStorageError("corrupt_object", "The transaction manifest contains conflicting segment hashes.");
    }
    segmentsToLoad.set(item.batch_id, item.payload_sha256);
  }

  const loadedSegments = new Map<string, TransactionSegment>();
  if (segmentsToLoad.size && !bucket) {
    throw new TransactionStorageError("storage_unavailable", "R2 storage is not connected for transaction reads.");
  }
  const segmentEntries = [...segmentsToLoad.entries()];
  const loaded = await mapWithConcurrency(segmentEntries, 16, async ([batchId, hash]) => {
    const segment = await readSegment(bucket!, userEmail, batchId, hash);
    if (!segment) throw new TransactionStorageError("storage_unavailable", "A transaction segment referenced by the manifest is missing.");
    return [batchId, segment] as const;
  });
  for (const [batchId, segment] of loaded) loadedSegments.set(batchId, segment);

  const rows: StoredTransactionPage["rows"] = page.map((item) => {
    const updatedAt = Number(item.updated_at);
    if (Number(item.deleted)) return [tombstoneRow(String(item.id)), 1, updatedAt];
    if (item.origin === 1) {
      const segment = loadedSegments.get(String(item.batch_id));
      const entry = segment?.entries[Number(item.record_index)];
      if (!entry || entry.deleted || entry.id !== item.id || !isValidSyncRow(entry.row)) {
        throw new TransactionStorageError("corrupt_object", "The transaction manifest points to an invalid segment entry.");
      }
      return [entry.row, 0, updatedAt];
    }
    return [[
      String(item.id),
      String(item.date ?? ""),
      String(item.time ?? ""),
      String(item.description ?? ""),
      Number(item.amount),
      Number(item.direction) as 0 | 1,
      String(item.category ?? "Other"),
      String(item.source ?? ""),
      Number(item.flags ?? 0),
      String(item.note ?? ""),
    ], 0, updatedAt];
  });

  const last = page[page.length - 1];
  return {
    rows,
    next: last ? `${Number(last.updated_at)}:${String(last.id)}` : after,
    hasMore: result.results.length > safeLimit,
    serverTime: Date.now(),
  };
}

export async function countActiveTransactions(db: D1Database, email: string): Promise<number> {
  const userEmail = normaliseEmail(email);
  try {
    const result = await db.prepare(
      `WITH user_state AS (
         SELECT COALESCE(
                  (SELECT clear_sequence FROM transaction_store_state WHERE user_email = ?1),
                  0
                ) AS clear_sequence
       )
       SELECT
         (SELECT COUNT(*)
            FROM transactions AS t
            CROSS JOIN user_state AS state
           WHERE t.user_email = ?1
             AND t.deleted = 0
             AND t.updated_at > state.clear_sequence
             AND NOT EXISTS (
               SELECT 1 FROM transaction_heads AS h
                WHERE h.user_email = t.user_email AND h.id = t.id
             ))
         +
         (SELECT COUNT(*)
            FROM transaction_heads AS h
            CROSS JOIN user_state AS state
           WHERE h.user_email = ?1
             AND h.deleted = 0
             AND h.updated_at > state.clear_sequence) AS transactions`,
    ).bind(userEmail).first<{ transactions: number }>();
    return Number(result?.transactions ?? 0);
  } catch {
    throw manifestUnavailable();
  }
}
