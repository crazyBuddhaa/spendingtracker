-- One validated storage preference per normalized Cloudflare Access email.
-- The application supplies the Stage 5 defaults when no row exists.
CREATE TABLE IF NOT EXISTS storage_preferences (
  user_email TEXT NOT NULL PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  provider TEXT NOT NULL CHECK (provider IN ('spendwise-managed', 'google-sheets')),
  automatic_backups_enabled INTEGER NOT NULL CHECK (automatic_backups_enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
