import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_STORAGE_PREFERENCE,
  STORAGE_PROVIDER_STATUS,
  isStorageProviderAvailable,
  parseStoragePreference,
  validateStoragePreference,
} from "./storagePreferences.ts";
import {
  createTransactionPersistenceAdapter,
  StorageProviderUnavailableError,
} from "./transactionPersistence.ts";

describe("storage preferences", () => {
  it("defaults existing users to managed storage with automatic backups off", () => {
    assert.deepEqual(parseStoragePreference(undefined), {
      schemaVersion: 1,
      provider: "spendwise-managed",
      automaticBackupsEnabled: false,
    });
    assert.deepEqual(parseStoragePreference(null), DEFAULT_STORAGE_PREFERENCE);
  });

  it("validates known providers while marking Google Sheets as not connected", () => {
    assert.deepEqual(validateStoragePreference({
      schemaVersion: 1,
      provider: "spendwise-managed",
      automaticBackupsEnabled: true,
    }), {
      schemaVersion: 1,
      provider: "spendwise-managed",
      automaticBackupsEnabled: true,
    });
    assert.deepEqual(validateStoragePreference({
      schemaVersion: 1,
      provider: "google-sheets",
      automaticBackupsEnabled: false,
    }), {
      schemaVersion: 1,
      provider: "google-sheets",
      automaticBackupsEnabled: false,
    });
    assert.equal(STORAGE_PROVIDER_STATUS["google-sheets"], "not-connected");
    assert.equal(isStorageProviderAvailable("spendwise-managed"), true);
    assert.equal(isStorageProviderAvailable("google-sheets"), false);
  });

  it("rejects unsupported providers and malformed or unsupported versions", () => {
    assert.equal(validateStoragePreference({
      schemaVersion: 1,
      provider: "r2-direct",
      automaticBackupsEnabled: false,
    }), null);
    assert.equal(validateStoragePreference({
      schemaVersion: 2,
      provider: "spendwise-managed",
      automaticBackupsEnabled: false,
    }), null);
    assert.equal(validateStoragePreference({
      schemaVersion: 1,
      provider: "spendwise-managed",
      automaticBackupsEnabled: "yes",
    }), null);
    assert.equal(validateStoragePreference([]), null);
    assert.equal(validateStoragePreference(null), null);
    assert.deepEqual(parseStoragePreference("{malformed"), DEFAULT_STORAGE_PREFERENCE);
    assert.deepEqual(parseStoragePreference({ schemaVersion: 1, provider: "unknown" }), DEFAULT_STORAGE_PREFERENCE);
  });

  it("can reject unexpected fields for strict server requests", () => {
    const value = {
      schemaVersion: 1,
      provider: "spendwise-managed",
      automaticBackupsEnabled: false,
      userId: "another-user",
    };
    assert.equal(validateStoragePreference(value, { strict: true }), null);
    assert.deepEqual(validateStoragePreference(value), {
      schemaVersion: 1,
      provider: "spendwise-managed",
      automaticBackupsEnabled: false,
    });
  });
});

describe("managed transaction persistence adapter", () => {
  it("preserves paged reads and sends one batch of upserts and deletes to the existing API", async () => {
    const calls = [];
    const page = { rows: [], next: "42:txn-1", hasMore: false };
    const api = {
      transactionsPage: async (after) => {
        calls.push(["load", after]);
        return page;
      },
      writeTransactions: async (upserts, deletes, batchId) => {
        calls.push(["write", upserts, deletes, batchId]);
        return { updatedAt: 42 };
      },
    };
    const adapter = createTransactionPersistenceAdapter(DEFAULT_STORAGE_PREFERENCE.provider, api);
    const upserts = [["txn-1", "2026-10-01", "", "Market", 500, 0, "Shopping", "Checking", 0, ""]];
    const deletes = ["txn-2"];

    assert.equal(await adapter.loadPage("10:previous"), page);
    await adapter.applyChanges(upserts, deletes);

    const batchId = calls[1][3];
    assert.deepEqual(calls, [
      ["load", "10:previous"],
      ["write", upserts, deletes, batchId],
    ]);
    assert.match(batchId, /^[0-9a-f-]{36}$/i);
  });

  it("reuses the idempotency key when a failed write is retried unchanged", async () => {
    const batchIds = [];
    let shouldFail = true;
    const api = {
      transactionsPage: async () => ({ rows: [], next: "0:", hasMore: false }),
      writeTransactions: async (_upserts, _deletes, batchId) => {
        batchIds.push(batchId);
        if (shouldFail) {
          shouldFail = false;
          throw new Error("simulated network failure");
        }
        return { updatedAt: 42 };
      },
    };
    const adapter = createTransactionPersistenceAdapter(DEFAULT_STORAGE_PREFERENCE.provider, api);
    const upserts = [["retry", "2026-10-01", "", "Market", 500, 0, "Shopping", "Checking", 0, ""]];

    await assert.rejects(() => adapter.applyChanges(upserts, []), /simulated network failure/);
    await adapter.applyChanges(upserts, []);
    assert.equal(batchIds.length, 2);
    assert.equal(batchIds[0], batchIds[1]);
  });

  it("restores the idempotency key from persisted metadata after an adapter reload", async () => {
    let stored = null;
    const retryStore = {
      read: async () => stored,
      write: async (value) => { stored = value; return true; },
    };
    const batchIds = [];
    const upserts = [["reload-retry", "2026-10-01", "", "Market", 500, 0, "Shopping", "Checking", 0, ""]];
    const failingApi = {
      transactionsPage: async () => ({ rows: [], next: "0:", hasMore: false }),
      writeTransactions: async (_upserts, _deletes, batchId) => {
        batchIds.push(batchId);
        throw new Error("simulated page interruption");
      },
    };
    const firstAdapter = createTransactionPersistenceAdapter(
      DEFAULT_STORAGE_PREFERENCE.provider,
      failingApi,
      retryStore,
    );
    await assert.rejects(() => firstAdapter.applyChanges(upserts, []), /simulated page interruption/);
    assert.ok(stored);

    const succeedingApi = {
      transactionsPage: async () => ({ rows: [], next: "0:", hasMore: false }),
      writeTransactions: async (_upserts, _deletes, batchId) => {
        batchIds.push(batchId);
        return { updatedAt: 42 };
      },
    };
    const reloadedAdapter = createTransactionPersistenceAdapter(
      DEFAULT_STORAGE_PREFERENCE.provider,
      succeedingApi,
      retryStore,
    );
    await reloadedAdapter.applyChanges(upserts, []);
    assert.equal(batchIds.length, 2);
    assert.equal(batchIds[0], batchIds[1]);
    assert.deepEqual(JSON.parse(stored), {});
  });

  it("does not provide a fake Google Sheets persistence adapter", () => {
    assert.throws(
      () => createTransactionPersistenceAdapter("google-sheets"),
      StorageProviderUnavailableError,
    );
  });
});
