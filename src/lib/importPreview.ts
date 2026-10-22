import type { ImportDiagnostics, Transaction } from "../types.ts";
import { findNewTransactions } from "./transactionDeduplication.ts";

export type ImportMode = "full-history" | "specific-month" | "custom-range" | "new-transactions-only";

export interface ImportDateRange {
  start: string | null;
  end: string | null;
}

export interface TimelineSample {
  count: number;
  earliest: string | null;
  latest: string | null;
}

export interface ImportTimeline {
  validRows: number;
  earliest: string | null;
  latest: string | null;
  firstSample: TimelineSample;
  lastSample: TimelineSample;
  invalidTransactionDates: number;
}

export interface ExistingOverlapSource {
  source: string;
  count: number;
  earliest: string;
  latest: string;
}

export interface ImportPreview {
  mode: ImportMode;
  timeline: ImportTimeline;
  range: ImportDateRange | null;
  rangeValid: boolean;
  scannedRows: number;
  validRows: number;
  invalidRows: number;
  missingDateRows: number;
  invalidDateRows: number;
  ambiguousDateRows: number;
  transactionsInRange: Transaction[];
  transactionsForConfirmation: Transaction[];
  transactionsOutsideRange: number;
  confirmedDuplicates: number | null;
  potentialDuplicates: number | null;
  potentialChanges: number | null;
  expectedAdds: number | null;
  existingRowsInDetectedPeriod: number | null;
  overlapSources: ExistingOverlapSource[];
  comparisonAvailable: boolean;
}

function isIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function sampleRange(transactions: Transaction[]): TimelineSample {
  const dates = transactions.map((transaction) => transaction.date);
  return {
    count: transactions.length,
    earliest: dates.length ? dates.reduce((earliest, date) => date < earliest ? date : earliest) : null,
    latest: dates.length ? dates.reduce((latest, date) => date > latest ? date : latest) : null,
  };
}

/** Samples the first and last ten valid rows in file order, then scans every row for the true bounds. */
export function detectImportTimeline(transactions: Transaction[]): ImportTimeline {
  const valid = transactions.filter((transaction) => isIsoDate(transaction.date));
  const allDates = valid.map((transaction) => transaction.date);
  return {
    validRows: valid.length,
    earliest: allDates.length ? allDates.reduce((earliest, date) => date < earliest ? date : earliest) : null,
    latest: allDates.length ? allDates.reduce((latest, date) => date > latest ? date : latest) : null,
    firstSample: sampleRange(valid.slice(0, 10)),
    lastSample: sampleRange(valid.slice(-10)),
    invalidTransactionDates: transactions.length - valid.length,
  };
}

function monthRange(month: string): ImportDateRange | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${year}-${String(monthNumber).padStart(2, "0")}-01`,
    end: `${year}-${String(monthNumber).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  };
}

function selectedRange(
  mode: ImportMode,
  timeline: ImportTimeline,
  month: string,
  customRange: ImportDateRange,
): ImportDateRange | null {
  if (mode === "specific-month") return monthRange(month);
  if (mode === "custom-range") return customRange;
  return { start: timeline.earliest, end: timeline.latest };
}

function inRange(transaction: Transaction, range: ImportDateRange): boolean {
  return isIsoDate(transaction.date)
    && (!range.start || transaction.date >= range.start)
    && (!range.end || transaction.date <= range.end);
}

function validRange(range: ImportDateRange | null, mode: ImportMode): boolean {
  return Boolean(range && (!range.start || isIsoDate(range.start)) && (!range.end || isIsoDate(range.end))
    && (mode !== "custom-range" || Boolean(range.start && range.end))
    && (!range.start || !range.end || range.start <= range.end));
}

function duplicateCandidateKey(transaction: Transaction): string {
  return `${transaction.date}|${transaction.amount.toFixed(2)}|${transaction.description.toLowerCase().trim().replace(/\s+/g, " ")}`;
}

function potentialDuplicateCount(existing: Transaction[], newRows: Transaction[]): number {
  const sourcesByKey = new Map<string, Set<string>>();
  for (const transaction of existing) {
    const key = duplicateCandidateKey(transaction);
    const sources = sourcesByKey.get(key) ?? new Set<string>();
    sources.add(transaction.source);
    sourcesByKey.set(key, sources);
  }
  return newRows.filter((transaction) => {
    const sources = sourcesByKey.get(duplicateCandidateKey(transaction));
    return Boolean(sources && [...sources].some((source) => source !== transaction.source));
  }).length;
}

