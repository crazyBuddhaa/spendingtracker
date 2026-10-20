import { AuthError, authenticate } from "./auth.ts";
import type { D1Database, Env, R2Bucket } from "./bindings.ts";
import { COLLECTION_NAMES, isValidSyncRow, MAX_ROWS_PER_REQUEST, type SyncRow } from "../src/lib/syncFormat.ts";
import type { Transaction } from "../src/types.ts";

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_COLLECTION_BYTES = 1024 * 1024;
const MAX_STATEMENT_BYTES = 25 * 1024 * 1024;
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const DEFAULT_PAGE = 5000;
const MAX_PAGE = 10000;

const statementTypes: Record<string, string> = {
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = "bad_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function requireDb(env: Env): D1Database {
  if (!env.DB) throw new HttpError(503, "The D1 database is not connected. Add a D1 binding named DB to the Pages project.", "not_configured");
  return env.DB;
}

function requireBucket(env: Env): R2Bucket {
  if (!env.STATEMENTS) throw new HttpError(503, "R2 storage is not connected. Add an R2 binding named STATEMENTS to the Pages project.", "not_configured");
  return env.STATEMENTS;
}

async function readJson<T>(request: Request, limit = MAX_JSON_BYTES): Promise<T> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > limit) throw new HttpError(413, "Request is too large.", "too_large");
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, "Request is too large.", "too_large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------ transactions */

async function listTransactions(db: D1Database, email: string, url: URL): Promise<Response> {
  const after = url.searchParams.get("after") ?? "0:";
  const separator = after.indexOf(":");
  const afterTime = Number(separator >= 0 ? after.slice(0, separator) : after) || 0;
  const afterId = separator >= 0 ? after.slice(separator + 1) : "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || DEFAULT_PAGE, 1), MAX_PAGE);
  const { results } = await db.prepare(
    `SELECT id, date, time, description, amount, direction, category, source, flags, note, deleted, updated_at
       FROM transactions
      WHERE user_email = ?1 AND (updated_at > ?2 OR (updated_at = ?2 AND id > ?3))
      ORDER BY updated_at, id
      LIMIT ?4`,
  ).bind(email, afterTime, afterId, limit + 1).all<Record<string, unknown>>();
  const page = results.slice(0, limit);
  const rows = page.map((item) => [
    [item.id, item.date, item.time ?? "", item.description ?? "", Number(item.amount), Number(item.direction), item.category, item.source, Number(item.flags), item.note ?? ""],
    Number(item.deleted) ? 1 : 0,
    Number(item.updated_at),
  ]);
  const last = page[page.length - 1];
  return json({
    rows,
    next: last ? `${Number(last.updated_at)}:${String(last.id)}` : after,
    hasMore: results.length > limit,
    serverTime: Date.now(),
  });
}

