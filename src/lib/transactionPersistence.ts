import { cloudApi, type TransactionPage } from "./cloudApi.ts";
import { readValue, writeValue } from "./persistentStore.ts";
import type { SyncRow } from "./syncFormat.ts";
import type { StorageProvider } from "./storagePreferences.ts";

const RETRY_BATCH_IDS_KEY = "spendwise.transaction-batch-ids.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RetryBatchIdStore {
  read(): Promise<string | null>;
  write(value: string): Promise<unknown>;
}

const defaultRetryBatchIdStore: RetryBatchIdStore = {
  read: () => readValue(RETRY_BATCH_IDS_KEY),
  write: (value) => writeValue(RETRY_BATCH_IDS_KEY, value),
};

/**
 * Narrow boundary matching the existing sync API: paged reads and batched
 * upserts/deletes. The server stores immutable R2 batches and keeps only the
 * cursor and per-id pointers needed for authenticated incremental sync in D1.
 */
export interface TransactionPersistenceAdapter {
  loadPage(after: string): Promise<TransactionPage>;
  applyChanges(upserts: readonly SyncRow[], deletes: readonly string[]): Promise<void>;
}

export interface ManagedTransactionApi {
  transactionsPage(after: string): Promise<TransactionPage>;
  writeTransactions(upserts: SyncRow[], deletes: string[], batchId?: string): Promise<unknown>;
}

export class StorageProviderUnavailableError extends Error {
  constructor(provider: StorageProvider) {
    super(provider === "google-sheets"
      ? "Google Sheets storage is not connected yet."
      : "The selected storage provider is unavailable.");
    this.name = "StorageProviderUnavailableError";
  }
}

/** Adapts the current authenticated Cloudflare transaction API without a new write path. */
export function createTransactionPersistenceAdapter(
  provider: StorageProvider,
  api: ManagedTransactionApi = cloudApi,
  retryBatchIdStore: RetryBatchIdStore = defaultRetryBatchIdStore,
): TransactionPersistenceAdapter {
  if (provider !== "spendwise-managed") throw new StorageProviderUnavailableError(provider);

  let retryBatchIds: Map<string, string> | null = null;
  let retryBatchIdsLoaded: Promise<Map<string, string>> | null = null;
  let persistQueue = Promise.resolve();

  const loadRetryBatchIds = async () => {
    if (retryBatchIds) return retryBatchIds;
    if (!retryBatchIdsLoaded) {
      retryBatchIdsLoaded = (async () => {
        let stored: string | null = null;
        try {
          stored = await retryBatchIdStore.read();
        } catch {
          // Sync can still proceed if browser persistence is unavailable.
        }
        const parsed = new Map<string, string>();
        try {
          const candidate: unknown = stored ? JSON.parse(stored) : null;
          if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
            for (const [signature, batchId] of Object.entries(candidate)) {
              if (/^[0-9a-f]{64}$/.test(signature) && typeof batchId === "string" && UUID_PATTERN.test(batchId)) {
                parsed.set(signature, batchId);
              }
            }
          }
        } catch {
          // Ignore invalid local retry metadata, not transaction data.
        }
        retryBatchIds = parsed;
        return parsed;
      })();
    }
    return retryBatchIdsLoaded;
  };

  const persistRetryBatchIds = (batchIds: Map<string, string>) => {
    const snapshot = JSON.stringify(Object.fromEntries(batchIds));
    persistQueue = persistQueue
      .then(() => retryBatchIdStore.write(snapshot))
      .then(() => undefined)
      .catch(() => undefined);
    return persistQueue;
  };

  return {
    loadPage: (after) => api.transactionsPage(after),
    async applyChanges(upserts, deletes) {
      const copiedUpserts = [...upserts];
      const copiedDeletes = [...deletes];
      const signatureDigest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify([copiedUpserts, copiedDeletes])),
      );
      const signature = [...new Uint8Array(signatureDigest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const retryIds = await loadRetryBatchIds();
      let batchId = retryIds.get(signature);
      if (!batchId) {
        batchId = crypto.randomUUID();
        retryIds.set(signature, batchId);
        // Persist before sending so a reload can retry with the same key.
        await persistRetryBatchIds(retryIds);
      }
      await api.writeTransactions(copiedUpserts, copiedDeletes, batchId);
      retryIds.delete(signature);
      await persistRetryBatchIds(retryIds);
    },
  };
}
