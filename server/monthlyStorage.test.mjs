import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleApi } from "./api.ts";
import { clearKeyCache } from "./auth.ts";
import {
  loadMonthlyOverrides,
  loadMonthlySummary,
  loadMonthlyTransactions,
  MAX_MONTHLY_DATASET_BYTES,
  MonthlyStorageError,
  monthlyObjectKeys,
  parseJsonl,
  saveMonthlyOverrides,
  saveMonthlySummary,
  saveMonthlyTransactions,
  serializeJsonl,
} from "./monthlyStorage.ts";
import { createFakeAccess, createFakeR2 } from "./testing.mjs";

const scope = { userEmail: "owner@example.com", accountId: "checking_1", year: 2026, month: 9 };
const generation = "f761f3c2-5272-4c62-9e67-41a6237c030f";
const transaction = (id = "txn-1", overrides = {}) => ({
  id,
  date: "2026-09-01",
  description: "Market",
  amount: 125,
  direction: "expense",
  category: "Food & groceries",
  source: "Checking",
  ...overrides,
});

describe("monthly R2 storage helpers", () => {
  it("serializes and parses bounded JSONL datasets", () => {
    const records = [transaction(), transaction("txn-2", { amount: 25 })];
    const encoded = serializeJsonl(records, (value) => Boolean(value?.id));
    assert.ok(encoded.endsWith("\n"));
    assert.deepEqual(parseJsonl(encoded, (value) => Boolean(value?.id)), records);
    assert.throws(() => serializeJsonl(records, () => true, 1), (error) => error.code === "too_large");
    assert.throws(() => parseJsonl("{broken\n", () => true), (error) => error.code === "corrupt_object");
  });

  it("writes one versioned object per dataset and loads transactions, summaries, and overrides", async () => {
    const bucket = createFakeR2();
    const records = [transaction()];
    const summary = { count: 1, expense: 125, categories: { "Food & groceries": 125 } };
    const overrides = [{ id: "txn-1", operation: "patch", updatedAt: 1234, patch: { category: "Business" } }];

    await saveMonthlyTransactions(bucket, scope, generation, records);
    await saveMonthlySummary(bucket, scope, generation, summary);
    await saveMonthlyOverrides(bucket, scope, generation, overrides);

    const keys = await monthlyObjectKeys(scope, generation);
    assert.deepEqual([...bucket.objects.keys()].sort(), [keys.overrides, keys.summary, keys.transactions].sort());
    assert.ok(keys.transactions.includes("/accounts/checking_1/2026/09/transactions/"));
    assert.ok(!Object.values(keys).some((key) => key.includes("owner@example.com")));
    assert.deepEqual(await loadMonthlyTransactions(bucket, scope, generation), records);
    assert.deepEqual(await loadMonthlySummary(bucket, scope, generation), summary);
    assert.deepEqual(await loadMonthlyOverrides(bucket, scope, generation), overrides);
  });

  it("returns null for missing objects and rejects invalid scope or generation values", async () => {
    const bucket = createFakeR2();
    assert.equal(await loadMonthlyTransactions(bucket, scope, generation), null);
    assert.equal(await loadMonthlySummary(bucket, scope, generation), null);
    assert.equal(await loadMonthlyOverrides(bucket, scope, generation), null);
    await assert.rejects(() => monthlyObjectKeys({ ...scope, accountId: "../other" }, generation), { code: "invalid_scope" });
    await assert.rejects(() => monthlyObjectKeys(scope, "../other"), { code: "invalid_generation" });
  });

  it("validates transaction month and record fields before writing", async () => {
    const bucket = createFakeR2();
    await assert.rejects(() => saveMonthlyTransactions(bucket, scope, generation, [transaction("wrong-month", { date: "2026-10-01" })]), { code: "invalid_data" });
    await assert.rejects(() => saveMonthlyTransactions(bucket, scope, generation, [transaction("bad-amount", { amount: Number.NaN })]), { code: "invalid_data" });
    await assert.rejects(() => saveMonthlyOverrides(bucket, scope, generation, [{ id: "", operation: "delete", updatedAt: 1 }]), { code: "invalid_data" });
    await assert.rejects(() => saveMonthlySummary(bucket, scope, generation, []), { code: "invalid_data" });
    assert.equal(bucket.objects.size, 0);
  });

  it("bounds reads and treats malformed stored summaries as corrupt data", async () => {
    const bucket = createFakeR2();
    const keys = await monthlyObjectKeys(scope, generation);
    await bucket.put(keys.transactions, "x".repeat(MAX_MONTHLY_DATASET_BYTES + 1));
    await assert.rejects(() => loadMonthlyTransactions(bucket, scope, generation), { code: "too_large" });
    await bucket.put(keys.summary, "{not-json");
    await assert.rejects(() => loadMonthlySummary(bucket, scope, generation), { code: "corrupt_object" });
  });

  it("converts R2 failures to a safe storage error", async () => {
    const bucket = { get: async () => { throw new Error("private provider detail"); }, put: async () => { throw new Error("private provider detail"); }, delete: async () => {} };
    await assert.rejects(() => loadMonthlyTransactions(bucket, scope, generation), (error) => {
      assert.ok(error instanceof MonthlyStorageError);
      assert.equal(error.code, "storage_unavailable");
      assert.ok(!error.message.includes("private provider detail"));
      return true;
    });
    await assert.rejects(() => saveMonthlySummary(bucket, scope, generation, { count: 0 }), { code: "storage_unavailable" });
  });

  it("uses the authenticated user namespace and does not require D1", async () => {
    const bucket = createFakeR2();
    await saveMonthlyTransactions(bucket, scope, generation, [transaction()]);
    assert.equal(await loadMonthlyTransactions(bucket, { ...scope, userEmail: "other@example.com" }, generation), null);
  });
});