async function writeTransactions(db: D1Database, email: string, request: Request): Promise<Response> {
  const body = await readJson<{ upserts?: unknown; deletes?: unknown }>(request);
  const upserts = Array.isArray(body.upserts) ? body.upserts : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  if (upserts.length + deletes.length > MAX_ROWS_PER_REQUEST) {
    throw new HttpError(413, `Send at most ${MAX_ROWS_PER_REQUEST} changes per request.`, "too_large");
  }
  const invalid = upserts.findIndex((row) => !isValidSyncRow(row));
  if (invalid >= 0) throw new HttpError(400, `Transaction ${invalid + 1} in the request is not valid.`);
  if (!deletes.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100)) {
    throw new HttpError(400, "Deletes must be a list of transaction ids.");
  }

  const updatedAt = Date.now();
  const statements = [];
  if (upserts.length) {
    // Allocate a per-user monotonic change stamp inside the write statement. A
    // millisecond timestamp alone can collide across concurrent requests and make
    // lower-sorting IDs invisible behind an incremental cursor.
    statements.push(db.prepare(
      `WITH change_stamp AS (
         SELECT MAX(?2, COALESCE(MAX(updated_at), 0) + 1) AS value
           FROM transactions WHERE user_email = ?1
       )
       INSERT INTO transactions (user_email, id, date, time, description, amount, direction, category, source, flags, note, deleted, updated_at)
       SELECT ?1, json_extract(incoming.value, '$[0]'), json_extract(incoming.value, '$[1]'), json_extract(incoming.value, '$[2]'), json_extract(incoming.value, '$[3]'),
              json_extract(incoming.value, '$[4]'), json_extract(incoming.value, '$[5]'), json_extract(incoming.value, '$[6]'), json_extract(incoming.value, '$[7]'),
              json_extract(incoming.value, '$[8]'), json_extract(incoming.value, '$[9]'), 0, change_stamp.value
         FROM json_each(?3) AS incoming, change_stamp WHERE true
       ON CONFLICT (user_email, id) DO UPDATE SET
         date = excluded.date, time = excluded.time, description = excluded.description, amount = excluded.amount,
         direction = excluded.direction, category = excluded.category, source = excluded.source, flags = excluded.flags,
         note = excluded.note, deleted = 0, updated_at = excluded.updated_at`,
    ).bind(email, updatedAt, JSON.stringify(upserts as SyncRow[])));
  }
  if (deletes.length) {
    // Tombstones keep only the id and change marker so other devices learn about the delete.
    statements.push(db.prepare(
      `WITH change_stamp AS (
         SELECT MAX(?2, COALESCE(MAX(updated_at), 0) + 1) AS value
           FROM transactions WHERE user_email = ?1
       )
       INSERT INTO transactions (user_email, id, date, time, description, amount, direction, category, source, flags, note, deleted, updated_at)
       SELECT ?1, incoming.value, '1970-01-01', '', '', 0, 0, 'Other', '', 0, '', 1, change_stamp.value
         FROM json_each(?3) AS incoming, change_stamp WHERE true
       ON CONFLICT (user_email, id) DO UPDATE SET
         date = '1970-01-01', time = '', description = '', amount = 0, direction = 0,
         category = 'Other', source = '', flags = 0, note = '', deleted = 1, updated_at = excluded.updated_at`,
    ).bind(email, updatedAt, JSON.stringify(deletes)));
  }
  if (statements.length) await db.batch(statements);
  return json({ updatedAt, upserted: upserts.length, deleted: deletes.length });
}

async function clearTransactions(db: D1Database, email: string): Promise<Response> {
  const updatedAt = Date.now();
  await db.prepare(
    `WITH change_stamp AS (
       SELECT MAX(?2, COALESCE(MAX(updated_at), 0) + 1) AS value
         FROM transactions WHERE user_email = ?1
     )
     UPDATE transactions
        SET date = '1970-01-01', time = '', description = '', amount = 0, direction = 0,
            category = 'Other', source = '', flags = 0, note = '', deleted = 1,
            updated_at = (SELECT value FROM change_stamp)
      WHERE user_email = ?1 AND deleted = 0`,
  ).bind(email, updatedAt).run();
  return json({ updatedAt });
}

/* ------------------------------------------------------------- collections */

async function listCollections(db: D1Database, email: string): Promise<Response> {
  const { results } = await db.prepare("SELECT name, data, updated_at FROM collections WHERE user_email = ?1").bind(email).all<Record<string, unknown>>();
  const collections: Record<string, { data: unknown; updatedAt: number }> = {};
  for (const item of results) {
    try {
      collections[String(item.name)] = { data: JSON.parse(String(item.data)), updatedAt: Number(item.updated_at) };
    } catch {
      // Ignore a corrupt document rather than failing the whole sync.
    }
  }
  return json({ collections });
}

