import { cloudApi, type TransactionPage } from "./cloudApi.ts";
import type { SyncRow } from "./syncFormat.ts";
import type { StorageProvider } from "./storagePreferences.ts";

/**
 * Narrow boundary matching the existing sync API: paged reads and batched
 * upserts/deletes. The server remains responsible for authenticated D1 writes
 * and delete tombstones.
 */
export interface TransactionPersistenceAdapter {
  loadPage(after: string): Promise<TransactionPage>;
  applyChanges(upserts: readonly SyncRow[], deletes: readonly string[]): Promise<void>;
}

export interface ManagedTransactionApi {
  transactionsPage(after: string): Promise<TransactionPage>;
  writeTransactions(upserts: SyncRow[], deletes: string[]): Promise<unknown>;
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
): TransactionPersistenceAdapter {
  if (provider !== "spendwise-managed") throw new StorageProviderUnavailableError(provider);

  return {
    loadPage: (after) => api.transactionsPage(after),
    async applyChanges(upserts, deletes) {
      await api.writeTransactions([...upserts], [...deletes]);
    },
  };
}
