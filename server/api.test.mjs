import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { handleApi } from "./api.ts";
import { clearKeyCache } from "./auth.ts";
import { createFakeAccess, createFakeD1, createFakeR2 } from "./testing.mjs";
import { isStorageProviderAvailable, STORAGE_PROVIDER_STATUS } from "../src/lib/storagePreferences.ts";

const row = (id, overrides = {}) => {
  const base = [id, "2026-09-01", "10:00:00", `Payment ${id}`, 100, 0, "Shopping", "OPay Wallet", 0, ""];
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
  return base;
};

describe("Cloudflare API", () => {
  let access;
  let env;
  let token;

  beforeEach(async () => {
    clearKeyCache();
    access = await createFakeAccess();
    env = { ...access.env, DB: createFakeD1(), STATEMENTS: createFakeR2() };
    token = await access.sign({ email: "Owner@Example.com" });
  });

  const call = (path, init = {}, headers = { "Cf-Access-Jwt-Assertion": token }) =>
    handleApi(new Request(`https://spend.example.com${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }), env, access.fetcher);

  describe("authentication", () => {
    it("accepts a valid Access token and lower-cases the email", async () => {
      const response = await call("/api/me");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { email: "owner@example.com", storage: { database: true, files: true }, transactions: 0, statements: 0 });
    });

    it("also reads the CF_Authorization cookie", async () => {
      const response = await call("/api/me", {}, { Cookie: `theme=x; CF_Authorization=${token}` });
      assert.equal(response.status, 200);
    });

    it("rejects missing, tampered, expired, wrong-audience and wrong-issuer tokens", async () => {
      assert.equal((await call("/api/me", {}, {})).status, 401);
      const [header, payload, signature] = token.split(".");
      const tampered = `${header}.${Buffer.from(JSON.stringify({ email: "attacker@example.com", aud: [access.aud], iss: access.team, exp: 9e9 })).toString("base64url")}.${signature}`;
      assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": tampered })).status, 401);
      assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": await access.sign({ email: "a@b.c", exp: 1000 }) })).status, 401);
      assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": await access.sign({ email: "a@b.c", aud: ["other"] }) })).status, 401);
      assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": await access.sign({ email: "a@b.c", iss: "https://evil.cloudflareaccess.com" }) })).status, 401);
      assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": await access.sign({ email: "a@b.c" }, "unknown-kid") })).status, 401);
      assert.equal(payload.length > 0, true);
    });

    it("fails closed when Access is not configured, except for a localhost developer identity", async () => {
      const open = { DB: env.DB, STATEMENTS: env.STATEMENTS, DEV_USER_EMAIL: "dev@local" };
      const remote = await handleApi(new Request("https://spend.example.com/api/me"), open);
      assert.equal(remote.status, 503);
      const local = await handleApi(new Request("http://localhost:8788/api/me"), open);
      assert.equal(local.status, 200);
      assert.equal((await local.json()).email, "dev@local");
    });

    it("reports missing bindings instead of crashing", async () => {
      env = { ...access.env };
      assert.equal((await call("/api/me")).status, 200);
      const response = await call("/api/transactions");
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "not_configured");
    });

    it("starts Cloudflare Access login without requiring an existing token", async () => {
      const response = await call("/api/auth/start", {}, {});
      assert.equal(response.status, 302);
      const location = new URL(response.headers.get("Location"));
      assert.equal(location.origin, access.team);
      assert.equal(location.pathname, "/cdn-cgi/access/login/spend.example.com");
      assert.equal(location.searchParams.get("kid"), access.aud);
      assert.equal(location.searchParams.get("redirect_url"), "/");
    });

    it("does not start Access login when its required settings are missing", async () => {
      const response = await handleApi(
        new Request("https://spend.example.com/api/auth/start"),
        { DB: env.DB, STATEMENTS: env.STATEMENTS },
      );
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "not_configured");
    });
  });

  describe("storage preferences", () => {
    const defaultPreference = {
      schemaVersion: 1,
      provider: "spendwise-managed",
      automaticBackupsEnabled: false,
    };
    const putPreference = (preference, headers) => call(
      "/api/storage-preferences",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: typeof preference === "string" ? preference : JSON.stringify(preference),
      },
      headers,
    );

    it("requires authentication for reads and updates", async () => {
      const get = await call("/api/storage-preferences", {}, {});
      const put = await putPreference(defaultPreference, {});
      assert.equal(get.status, 401);
      assert.equal(put.status, 401);
    });

    it("returns the managed default without writing a row when none exists", async () => {
      const response = await call("/api/storage-preferences");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { preference: defaultPreference });
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM storage_preferences").get().count, 0);
      assert.equal(defaultPreference.automaticBackupsEnabled, false);
      assert.equal(STORAGE_PROVIDER_STATUS["google-sheets"], "not-connected");
      assert.equal(isStorageProviderAvailable("google-sheets"), false);
    });

    it("saves and retrieves validated preferences for each authenticated user", async () => {
      const savedForOwner = {
        schemaVersion: 1,
        provider: "google-sheets",
        automaticBackupsEnabled: true,
      };
      const put = await putPreference(savedForOwner);
      assert.equal(put.status, 200);
      assert.deepEqual(await put.json(), { preference: savedForOwner });

      const ownerRow = env.DB.raw.prepare(
        "SELECT user_email, schema_version, provider, automatic_backups_enabled, created_at, updated_at FROM storage_preferences",
      ).get();
      assert.equal(ownerRow.user_email, "owner@example.com");
      assert.equal(ownerRow.schema_version, 1);
      assert.equal(ownerRow.provider, "google-sheets");
      assert.equal(ownerRow.automatic_backups_enabled, 1);
      assert.equal(ownerRow.created_at, ownerRow.updated_at);

      const otherToken = await access.sign({ email: "someone@else.com" });
      const otherHeaders = { "Cf-Access-Jwt-Assertion": otherToken };
      const otherDefault = await call("/api/storage-preferences", {}, otherHeaders);
      assert.deepEqual(await otherDefault.json(), { preference: defaultPreference });

      const savedForOther = {
        schemaVersion: 1,
        provider: "spendwise-managed",
        automaticBackupsEnabled: true,
      };
      assert.equal((await putPreference(savedForOther, otherHeaders)).status, 200);
      assert.deepEqual(
        await (await call("/api/storage-preferences", {}, otherHeaders)).json(),
        { preference: savedForOther },
      );
      assert.deepEqual(
        await (await call("/api/storage-preferences")).json(),
        { preference: savedForOwner },
      );
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM storage_preferences").get().count, 2);
    });

    it("does not allow a client-supplied identity in the query or preference body", async () => {
      const otherToken = await access.sign({ email: "someone@else.com" });
      const otherPreference = {
        schemaVersion: 1,
        provider: "spendwise-managed",
        automaticBackupsEnabled: true,
      };
      const otherHeaders = { "Cf-Access-Jwt-Assertion": otherToken };
      assert.equal((await putPreference(otherPreference, otherHeaders)).status, 200);

      const readOther = await call("/api/storage-preferences?userId=someone-else");
      assert.equal(readOther.status, 400);
      const overwriteOther = await putPreference({ ...otherPreference, userId: "someone-else" });
      assert.equal(overwriteOther.status, 400);
      const overwriteByEmail = await putPreference({ ...otherPreference, userEmail: "someone@else.com" });
      assert.equal(overwriteByEmail.status, 400);
      assert.deepEqual(
        await (await call("/api/storage-preferences", {}, otherHeaders)).json(),
        { preference: otherPreference },
      );
      assert.deepEqual(
        await (await call("/api/storage-preferences")).json(),
        { preference: defaultPreference },
      );
    });

    it("rejects unsupported providers, versions, and unexpected fields", async () => {
      const invalid = [
        { ...defaultPreference, provider: "direct-r2" },
        { ...defaultPreference, schemaVersion: 2 },
        { ...defaultPreference, accessToken: "not-a-real-token" },
      ];
      for (const preference of invalid) {
        const response = await putPreference(preference);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "invalid_storage_preference");
      }
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM storage_preferences").get().count, 0);
    });

    it("handles malformed and oversized JSON without saving", async () => {
      const malformed = await putPreference("{not-json");
      assert.equal(malformed.status, 400);
      const oversized = await putPreference(" ".repeat(1025));
      assert.equal(oversized.status, 413);
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM storage_preferences").get().count, 0);
    });

    it("returns a generic error when D1 fails", async () => {
      env.DB = {
        prepare() {
          throw new Error("Internal SQL schema details");
        },
      };
      const response = await call("/api/storage-preferences");
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "Storage preferences are unavailable.",
        code: "storage_unavailable",
      });
    });

    it("rejects methods other than GET and PUT", async () => {
      const response = await call("/api/storage-preferences", { method: "DELETE" });
      assert.equal(response.status, 405);
    });
  });

  describe("transactions", () => {
    const post = (body, batchId, headers = {}) => call("/api/transactions", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...(batchId ? { "Idempotency-Key": batchId } : {}),
        ...headers,
      },
    });

    it("upserts, pages by cursor, updates, and tombstones deletes", async () => {
      const rows = Array.from({ length: 25 }, (_, index) => row(`t${String(index).padStart(2, "0")}`));
      assert.equal((await post({ upserts: rows })).status, 200);
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 0, "new transaction payloads are not stored in D1");
      assert.equal(env.STATEMENTS.objects.size, 1, "one batched write creates one R2 segment");

      const first = await (await call("/api/transactions?limit=10")).json();
      assert.equal(first.rows.length, 10);
      assert.equal(first.hasMore, true);
      assert.deepEqual(first.rows[0][0], rows[0]);
      const second = await (await call(`/api/transactions?limit=10&after=${encodeURIComponent(first.next)}`)).json();
      const third = await (await call(`/api/transactions?limit=10&after=${encodeURIComponent(second.next)}`)).json();
      assert.equal(second.rows.length + third.rows.length, 15);
      assert.equal(third.hasMore, false);

      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal((await post({ upserts: [row("t03", { 6: "Business", 9: "edited" })], deletes: ["t04"] })).status, 200);
      const changes = await (await call(`/api/transactions?after=${encodeURIComponent(third.next)}`)).json();
      assert.equal(changes.rows.length, 2);
      const edited = changes.rows.find((item) => item[0][0] === "t03");
      const removed = changes.rows.find((item) => item[0][0] === "t04");
      assert.equal(edited[0][6], "Business");
      assert.equal(edited[0][9], "edited");
      assert.equal(removed[1], 1);
      assert.deepEqual(removed[0].slice(1), ["1970-01-01", "", "", 0, 0, "Other", "", 0, ""], "deleted rows retain no transaction details");

      const me = await (await call("/api/me")).json();
      assert.equal(me.transactions, 24);
    });

    it("serves unmigrated D1 rows until an R2 head supersedes them", async () => {
      env.DB.raw.prepare(
        `INSERT INTO transactions
           (user_email, id, date, time, description, amount, direction, category, source, flags, note, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run("owner@example.com", "legacy-row", "2026-09-01", "10:00:00", "Legacy purchase", 100, 0, "Shopping", "OPay", 2, "legacy note", 10);

      const before = await (await call("/api/transactions")).json();
      assert.equal(before.rows.length, 1);
      assert.equal(before.rows[0][0][3], "Legacy purchase");

      const edited = await post({ upserts: [row("legacy-row", { 3: "R2 edit", 9: "new note" })] });
      assert.equal(edited.status, 200);
      const legacyRecord = env.DB.raw.prepare(
        "SELECT description, note FROM transactions WHERE user_email = ? AND id = ?",
      ).get("owner@example.com", "legacy-row");
      assert.deepEqual({ ...legacyRecord }, { description: "Legacy purchase", note: "legacy note" });

      const after = await (await call("/api/transactions")).json();
      assert.equal(after.rows.length, 1);
      assert.equal(after.rows[0][0][3], "R2 edit");
      assert.equal(after.rows[0][0][9], "new note");
      assert.equal((await (await call("/api/me")).json()).transactions, 1);
    });

    it("authenticates before transaction reads or writes", async () => {
      const read = await call("/api/transactions", {}, {});
      const write = await call("/api/transactions", {
        method: "POST",
        body: JSON.stringify({ upserts: [row("unauthorized")] }),
        headers: { "Content-Type": "application/json" },
      }, {});
      assert.equal(read.status, 401);
      assert.equal(write.status, 401);
      assert.equal(env.STATEMENTS.objects.size, 0);
    });

    it("keeps legacy D1 reads available but refuses new writes without the R2 binding", async () => {
      env.DB.raw.prepare(
        `INSERT INTO transactions
           (user_email, id, date, time, description, amount, direction, category, source, flags, note, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run("owner@example.com", "legacy-only", "2026-09-01", "", "Legacy", 100, 0, "Shopping", "OPay", 0, "", 10);
      env.STATEMENTS = undefined;

      const read = await call("/api/transactions");
      assert.equal(read.status, 200);
      assert.equal((await read.json()).rows[0][0][0], "legacy-only");
      const write = await post({ upserts: [row("needs-r2")] });
      assert.equal(write.status, 503);
      assert.equal((await write.json()).code, "not_configured");
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 1);
    });

    it("does not skip lower-sorting IDs written in the same millisecond", async () => {
      const realNow = Date.now;
      const fixedNow = realNow();
      Date.now = () => fixedNow;
      try {
        await post({ upserts: [row("z")] });
        const first = await (await call("/api/transactions?limit=1")).json();
        await post({ upserts: [row("a")] });
        const next = await (await call(`/api/transactions?after=${encodeURIComponent(first.next)}`)).json();
        assert.deepEqual(next.rows.map(([transaction]) => transaction[0]), ["a"]);
      } finally {
        Date.now = realNow;
      }
    });

    it("keeps each user's data separate", async () => {
      await post({ upserts: [row("shared-id")] });
      const otherToken = await access.sign({ email: "someone@else.com" });
      const otherHeaders = { "Cf-Access-Jwt-Assertion": otherToken };
      const otherBefore = await (await call("/api/transactions", {}, otherHeaders)).json();
      assert.equal(otherBefore.rows.length, 0);
      const otherWrite = await call("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "00000000-0000-4000-8000-000000000011" },
        body: JSON.stringify({ userId: "owner@example.com", upserts: [row("shared-id", { 3: "Other user's payment" })] }),
      }, otherHeaders);
      assert.equal(otherWrite.status, 200);
      const ownerRows = await (await call("/api/transactions")).json();
      const otherRows = await (await call("/api/transactions", {}, otherHeaders)).json();
      assert.equal(ownerRows.rows[0][0][3], "Payment shared-id");
      assert.equal(otherRows.rows[0][0][3], "Other user's payment");
      const ownerPrefix = [...env.STATEMENTS.objects.keys()].find((key) => key.startsWith("transaction-data/v2/"));
      assert.ok(ownerPrefix);
      assert.equal(new Set([...env.STATEMENTS.objects.keys()].map((key) => key.split("/")[2])).size, 2);
    });

    it("validates rows and batch size", async () => {
      assert.equal((await post({ upserts: [["x"]] })).status, 400);
      assert.equal((await post({ upserts: [row("x", { 4: -5 })] })).status, 400);
      assert.equal((await post({ deletes: [5] })).status, 400);
      assert.equal((await post({ upserts: [row("x")] }, "not-a-uuid")).status, 400);
      assert.equal((await post({ upserts: Array.from({ length: 2001 }, (_, index) => row(`r${index}`)) })).status, 413);
      const ok = await post({ upserts: Array.from({ length: 2000 }, (_, index) => row(`r${index}`)) });
      assert.equal(ok.status, 200);
      assert.equal(env.STATEMENTS.objects.size, 1);
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 0);
    });

    it("clears everything as tombstones", async () => {
      await post({ upserts: [row("a"), row("b")] });
      assert.equal((await call("/api/transactions", { method: "DELETE" })).status, 200);
      const all = await (await call("/api/transactions")).json();
      assert.deepEqual(all.rows.map((item) => item[1]), [1, 1]);
      assert.ok(all.rows.every(([transaction]) => transaction.slice(1).every((value, index) =>
        value === ["1970-01-01", "", "", 0, 0, "Other", "", 0, ""][index],
      )));
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 0);
      assert.equal((await (await call("/api/me")).json()).transactions, 0);
    });

    it("makes same-key retries idempotent and rejects key reuse with different data", async () => {
      const batchId = "00000000-0000-4000-8000-000000000012";
      const body = { upserts: [row("retry", { 9: "same payload" })] };
      const first = await post(body, batchId);
      const firstResult = await first.json();
      const retry = await post(body, batchId);
      const retryResult = await retry.json();
      assert.equal(first.status, 200);
      assert.equal(retry.status, 200);
      assert.equal(retryResult.updatedAt, firstResult.updatedAt);
      assert.equal(env.STATEMENTS.objects.size, 1);
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transaction_store_batches").get().count, 1);

      const conflict = await post({ upserts: [row("retry", { 9: "different payload" })] }, batchId);
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).code, "idempotency_conflict");
    });

    it("leaves failed R2 writes pending and safely completes the same retry", async () => {
      const batchId = "00000000-0000-4000-8000-000000000013";
      const put = env.STATEMENTS.put;
      env.STATEMENTS.put = async () => { throw new Error("simulated R2 outage"); };
      const failed = await post({ upserts: [row("retry-after-failure")] }, batchId);
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).code, "storage_unavailable");
      assert.equal(env.DB.raw.prepare("SELECT status FROM transaction_store_batches").get().status, "pending");
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 0);

      env.STATEMENTS.put = put;
      const retried = await post({ upserts: [row("retry-after-failure")] }, batchId);
      assert.equal(retried.status, 200);
      const page = await (await call("/api/transactions")).json();
      assert.equal(page.rows[0][0][0], "retry-after-failure");
      assert.equal(env.DB.raw.prepare("SELECT status FROM transaction_store_batches").get().status, "committed");
    });

    it("recovers an R2 object when the D1 manifest finalize was interrupted", async () => {
      const db = env.DB;
      const batch = db.batch.bind(db);
      let batchCalls = 0;
      env.DB = {
        ...db,
        batch: async (statements) => {
          batchCalls += 1;
          if (batchCalls === 2) throw new Error("simulated D1 finalize outage");
          return batch(statements);
        },
      };
      const interrupted = await post(
        { upserts: [row("manifest-recovery")] },
        "00000000-0000-4000-8000-000000000014",
      );
      assert.equal(interrupted.status, 503);
      assert.equal(env.DB.raw.prepare("SELECT status FROM transaction_store_batches").get().status, "pending");
      assert.equal(env.STATEMENTS.objects.size, 1, "the immutable object was written before the interrupted finalize");

      env.DB = db;
      const nextWrite = await post(
        { upserts: [row("after-recovery")] },
        "00000000-0000-4000-8000-000000000015",
      );
      assert.equal(nextWrite.status, 200);
      const page = await (await call("/api/transactions")).json();
      assert.deepEqual(page.rows.map(([transaction]) => transaction[0]).sort(), ["after-recovery", "manifest-recovery"]);
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transaction_store_batches WHERE status = 'committed'").get().count, 2);
    });

    it("orders concurrent same-id updates by the reserved manifest sequence", async () => {
      const [left, right] = await Promise.all([
        post({ upserts: [row("racing", { 3: "left" })] }, "00000000-0000-4000-8000-000000000016"),
        post({ upserts: [row("racing", { 3: "right" })] }, "00000000-0000-4000-8000-000000000017"),
      ]);
      assert.equal(left.status, 200);
      assert.equal(right.status, 200);
      const [leftBody, rightBody] = await Promise.all([left.json(), right.json()]);
      const expected = leftBody.updatedAt > rightBody.updatedAt ? "left" : "right";
      const page = await (await call("/api/transactions")).json();
      assert.equal(page.rows.find(([transaction]) => transaction[0] === "racing")[0][3], expected);
      assert.equal(
        env.DB.raw.prepare("SELECT updated_at FROM transaction_heads WHERE user_email = ? AND id = ?")
          .get("owner@example.com", "racing").updated_at,
        Math.max(leftBody.updatedAt, rightBody.updatedAt),
      );
    });

    it("paginates large histories while storing one R2 object per write batch", async () => {
      const records = Array.from({ length: 10_050 }, (_, index) => row(`large-${String(index).padStart(5, "0")}`));
      for (let offset = 0, batchNumber = 20; offset < records.length; offset += 2000, batchNumber += 1) {
        const batchId = `00000000-0000-4000-8000-${String(batchNumber).padStart(12, "0")}`;
        const response = await post({ upserts: records.slice(offset, offset + 2000) }, batchId);
        assert.equal(response.status, 200);
      }
      assert.equal(env.STATEMENTS.objects.size, 6);
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 0);

      let after = "0:";
      let count = 0;
      for (;;) {
        const page = await (await call(`/api/transactions?limit=5000&after=${encodeURIComponent(after)}`)).json();
        count += page.rows.length;
        if (!page.hasMore) break;
        after = page.next;
      }
      assert.equal(count, records.length);
      assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS count FROM transaction_heads").get().count, records.length);
    });

    it("fails closed rather than returning an empty history when a manifest object is missing", async () => {
      await post({ upserts: [row("missing-segment")] });
      const key = [...env.STATEMENTS.objects.keys()].find((value) => value.startsWith("transaction-data/v2/"));
      env.STATEMENTS.objects.delete(key);
      const response = await call("/api/transactions");
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "storage_unavailable");
    });
  });

  describe("collections", () => {
    it("stores whitelisted collections per user", async () => {
      const put = await call("/api/collections/budgets", { method: "PUT", body: JSON.stringify({ data: [{ category: "Betting", monthlyLimit: 5000 }] }) });
      assert.equal(put.status, 200);
      assert.equal((await call("/api/collections/passwords", { method: "PUT", body: JSON.stringify({ data: [] }) })).status, 404);
      assert.equal((await call("/api/collections/rules", { method: "PUT", body: JSON.stringify({ data: "nope" }) })).status, 400);
      const { collections } = await (await call("/api/collections")).json();
      assert.deepEqual(collections.budgets.data, [{ category: "Betting", monthlyLimit: 5000 }]);
    });
  });

  describe("statement files in R2", () => {
    const upload = (name, body, rows = 10) => call(`/api/statements?name=${encodeURIComponent(name)}&rows=${rows}`, { method: "POST", body });

    it("uploads, de-duplicates, lists, downloads, and deletes", async () => {
      const created = await upload("OPay statement.xlsx", new Uint8Array([1, 2, 3, 4]));
      assert.equal(created.status, 201);
      const { statement } = await created.json();
      assert.equal(statement.fileName, "OPay statement.xlsx");
      assert.equal(statement.rowsImported, 10);
      const [key] = [...env.STATEMENTS.objects.keys()];
      assert.match(key, /^statements\/[0-9a-f]{24}\/[0-9a-f-]{36}$/);
      assert.ok(!key.includes("owner"), "R2 keys do not contain the email");

      const again = await (await upload("copy.xlsx", new Uint8Array([1, 2, 3, 4]))).json();
      assert.equal(again.duplicate, true);
      assert.equal(env.STATEMENTS.objects.size, 1);

      const list = await (await call("/api/statements")).json();
      assert.equal(list.statements.length, 1);

      const download = await call(`/api/statements/${statement.id}`);
      assert.equal(download.status, 200);
      assert.match(download.headers.get("Content-Disposition"), /OPay%20statement\.xlsx/);
      assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [1, 2, 3, 4]);

      const otherToken = await access.sign({ email: "someone@else.com" });
      assert.equal((await call(`/api/statements/${statement.id}`, {}, { "Cf-Access-Jwt-Assertion": otherToken })).status, 404);

      assert.equal((await call(`/api/statements/${statement.id}`, { method: "DELETE" })).status, 200);
      assert.equal(env.STATEMENTS.objects.size, 0);
      assert.equal((await (await call("/api/statements")).json()).statements.length, 0);
    });

    it("only accepts statement file types", async () => {
      assert.equal((await upload("evil.html", "<script>")).status, 415);
      assert.equal((await upload("empty.csv", "")).status, 400);
    });
  });

  describe("account backups in R2", () => {
    it("creates downloadable Spendwise backups and isolates them by account", async () => {
      await call("/api/transactions", {
        method: "POST",
        body: JSON.stringify({ upserts: [row("kept"), row("deleted")] }),
        headers: { "Content-Type": "application/json" },
      });
      await call("/api/transactions", {
        method: "POST",
        body: JSON.stringify({ deletes: ["deleted"] }),
        headers: { "Content-Type": "application/json" },
      });
      await call("/api/collections/budgets", {
        method: "PUT",
        body: JSON.stringify({ data: [{ category: "Shopping", monthlyLimit: 5000 }] }),
        headers: { "Content-Type": "application/json" },
      });

      const created = await call("/api/backups", { method: "POST" });
      assert.equal(created.status, 201);
      const { backup } = await created.json();
      assert.equal(backup.transactionCount, 1);
      assert.ok(backup.size > 0);
      const key = [...env.STATEMENTS.objects.keys()].find((value) => value.startsWith("backups/"));
      assert.match(key, /^backups\/[0-9a-f]{24}\/[0-9a-f-]{36}\.json$/);
      assert.ok(!key.includes("owner"));

      const list = await (await call("/api/backups")).json();
      assert.deepEqual(list.backups, [backup]);

      const download = await call(`/api/backups/${backup.id}`);
      assert.equal(download.status, 200);
      assert.match(download.headers.get("Content-Disposition"), /spendwise-cloud-backup-\d{4}-\d{2}-\d{2}\.json/);
      const body = await download.json();
      assert.equal(body.format, "spendwise.backup.v1");
      assert.equal(body.transactions.length, 1);
      assert.equal(body.transactions[0].id, "kept");
      assert.equal(body.budgets[0].monthlyLimit, 5000);

      const otherToken = await access.sign({ email: "someone@else.com" });
      assert.deepEqual((await (await call("/api/backups", {}, { "Cf-Access-Jwt-Assertion": otherToken })).json()).backups, []);
      assert.equal((await call(`/api/backups/${backup.id}`, {}, { "Cf-Access-Jwt-Assertion": otherToken })).status, 404);

      assert.equal((await call(`/api/backups/${backup.id}`, { method: "DELETE" })).status, 200);
      assert.equal([...env.STATEMENTS.objects.keys()].some((value) => value.startsWith("backups/")), false);
      assert.deepEqual((await (await call("/api/backups")).json()).backups, []);
    });
  });
});
