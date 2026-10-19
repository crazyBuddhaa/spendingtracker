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
