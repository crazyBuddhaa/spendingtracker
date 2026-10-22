import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTransactionsCsv } from "./csv.ts";
import { buildImportPreview, detectImportTimeline } from "./importPreview.ts";

const transaction = (date, overrides = {}) => ({
  id: overrides.id ?? `${date}-${Math.random()}`,
  date,
  description: overrides.description ?? "Market purchase",
  amount: overrides.amount ?? 1200,
  direction: "expense",
  category: "Food & groceries",
  source: overrides.source ?? "Access Bank",
  ...overrides,
});

function datesCsv(dates) {
  return `Date,Description,Debit,Credit\n${dates.map((date, index) => `${date},Purchase ${index + 1},100,`).join("\n")}`;
}

describe("import timeline detection", () => {
  it("detects the full range for ascending dates and samples the first and last ten rows", () => {
    const rows = Array.from({ length: 25 }, (_, index) => transaction(`2026-01-${String(index + 1).padStart(2, "0")}`));
    const timeline = detectImportTimeline(rows);
    assert.equal(timeline.validRows, 25);
    assert.equal(timeline.earliest, "2026-01-01");
    assert.equal(timeline.latest, "2026-01-25");
    assert.equal(timeline.firstSample.count, 10);
    assert.equal(timeline.firstSample.earliest, "2026-01-01");
    assert.equal(timeline.firstSample.latest, "2026-01-10");
    assert.equal(timeline.lastSample.count, 10);
    assert.equal(timeline.lastSample.earliest, "2026-01-16");
    assert.equal(timeline.lastSample.latest, "2026-01-25");
  });

  it("detects descending dates without treating the file ends as the range bounds", () => {
    const timeline = detectImportTimeline([
      transaction("2026-03-03"),
      transaction("2026-03-02"),
      transaction("2026-03-01"),
    ]);
    assert.equal(timeline.earliest, "2026-03-01");
    assert.equal(timeline.latest, "2026-03-03");
  });

  it("scans every valid row for an unsorted range beyond the first and last samples", () => {
    const rows = Array.from({ length: 24 }, (_, index) => transaction(`2026-04-${String(index + 2).padStart(2, "0")}`));
    rows[12] = transaction("2025-12-31");
    rows[19] = transaction("2027-01-01");
    const timeline = detectImportTimeline(rows);
    assert.equal(timeline.earliest, "2025-12-31");
    assert.equal(timeline.latest, "2027-01-01");
    assert.equal(timeline.firstSample.earliest, "2026-04-02");
    assert.equal(timeline.lastSample.latest, "2027-01-01");
  });

  it("handles fewer than twenty valid rows and empty files", () => {
    const small = detectImportTimeline([transaction("2026-02-01"), transaction("2026-02-04")]);
    assert.equal(small.validRows, 2);
    assert.equal(small.firstSample.count, 2);
    assert.equal(small.lastSample.count, 2);
    assert.equal(detectImportTimeline([]).earliest, null);
    assert.equal(detectImportTimeline([]).latest, null);
  });

  it("counts invalid transaction dates without letting them distort the range", () => {
    const timeline = detectImportTimeline([transaction("2026-02-01"), transaction("bad-date")]);
    assert.equal(timeline.earliest, "2026-02-01");
    assert.equal(timeline.invalidTransactionDates, 1);
  });
});

describe("parser diagnostics for import preview", () => {
  it("counts missing dates, invalid dates, invalid transactions, and ambiguous numeric dates", () => {
    const result = parseTransactionsCsv(
      "Date,Description,Debit,Credit\n"
      + "01/02/2026,Valid day-first row,100,\n"
      + ",Missing date,100,\n"
      + "32/13/2026,Impossible date,100,\n"
      + "2026-01-04,Missing amount,,\n"
      + "2026-01-05,,100,",
      "statement.csv",
    );
    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].date, "2026-02-01");
    assert.equal(result.skipped, 4);
    assert.deepEqual(result.diagnostics, {
      scannedRows: 5,
      validRows: 1,
      invalidRows: 4,
      missingDateRows: 1,
      invalidDateRows: 1,
      ambiguousDateRows: 1,
      headerDetected: true,
    });
  });

  it("handles a file with no transactions and reports when header detection failed", () => {
    const empty = parseTransactionsCsv("Date,Description,Debit,Credit", "empty.csv");
    assert.equal(empty.transactions.length, 0);
    assert.equal(empty.diagnostics.scannedRows, 0);
    const unrecognized = parseTransactionsCsv("foo,bar\nx,y", "bad.csv");
    assert.equal(unrecognized.diagnostics.headerDetected, false);
    assert.equal(unrecognized.diagnostics.invalidRows, 1);
  });
});