async function saveCollection(db: D1Database, email: string, name: string, request: Request): Promise<Response> {
  if (!(COLLECTION_NAMES as readonly string[]).includes(name)) throw new HttpError(404, "Unknown collection.", "not_found");
  const body = await readJson<{ data?: unknown }>(request, MAX_COLLECTION_BYTES);
  if (!Array.isArray(body.data)) throw new HttpError(400, "Collection data must be a list.");
  const updatedAt = Date.now();
  await db.prepare(
    `INSERT INTO collections (user_email, name, data, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (user_email, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).bind(email, name, JSON.stringify(body.data), updatedAt).run();
  return json({ updatedAt });
}

/* -------------------------------------------------------------- statements */

interface StatementRow {
  id: string;
  file_name: string;
  r2_key: string;
  content_type: string;
  size: number;
  sha256: string;
  rows_imported: number;
  uploaded_at: number;
}

function statementJson(row: StatementRow) {
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    size: Number(row.size),
    rowsImported: Number(row.rows_imported),
    uploadedAt: Number(row.uploaded_at),
  };
}

async function listStatements(db: D1Database, email: string): Promise<Response> {
  const { results } = await db.prepare(
    "SELECT * FROM statements WHERE user_email = ?1 ORDER BY uploaded_at DESC",
  ).bind(email).all<StatementRow>();
  return json({ statements: results.map(statementJson) });
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 150);
  return cleaned || "statement";
}

async function uploadStatement(db: D1Database, bucket: R2Bucket, email: string, request: Request, url: URL): Promise<Response> {
  const fileName = safeFileName(url.searchParams.get("name") ?? "");
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = statementTypes[extension];
  if (!contentType) throw new HttpError(415, "Only CSV, Excel (.xls/.xlsx), and PDF statements can be stored.", "unsupported_type");
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_STATEMENT_BYTES) throw new HttpError(413, "Statement files can be at most 25 MB.", "too_large");
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError(400, "The file is empty.");
  if (bytes.byteLength > MAX_STATEMENT_BYTES) throw new HttpError(413, "Statement files can be at most 25 MB.", "too_large");
  const rowsImported = Math.max(0, Math.floor(Number(url.searchParams.get("rows")) || 0));

  const hash = await sha256Hex(bytes);
  const existing = await db.prepare("SELECT * FROM statements WHERE user_email = ?1 AND sha256 = ?2").bind(email, hash).first<StatementRow>();
  if (existing) return json({ statement: statementJson(existing), duplicate: true });

  const id = crypto.randomUUID();
  // Keys use a hash of the email so bucket listings do not expose who owns a file.
  const owner = (await sha256Hex(email)).slice(0, 24);
  const key = `statements/${owner}/${id}`;
  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { fileName, sha256: hash },
  });
  const uploadedAt = Date.now();
  await db.prepare(
    `INSERT INTO statements (user_email, id, file_name, r2_key, content_type, size, sha256, rows_imported, uploaded_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(email, id, fileName, key, contentType, bytes.byteLength, hash, rowsImported, uploadedAt).run();
  return json({
    statement: statementJson({ id, file_name: fileName, r2_key: key, content_type: contentType, size: bytes.byteLength, sha256: hash, rows_imported: rowsImported, uploaded_at: uploadedAt }),
    duplicate: false,
  }, 201);
}

async function findStatement(db: D1Database, email: string, id: string): Promise<StatementRow> {
  const row = await db.prepare("SELECT * FROM statements WHERE user_email = ?1 AND id = ?2").bind(email, id).first<StatementRow>();
  if (!row) throw new HttpError(404, "Statement not found.", "not_found");
  return row;
}

async function downloadStatement(db: D1Database, bucket: R2Bucket, email: string, id: string): Promise<Response> {
  const row = await findStatement(db, email, id);
  const object = await bucket.get(row.r2_key);
  if (!object) throw new HttpError(404, "The stored file is missing from R2.", "not_found");
  return new Response(object.body, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function deleteStatement(db: D1Database, bucket: R2Bucket, email: string, id: string): Promise<Response> {
  const row = await findStatement(db, email, id);
  await bucket.delete(row.r2_key);
  await db.prepare("DELETE FROM statements WHERE user_email = ?1 AND id = ?2").bind(email, id).run();
  return json({ deleted: true });
}

/* --------------------------------------------------------------- backups */

interface BackupRow {
  id: string;
  r2_key: string;
  size: number;
  sha256: string;
  transaction_count: number;
  created_at: number;
}

function backupJson(row: BackupRow) {
  return {
    id: row.id,
    size: Number(row.size),
    transactionCount: Number(row.transaction_count),
    createdAt: Number(row.created_at),
  };
}

function backupTransaction(row: Record<string, unknown>): Transaction {
  const flags = Number(row.flags) || 0;
  const transaction: Transaction = {
    id: String(row.id),
    date: String(row.date),
    description: String(row.description),
    amount: Number(row.amount),
    direction: Number(row.direction) === 1 ? "income" : "expense",
    category: String(row.category) as Transaction["category"],
    source: String(row.source),
  };
  if (typeof row.time === "string" && row.time) transaction.time = row.time;
  if (typeof row.note === "string" && row.note) transaction.note = row.note;
  if (flags & 1) transaction.internalTransfer = true;
  if (flags & 2) transaction.ownAccountCandidate = true;
  if (flags & 4) transaction.manual = true;
  if (flags & 8) transaction.categoryLocked = true;
  return transaction;
}

async function readAllTransactions(db: D1Database, email: string): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  let afterId = "";
  const pageSize = 5000;
  while (true) {
    const { results } = await db.prepare(
      `SELECT id, date, time, description, amount, direction, category, source, flags, note
       FROM transactions
       WHERE user_email = ?1 AND deleted = 0 AND id > ?2
       ORDER BY id
       LIMIT ${pageSize}`,
    ).bind(email, afterId).all<Record<string, unknown>>();
    for (const row of results) transactions.push(backupTransaction(row));
    if (results.length < pageSize) return transactions;
    afterId = String(results[results.length - 1].id);
  }
}

async function readAllCollections(db: D1Database, email: string): Promise<Record<string, unknown[]>> {
  const { results } = await db.prepare(
    "SELECT name, data FROM collections WHERE user_email = ?1",
  ).bind(email).all<{ name: string; data: string }>();
  const collections: Record<string, unknown[]> = {};
  for (const name of COLLECTION_NAMES) collections[name] = [];
  for (const row of results) {
    if (!(COLLECTION_NAMES as readonly string[]).includes(row.name)) continue;
    try {
      const data: unknown = JSON.parse(row.data);
      if (Array.isArray(data)) collections[row.name] = data;
    } catch {
      // Keep an unreadable collection empty rather than aborting a backup.
    }
  }
  return collections;
}

async function listBackups(db: D1Database, email: string): Promise<Response> {
  const { results } = await db.prepare(
    "SELECT id, r2_key, size, sha256, transaction_count, created_at FROM backups WHERE user_email = ?1 ORDER BY created_at DESC",
  ).bind(email).all<BackupRow>();
  return json({ backups: results.map(backupJson) });
}

async function createCloudBackup(db: D1Database, bucket: R2Bucket, email: string): Promise<Response> {
  const [transactions, collections] = await Promise.all([
    readAllTransactions(db, email),
    readAllCollections(db, email),
  ]);
  const createdAt = Date.now();
  const backup = {
    format: "spendwise.backup.v1",
    exportedAt: new Date(createdAt).toISOString(),
    transactions,
    savingsGoals: collections.savingsGoals,
    savingsCircles: collections.savingsCircles,
    bets: collections.bets,
    rules: collections.rules,
    budgets: collections.budgets,
  };
  const body = JSON.stringify(backup);
  const bytes = new TextEncoder().encode(body);
  if (bytes.byteLength > MAX_BACKUP_BYTES) {
    throw new HttpError(413, "This cloud backup is larger than the 25 MB limit.", "too_large");
  }
  const id = crypto.randomUUID();
  const hash = await sha256Hex(body);
  // Hash the account identifier so R2 object paths do not reveal email addresses.
  const owner = (await sha256Hex(email)).slice(0, 24);
  const key = `backups/${owner}/${id}.json`;
  await bucket.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { backupId: id, sha256: hash },
  });
  try {
    await db.prepare(
      `INSERT INTO backups (user_email, id, r2_key, size, sha256, transaction_count, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(email, id, key, bytes.byteLength, hash, transactions.length, createdAt).run();
  } catch (error) {
    await bucket.delete(key).catch(() => undefined);
    throw error;
  }
  return json({ backup: backupJson({ id, r2_key: key, size: bytes.byteLength, sha256: hash, transaction_count: transactions.length, created_at: createdAt }) }, 201);
}

async function findBackup(db: D1Database, email: string, id: string): Promise<BackupRow> {
  const row = await db.prepare(
    "SELECT id, r2_key, size, sha256, transaction_count, created_at FROM backups WHERE user_email = ?1 AND id = ?2",
  ).bind(email, id).first<BackupRow>();
  if (!row) throw new HttpError(404, "Cloud backup not found.", "not_found");
  return row;
}

async function downloadCloudBackup(db: D1Database, bucket: R2Bucket, email: string, id: string): Promise<Response> {
  const row = await findBackup(db, email, id);
  const object = await bucket.get(row.r2_key);
  if (!object) throw new HttpError(404, "The cloud backup is missing from R2.", "not_found");
  const date = new Date(Number(row.created_at)).toISOString().slice(0, 10);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename="spendwise-cloud-backup-${date}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function deleteCloudBackup(db: D1Database, bucket: R2Bucket, email: string, id: string): Promise<Response> {
  const row = await findBackup(db, email, id);
  await bucket.delete(row.r2_key);
  await db.prepare("DELETE FROM backups WHERE user_email = ?1 AND id = ?2").bind(email, id).run();
  return json({ deleted: true });
}

/* ------------------------------------------------------------------ router */

async function route(request: Request, env: Env, email: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method.toUpperCase();

  if (path === "/api/me" && method === "GET") {
    const storage = { database: Boolean(env.DB), files: Boolean(env.STATEMENTS) };
    if (!env.DB) return json({ email, storage, transactions: 0, statements: 0 });
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM transactions WHERE user_email = ?1 AND deleted = 0) AS transactions,
              (SELECT COUNT(*) FROM statements WHERE user_email = ?1) AS statements`,
    ).bind(email).first<{ transactions: number; statements: number }>();
    return json({ email, storage, transactions: Number(counts?.transactions ?? 0), statements: Number(counts?.statements ?? 0) });
  }

  if (path === "/api/auth/start" && method === "GET") {
    return Response.redirect(new URL("/", request.url).toString(), 303);
  }

  if (path === "/api/transactions") {
    const db = requireDb(env);
    if (method === "GET") return listTransactions(db, email, url);
    if (method === "POST") return writeTransactions(db, email, request);
    if (method === "DELETE") return clearTransactions(db, email);
  }

  if (path === "/api/collections" && method === "GET") return listCollections(requireDb(env), email);
  const collection = path.match(/^\/api\/collections\/([A-Za-z]+)$/);
  if (collection && method === "PUT") return saveCollection(requireDb(env), email, collection[1], request);

  if (path === "/api/statements") {
    const db = requireDb(env);
    if (method === "GET") return listStatements(db, email);
    if (method === "POST") return uploadStatement(db, requireBucket(env), email, request, url);
  }
  const statement = path.match(/^\/api\/statements\/([0-9a-f-]{36})$/);
  if (statement) {
    const db = requireDb(env);
    if (method === "GET") return downloadStatement(db, requireBucket(env), email, statement[1]);
    if (method === "DELETE") return deleteStatement(db, requireBucket(env), email, statement[1]);
  }

  if (path === "/api/backups") {
    const db = requireDb(env);
    if (method === "GET") return listBackups(db, email);
    if (method === "POST") return createCloudBackup(db, requireBucket(env), email);
  }
  const backup = path.match(/^\/api\/backups\/([0-9a-f-]{36})$/);
  if (backup) {
    const db = requireDb(env);
    if (method === "GET") return downloadCloudBackup(db, requireBucket(env), email, backup[1]);
    if (method === "DELETE") return deleteCloudBackup(db, requireBucket(env), email, backup[1]);
  }

  throw new HttpError(404, "Not found.", "not_found");
}

/** Entry point for every /api/* request. */
export async function handleApi(request: Request, env: Env, fetcher?: (input: string) => Promise<Response>): Promise<Response> {
  try {
    const email = await authenticate(request, env, fetcher);
    return await route(request, env, email);
  } catch (error) {
    if (error instanceof AuthError) {
      return json({ error: error.message, code: error.status === 503 ? "not_configured" : "unauthorized" }, error.status);
    }
    if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
    console.error("Spendwise API error", error);
    return json({ error: "Something went wrong on the server.", code: "server_error" }, 500);
  }
}
