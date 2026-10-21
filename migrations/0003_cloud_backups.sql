CREATE TABLE IF NOT EXISTS backups (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, id)
);

CREATE INDEX IF NOT EXISTS backups_by_user_created
  ON backups (user_email, created_at DESC);