describe("import mode preview", () => {
  const imported = [
    transaction("2026-01-31", { id: "jan" }),
    transaction("2026-02-01", { id: "feb-1" }),
    transaction("2026-02-15", { id: "feb-15" }),
    transaction("2026-03-01", { id: "mar" }),
  ];

  it("selects a full calendar month and counts valid rows outside it", () => {
    const preview = buildImportPreview({
      imported,
      existing: [],
      skipped: 0,
      mode: "specific-month",
      month: "2026-02",
      customRange: { start: null, end: null },
      comparisonAvailable: true,
    });
    assert.deepEqual(preview.range, { start: "2026-02-01", end: "2026-02-28" });
    assert.equal(preview.transactionsInRange.length, 2);
    assert.equal(preview.transactionsOutsideRange, 2);
  });

  it("uses inclusive custom date boundaries and rejects reversed boundaries", () => {
    const preview = buildImportPreview({
      imported,
      existing: [],
      skipped: 0,
      mode: "custom-range",
      month: "",
      customRange: { start: "2026-02-01", end: "2026-02-15" },
      comparisonAvailable: true,
    });
    assert.equal(preview.transactionsInRange.length, 2);
    assert.equal(preview.transactionsOutsideRange, 2);

    const invalid = buildImportPreview({
      imported,
      existing: [],
      skipped: 0,
      mode: "custom-range",
      month: "",
      customRange: { start: "2026-03-01", end: "2026-02-01" },
      comparisonAvailable: true,
    });
    assert.equal(invalid.rangeValid, false);
    assert.equal(invalid.transactionsInRange.length, 0);

    const missingBoundary = buildImportPreview({
      imported,
      existing: [],
      skipped: 0,
      mode: "custom-range",
      month: "",
      customRange: { start: "2026-02-01", end: null },
      comparisonAvailable: true,
    });
    assert.equal(missingBoundary.rangeValid, false);
  });

  it("flags known imported transaction dates within the detected interval without claiming statement-period metadata", () => {
    const existing = [
      transaction("2026-02-10", { id: "known-1", source: "Access Bank" }),
      transaction("2026-04-01", { id: "known-2", source: "Moniepoint" }),
      transaction("2026-02-12", { id: "manual", manual: true, source: "Access Bank" }),
    ];
    const preview = buildImportPreview({
      imported,
      existing,
      skipped: 0,
      mode: "full-history",
      month: "",
      customRange: { start: null, end: null },
      comparisonAvailable: true,
    });
    assert.equal(preview.existingRowsInDetectedPeriod, 1);
    assert.deepEqual(preview.overlapSources.map((item) => item.source), ["Access Bank"]);
  });

  it("uses the existing exact matcher for confirmed duplicates and labels cross-source matches as potential", () => {
    const existing = [
      transaction("2026-02-01", { id: "old-1", description: "Market   purchase", source: "Access Bank" }),
      transaction("2026-02-15", { id: "old-2", description: "Taxi fare", source: "Other Bank" }),
    ];
    const candidates = [
      transaction("2026-02-01", { id: "new-1", description: "Market   purchase", source: "Access Bank" }),
      transaction("2026-02-15", { id: "new-2", description: "Taxi fare", source: "Access Bank" }),
      transaction("2026-02-20", { id: "new-3", description: "New merchant", source: "Access Bank" }),
    ];
    const preview = buildImportPreview({
      imported: candidates,
      existing,
      skipped: 0,
      mode: "new-transactions-only",
      month: "",
      customRange: { start: null, end: null },
      comparisonAvailable: true,
    });
    assert.equal(preview.confirmedDuplicates, 1);
    assert.equal(preview.potentialDuplicates, 1);
    assert.equal(preview.expectedAdds, 2);
    assert.equal(preview.transactionsForConfirmation.length, 2);
  });

  it("reports a same-ID change candidate without changing the existing row", () => {
    const existing = [transaction("2026-02-01", { id: "same-id", category: "Other" })];
    const imported = [transaction("2026-02-01", { id: "same-id", category: "Food & groceries" })];
    const preview = buildImportPreview({
      imported,
      existing,
      skipped: 0,
      mode: "full-history",
      month: "",
      customRange: { start: null, end: null },
      comparisonAvailable: true,
    });
    assert.equal(preview.potentialChanges, 1);
    assert.equal(preview.confirmedDuplicates, 1);
    assert.equal(existing[0].category, "Other");
  });

  it("marks duplicate and overlap comparisons unavailable instead of estimating", () => {
    const preview = buildImportPreview({
      imported,
      existing: [],
      skipped: 0,
      mode: "new-transactions-only",
      month: "",
      customRange: { start: null, end: null },
      comparisonAvailable: false,
    });
    assert.equal(preview.confirmedDuplicates, null);
    assert.equal(preview.potentialDuplicates, null);
    assert.equal(preview.potentialChanges, null);
    assert.equal(preview.existingRowsInDetectedPeriod, null);
    assert.equal(preview.expectedAdds, null);
  });
});