function changedDetails(left: Transaction, right: Transaction): boolean {
  const fields: Array<keyof Transaction> = [
    "date", "description", "amount", "direction", "category", "source", "internalTransfer",
    "ownAccountCandidate", "time", "note", "manual", "categoryLocked",
  ];
  return fields.some((field) => left[field] !== right[field]);
}

function potentialChangeCount(existing: Transaction[], imported: Transaction[]): number {
  const byId = new Map(existing.map((transaction) => [transaction.id, transaction]));
  return imported.filter((transaction) => {
    const match = byId.get(transaction.id);
    return match !== undefined && changedDetails(match, transaction);
  }).length;
}

function existingOverlap(
  existing: Transaction[],
  timeline: ImportTimeline,
): { count: number; sources: ExistingOverlapSource[] } {
  if (!timeline.earliest || !timeline.latest) return { count: 0, sources: [] };
  const rows = existing.filter((transaction) =>
    transaction.manual !== true
    && isIsoDate(transaction.date)
    && transaction.date >= timeline.earliest!
    && transaction.date <= timeline.latest!,
  );
  const groups = new Map<string, string[]>();
  for (const transaction of rows) {
    const dates = groups.get(transaction.source) ?? [];
    dates.push(transaction.date);
    groups.set(transaction.source, dates);
  }
  const sources = [...groups.entries()]
    .map(([source, dates]) => ({
      source,
      count: dates.length,
      earliest: dates.reduce((first, date) => date < first ? date : first),
      latest: dates.reduce((last, date) => date > last ? date : last),
    }))
    .sort((left, right) => left.source.localeCompare(right.source));
  return { count: rows.length, sources };
}

export function buildImportPreview(options: {
  imported: Transaction[];
  existing: Transaction[];
  diagnostics?: ImportDiagnostics;
  skipped: number;
  mode: ImportMode;
  month: string;
  customRange: ImportDateRange;
  comparisonAvailable: boolean;
}): ImportPreview {
  const {
    imported,
    existing,
    diagnostics,
    skipped,
    mode,
    month,
    customRange,
    comparisonAvailable,
  } = options;
  const timeline = detectImportTimeline(imported);
  const range = selectedRange(mode, timeline, month, customRange);
  const rangeValid = validRange(range, mode);
  const usableTransactions = imported.filter((transaction) => isIsoDate(transaction.date));
  const transactionsInRange = range && rangeValid
    ? usableTransactions.filter((transaction) => inRange(transaction, range))
    : [];
  const transactionsOutsideRange = range && rangeValid
    ? usableTransactions.length - transactionsInRange.length
    : 0;
  const deduped = comparisonAvailable ? findNewTransactions(existing, transactionsInRange) : null;
  const overlap = comparisonAvailable ? existingOverlap(existing, timeline) : null;
  const scannedRows = Math.max(diagnostics?.scannedRows ?? 0, usableTransactions.length + skipped);
  const invalidRows = Math.max(diagnostics?.invalidRows ?? 0, skipped) + timeline.invalidTransactionDates;
  const newRows = deduped ?? [];

  return {
    mode,
    timeline,
    range,
    rangeValid,
    scannedRows,
    validRows: usableTransactions.length,
    invalidRows,
    missingDateRows: diagnostics?.missingDateRows ?? 0,
    invalidDateRows: (diagnostics?.invalidDateRows ?? 0) + timeline.invalidTransactionDates,
    ambiguousDateRows: diagnostics?.ambiguousDateRows ?? 0,
    transactionsInRange,
    transactionsForConfirmation: mode === "new-transactions-only" && deduped
      ? deduped
      : transactionsInRange,
    transactionsOutsideRange,
    confirmedDuplicates: deduped ? transactionsInRange.length - deduped.length : null,
    potentialDuplicates: deduped ? potentialDuplicateCount(existing, newRows) : null,
    potentialChanges: deduped ? potentialChangeCount(existing, transactionsInRange) : null,
    expectedAdds: deduped?.length ?? null,
    existingRowsInDetectedPeriod: overlap?.count ?? null,
    overlapSources: overlap?.sources ?? [],
    comparisonAvailable,
  };
}
