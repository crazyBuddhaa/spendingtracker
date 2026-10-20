import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { handleApi } from "./api.ts";
import { clearKeyCache } from "./auth.ts";
import { createFakeAccess, createFakeD1, createFakeR2 } from "./testing.mjs";

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

    it("sends an authenticated API login back to the public website", async () => {
      const response = await call("/api/auth/start");
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("Location"), "https://spend.example.com/");
    });
  });

  describe("transactions", () => {
    const post = (body) => call("/api/transactions", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

    it("upserts, pages by cursor, updates, and tombstones deletes", async () => {
      const rows = Array.from({ length: 25 }, (_, index) => row(`t${String(index).padStart(2, "0")}`));
      assert.equal((await post({ upserts: rows })).status, 200);

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
      const other = await (await call("/api/transactions", {}, { "Cf-Access-Jwt-Assertion": otherToken })).json();
      assert.equal(other.rows.length, 0);
    });

    it("validates rows and batch size", async () => {
      assert.equal((await post({ upserts: [["x"]] })).status, 400);
      assert.equal((await post({ upserts: [row("x", { 4: -5 })] })).status, 400);
      assert.equal((await post({ deletes: [5] })).status, 400);
      assert.equal((await post({ upserts: Array.from({ length: 2001 }, (_, index) => row(`r${index}`)) })).status, 413);
      const ok = await post({ upserts: Array.from({ length: 2000 }, (_, index) => row(`r${index}`)) });
      assert.equal(ok.status, 200);
    });

    it("clears everything as tombstones", async () => {
      await post({ upserts: [row("a"), row("b")] });
      assert.equal((await call("/api/transactions", { method: "DELETE" })).status, 200);
      const all = await (await call("/api/transactions")).json();
      assert.deepEqual(all.rows.map((item) => item[1]), [1, 1]);
      assert.ok(all.rows.every(([transaction]) => transaction.slice(1).every((value, index) =>
        value === ["1970-01-01", "", "", 0, 0, "Other", "", 0, ""][index],
      )));
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
      const [key] = [...env.STATEMENTS.objects.keys()];
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
      assert.equal(env.STATEMENTS.objects.size, 0);
      assert.deepEqual((await (await call("/api/backups")).json()).backups, []);
    });
  });
});
