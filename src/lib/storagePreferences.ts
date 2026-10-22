export const STORAGE_PREFERENCE_SCHEMA_VERSION = 1 as const;

/** The current managed provider and the future user-owned spreadsheet provider. */
export type StorageProvider = "spendwise-managed" | "google-sheets";
export type StorageProviderStatus = "available" | "not-connected";

/**
 * Provider availability is deliberately separate from the persisted preference:
 * Google Sheets is a known future provider, not a working connection.
 */
export const STORAGE_PROVIDER_STATUS: Readonly<Record<StorageProvider, StorageProviderStatus>> = Object.freeze({
  "spendwise-managed": "available",
  "google-sheets": "not-connected",
});

export interface StoragePreference {
  schemaVersion: typeof STORAGE_PREFERENCE_SCHEMA_VERSION;
  provider: StorageProvider;
  /** Reserved for future automatic backups; manual backups remain unchanged. */
  automaticBackupsEnabled: boolean;
}

/** Missing preferences use today's local-first, optional Cloudflare sync behavior. */
export const DEFAULT_STORAGE_PREFERENCE: Readonly<StoragePreference> = Object.freeze({
  schemaVersion: STORAGE_PREFERENCE_SCHEMA_VERSION,
  provider: "spendwise-managed",
  automaticBackupsEnabled: false,
});

function isStorageProvider(value: unknown): value is StorageProvider {
  return value === "spendwise-managed" || value === "google-sheets";
}

/**
 * Validates a preference without retaining unknown fields.
 * Returns null for malformed, unsupported, or future-version configurations.
 * Strict callers can reject unexpected fields instead of ignoring them.
 */
export function validateStoragePreference(
  value: unknown,
  options: { strict?: boolean } = {},
): StoragePreference | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    options.strict &&
    Object.keys(candidate).some((key) => !Object.prototype.hasOwnProperty.call(DEFAULT_STORAGE_PREFERENCE, key))
  ) {
    return null;
  }
  if (
    candidate.schemaVersion !== STORAGE_PREFERENCE_SCHEMA_VERSION ||
    !isStorageProvider(candidate.provider) ||
    typeof candidate.automaticBackupsEnabled !== "boolean"
  ) {
    return null;
  }
  return {
    schemaVersion: STORAGE_PREFERENCE_SCHEMA_VERSION,
    provider: candidate.provider,
    automaticBackupsEnabled: candidate.automaticBackupsEnabled,
  };
}

/** Parses a saved preference, falling back safely for existing users or bad data. */
export function parseStoragePreference(value: unknown): StoragePreference {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return { ...DEFAULT_STORAGE_PREFERENCE };
    }
  }
  return validateStoragePreference(candidate) ?? { ...DEFAULT_STORAGE_PREFERENCE };
}

export function isStorageProviderAvailable(provider: StorageProvider): boolean {
  return STORAGE_PROVIDER_STATUS[provider] === "available";
}