describe("monthly storage API authorization", () => {
  it("authenticates before any R2 read or write", async () => {
    clearKeyCache();
    const access = await createFakeAccess();
    let calls = 0;
    const bucket = {
      get: async () => { calls += 1; return null; },
      put: async () => { calls += 1; },
      delete: async () => { calls += 1; },
    };
    const env = { ...access.env, STATEMENTS: bucket };
    const path = `/api/monthly-storage/checking_1/2026/09/transactions`;
    const read = await handleApi(new Request(`https://spend.example.com${path}?generation=${generation}`), env, access.fetcher);
    const write = await handleApi(new Request(`https://spend.example.com${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: [transaction()] }),
    }), env, access.fetcher);
    assert.equal(read.status, 401);
    assert.equal(write.status, 401);
    assert.equal(calls, 0);
  });

  it("writes and reads the caller's own monthly object without touching D1", async () => {
    clearKeyCache();
    const access = await createFakeAccess();
    const bucket = createFakeR2();
    const token = await access.sign({ email: "Owner@Example.com" });
    const env = {
      ...access.env,
      STATEMENTS: bucket,
      DB: { prepare: () => { throw new Error("monthly storage must not use D1"); } },
    };
    const call = (path, init = {}, jwt = token) => handleApi(
      new Request(`https://spend.example.com${path}`, {
        ...init,
        headers: { "Cf-Access-Jwt-Assertion": jwt, ...(init.headers ?? {}) },
      }),
      env,
      access.fetcher,
    );
    const path = "/api/monthly-storage/checking_1/2026/09/transactions";
    const saved = await call(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: [transaction()] }),
    });
    assert.equal(saved.status, 201);
    const savedBody = await saved.json();
    assert.match(savedBody.generation, /^[0-9a-f-]{36}$/i);
    assert.equal(savedBody.count, 1);

    const loaded = await call(`${path}?generation=${savedBody.generation}`);
    assert.equal(loaded.status, 200);
    assert.deepEqual((await loaded.json()).records, [transaction()]);

    const otherToken = await access.sign({ email: "other@example.com" });
    const isolated = await call(`${path}?generation=${savedBody.generation}`, {}, otherToken);
    assert.equal(isolated.status, 404);
  });

  it("reports missing bindings, missing generations, and malformed requests safely", async () => {
    clearKeyCache();
    const access = await createFakeAccess();
    const token = await access.sign({ email: "owner@example.com" });
    const authHeaders = { "Cf-Access-Jwt-Assertion": token };
    const noBucket = await handleApi(
      new Request(`https://spend.example.com/api/monthly-storage/checking_1/2026/09/transactions?generation=${generation}`, { headers: authHeaders }),
      access.env,
      access.fetcher,
    );
    assert.equal(noBucket.status, 503);

    const env = { ...access.env, STATEMENTS: createFakeR2() };
    const missing = await handleApi(
      new Request("https://spend.example.com/api/monthly-storage/checking_1/2026/09/transactions?generation=bad", { headers: authHeaders }),
      env,
      access.fetcher,
    );
    assert.equal(missing.status, 400);

    const invalid = await handleApi(
      new Request("https://spend.example.com/api/monthly-storage/checking_1/2026/13/transactions", { method: "PUT", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ records: [] }) }),
      env,
      access.fetcher,
    );
    assert.equal(invalid.status, 400);
  });
});
