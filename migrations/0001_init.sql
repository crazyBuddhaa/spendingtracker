-- Spendwise cloud schema. Every row is scoped to the Cloudflare Access email that wrote it.

CREATE TABLE IF NOT EXISTS transactions (
  user_email  TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  date        TEXT    NOT NULL,
  time        TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL,
  amount      REAL    NOT NULL,
  direction   INTEGER NOT NULL CHECK (direction IN (0, 1)),
  category    TEXT    NOT NULL,
  source      TEXT    NOT NULL,
  flags       INTEGER NOT NULL DEFAULT 0,
  note        TEXT    NOT NULL DEFAULT '',
  deleted     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_email, id)
);

CREATE INDEX IF NOT EXISTS transactions_by_change ON transactions (user_email, updated_at, id);

-- Small per-user documents: savings goals, savings circles, bets, rules, budgets.
CREATE TABLE IF NOT EXISTS collections (
  user_email TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, name)
);

-- Original statement files; the bytes live in R2 under r2_key.
CREATE TABLE IF NOT EXISTS statements (
  user_email   TEXT    NOT NULL,
  id           TEXT    NOT NULL,
  file_name    TEXT    NOT NULL,
  r2_key       TEXT    NOT NULL,
  content_type TEXT    NOT NULL,
  size         INTEGER NOT NULL,
  sha256       TEXT    NOT NULL,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  uploaded_at  INTEGER NOT NULL,
  PRIMARY KEY (user_email, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS statements_by_hash ON statements (user_email, sha256);
