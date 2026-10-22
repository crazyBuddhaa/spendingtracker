import {
  DEFAULT_STORAGE_PREFERENCE,
  validateStoragePreference,
  type StoragePreference,
} from "../src/lib/storagePreferences.ts";
import type { D1Database } from "./bindings.ts";

interface StoragePreferenceRow {
  schema_version: unknown;
  provider: unknown;
  automatic_backups_enabled: unknown;
}

/** Reads only the current authenticated account's preference; absent rows stay absent. */
export async function loadStoragePreference(db: D1Database, userEmail: string): Promise<StoragePreference> {
  const row = await db.prepare(
    `SELECT schema_version, provider, automatic_backups_enabled
       FROM storage_preferences
      WHERE user_email = ?1`,
  ).bind(userEmail).first<StoragePreferenceRow>();

  if (!row) return { ...DEFAULT_STORAGE_PREFERENCE };

  const preference = validateStoragePreference({
    schemaVersion: row.schema_version,
    provider: row.provider,
    automaticBackupsEnabled: row.automatic_backups_enabled === 1
      ? true
      : row.automatic_backups_enabled === 0
        ? false
        : null,
  });
  if (!preference) throw new Error("Stored storage preference is invalid.");
  return preference;
}

/** Upserts the validated preference without touching transaction or backup records. */
export async function saveStoragePreference(
  db: D1Database,
  userEmail: string,
  preference: StoragePreference,
): Promise<void> {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO storage_preferences
       (user_email, schema_version, provider, automatic_backups_enabled, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT (user_email) DO UPDATE SET
       schema_version = excluded.schema_version,
       provider = excluded.provider,
       automatic_backups_enabled = excluded.automatic_backups_enabled,
       updated_at = excluded.updated_at`,
  ).bind(
    userEmail,
    preference.schemaVersion,
    preference.provider,
    preference.automaticBackupsEnabled ? 1 : 0,
    now,
  ).run();
}
