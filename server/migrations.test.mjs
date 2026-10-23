import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";

const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

it("scrubs transaction details from tombstones already stored in D1", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_init.sql"));
  db.prepare(
    `INSERT INTO transactions (user_email, id, date, time, description, amount, direction, category, source, flags, note, deleted, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("owner@example.com", "deleted-1", "2026-10-19", "12:34:56", "Private payment", 4567, 1, "Shopping", "OPay Wallet", 2, "memo", 1, 10);

  db.exec(migration("0002_scrub_transaction_tombstones.sql"));
  const row = db.prepare(
    "SELECT date, time, description, amount, direction, category, source, flags, note, deleted, updated_at FROM transactions WHERE id = ?",
  ).get("deleted-1");

  assert.deepEqual({ ...row }, {
    date: "1970-01-01",
    time: "",
    description: "",
    amount: 0,
    direction: 0,
    category: "Other",
    source: "",
    flags: 0,
    note: "",
    deleted: 1,
    updated_at: 10,
  });
  db.close();
});

it("adds isolated storage preferences without changing existing transaction data", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_init.sql"));
  db.prepare(
    `INSERT INTO transactions (user_email, id, date, time, description, amount, direction, category, source, flags, note, deleted, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("legacy@example.com", "keep-me", "2026-10-19", "12:34:56", "Existing purchase", 4567, 0, "Shopping", "OPay", 0, "memo", 0, 10);
  db.exec(migration("0002_scrub_transaction_tombstones.sql"));
  db.exec(migration("0003_cloud_backups.sql"));

  db.exec(migration("0004_storage_preferences.sql"));

  const existing = db.prepare("SELECT description, amount FROM transactions WHERE user_email = ? AND id = ?")
    .get("legacy@example.com", "keep-me");
  assert.deepEqual({ ...existing }, { description: "Existing purchase", amount: 4567 });
  assert.deepEqual(
    db.prepare("PRAGMA table_info(storage_preferences)").all().map((column) => column.name),
    ["user_email", "schema_version", "provider", "automatic_backups_enabled", "created_at", "updated_at"],
  );

  const insert = db.prepare(
    `INSERT INTO storage_preferences
       (user_email, schema_version, provider, automatic_backups_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insert.run("one@example.com", 1, "spendwise-managed", 0, 100, 100);
  insert.run("two@example.com", 1, "google-sheets", 1, 101, 101);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM storage_preferences").get().count, 2);
  assert.throws(() => insert.run("one@example.com", 1, "spendwise-managed", 0, 102, 102));
  assert.throws(() => insert.run("three@example.com", 2, "spendwise-managed", 0, 102, 102));
  assert.throws(() => insert.run("three@example.com", 1, "not-a-provider", 0, 102, 102));
  assert.throws(() => insert.run("three@example.com", 1, "spendwise-managed", 2, 102, 102));
  db.close();
});

it("adds the R2 transaction manifest while preserving legacy D1 rows untouched", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "0001_init.sql",
    "0002_scrub_transaction_tombstones.sql",
    "0003_cloud_backups.sql",
    "0004_storage_preferences.sql",
  ]) {
    db.exec(migration(name));
  }
  db.prepare(
    `INSERT INTO transactions (user_email, id, date, time, description, amount, direction, category, source, flags, note, deleted, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("legacy@example.com", "keep-me", "2026-10-19", "12:34:56", "Existing purchase", 4567, 0, "Shopping", "OPay", 2, "memo", 0, 10);

  db.exec(migration("0005_r2_transaction_storage.sql"));

  const existing = db.prepare(
    "SELECT date, time, description, amount, direction, category, source, flags, note, deleted, updated_at FROM transactions WHERE user_email = ? AND id = ?",
  ).get("legacy@example.com", "keep-me");
  assert.deepEqual({ ...existing }, {
    date: "2026-10-19",
    time: "12:34:56",
    description: "Existing purchase",
    amount: 4567,
    direction: 0,
    category: "Shopping",
    source: "OPay",
    flags: 2,
    note: "memo",
    deleted: 0,
    updated_at: 10,
  });
  assert.deepEqual(
    db.prepare("PRAGMA table_info(transaction_heads)").all().map((column) => column.name),
    ["user_email", "id", "batch_id", "record_index", "deleted", "updated_at"],
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transaction_store_state").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transaction_store_batches").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transaction_heads").get().count, 0);
  db.close();
});
