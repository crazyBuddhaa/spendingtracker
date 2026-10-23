-- R2 stores transaction payloads. D1 keeps only sequence, idempotency and
-- per-transaction pointers needed for incremental sync; legacy transaction rows
-- remain in place until the separately planned data migration.
CREATE TABLE IF NOT EXISTS transaction_store_state (
  user_email TEXT NOT NULL PRIMARY KEY,
  sequence INTEGER NOT NULL DEFAULT 0,
  clear_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_store_batches (
  user_email TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  upsert_count INTEGER NOT NULL DEFAULT 0,
  delete_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, batch_id)
);

CREATE INDEX IF NOT EXISTS transaction_batches_by_status
  ON transaction_store_batches (user_email, status, sequence);

CREATE TABLE IF NOT EXISTS transaction_heads (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  record_index INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, id)
);

CREATE INDEX IF NOT EXISTS transaction_heads_by_change
  ON transaction_heads (user_email, updated_at, id);
