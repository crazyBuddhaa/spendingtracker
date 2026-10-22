import type { Direction, ImportDiagnostics, ImportResult, Transaction } from "../types.ts";
import { categorise, isOwnAccountTransfer, isWalletProductMovement } from "./categorise.ts";

export { categorise } from "./categorise.ts";

type HeaderMap = {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  type: number;
  time: number;
};

export interface CsvParseOptions {
  source?: string;
  accountHolderName?: string;
  accountNumber?: string;
}

const headerAliases = {
  date: [
    "date",
    "transaction date",
    "transaction date/time",
    "date/time",
    "trans date",
    "value date",
    "posting date",
    "timestamp",
  ],
  description: [
    "description",
    "details",
    "transaction details",
    "narration",
    "transaction narration",
    "particulars",
    "remarks",
    "memo",
    "payee",
    "transaction description",
    "transaction remarks",
    "payment details",
    "counterparty",
    "counter party",
    "beneficiary",
    "merchant",
  ],
  debit: [
    "debit",
    "dr",
    "dr amount",
    "withdrawal",
    "withdrawals",
    "withdrawal amount",
    "paid out",
    "money out",
    "debit amount",
    "outflow",
  ],
  credit: [
    "credit",
    "cr",
    "cr amount",
    "deposit",
    "deposits",
    "deposit amount",
    "paid in",
    "money in",
    "credit amount",
    "inflow",
  ],
  amount: ["amount", "transaction amount", "amt", "value", "transaction value"],
  type: ["type", "transaction type", "direction", "dr/cr", "debit/credit", "credit/debit"],
} as const;

function readCsvRecords(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function normaliseHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\s*[\[(][^)\]]*[\])]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findHeader(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => {
    const normalized = normaliseHeader(header);
    return aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `));
  });
}

function mapHeaders(headers: string[]): HeaderMap {
  const normalized = headers.map(normaliseHeader);
  return {
    date: findHeader(normalized, headerAliases.date),
    description: findHeader(normalized, headerAliases.description),
    amount: findHeader(normalized, headerAliases.amount),
    debit: findHeader(normalized, headerAliases.debit),
    credit: findHeader(normalized, headerAliases.credit),
    type: findHeader(normalized, headerAliases.type),
    time: normalized.findIndex((header) => /^(?:trans(?:action)?\.? ?date(?:\/time)?|date\/time|date time|timestamp|time)$/.test(header)),
  };
}

function parseDate(value: string): string | null {
  const input = value.trim();
  const iso = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return validDate(Number(year), Number(month), Number(day));
  }

  const dayFirst = input.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})/);
  if (dayFirst) {
    let [, first, second, year] = dayFirst;
    if (year.length === 2) year = `${Number(year) > 49 ? "19" : "20"}${year}`;
    let day = first;
    let month = second;
    if (Number(first) <= 12 && Number(second) > 12) {
      day = second;
      month = first;
    }
    return validDate(Number(year), Number(month), Number(day));
  }

  const monthNames: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
    october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const dayMonth = input.match(/^(\d{1,2})[-/ ,]+([A-Za-z]{3,9})[-/ ,]+(\d{2,4})/);
  const monthFirst = input.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})/);
  const namedDate = dayMonth
    ? { day: dayMonth[1], month: monthNames[dayMonth[2].toLowerCase()], year: dayMonth[3] }
    : monthFirst
      ? { day: monthFirst[2], month: monthNames[monthFirst[1].toLowerCase()], year: monthFirst[3] }
      : null;
  if (namedDate?.month) {
    let year = namedDate.year;
    if (year.length === 2) year = `${Number(year) > 49 ? "19" : "20"}${year}`;
    return validDate(Number(year), namedDate.month, Number(namedDate.day));
  }

  return null;
}

function isAmbiguousNumericDate(value: string): boolean {
  const match = value.trim().match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})/);
  return Boolean(match && Number(match[1]) <= 12 && Number(match[2]) <= 12);
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(value: string): number | null {
  const cleaned = value
    .replace(/[₦$€£]/g, "")
    .replace(/^(?:NGN|N)\s*/i, "")
    .replace(/\b(?:NGN|USD|EUR|GBP)\b/gi, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return null;
  const parenthesized = /^\(.*\)$/.test(cleaned);
  const parsed = Number(cleaned.replace(/[()]/g, "").replace(/\s/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return parenthesized ? -Math.abs(parsed) : parsed;
}

function inferDirection(type: string, description: string): Direction {
  const marker = `${type} ${description}`.toLowerCase();
  if (/\b(debit|withdraw|paid out|money out|purchase|payment|pos|transfer to|sent)\b/.test(marker)) {
    return "expense";
  }
  if (/\b(credit|deposit|salary|income|refund|cashback|received|transfer from|interest)\b/.test(marker)) {
    return "income";
  }
  return "expense";
}

function parseTime(value: string): string | undefined {
  const match = value.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? undefined : Number(match[3]);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59 || (seconds !== undefined && seconds > 59)) return undefined;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}${seconds === undefined ? "" : `:${pad(seconds)}`}`;
}

function sourceName(fileName: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const normalized = baseName.toLowerCase();
  if (/\bopay\b/.test(normalized)) return "OPay";
  if (/\baccess\s*bank\b/.test(normalized) || /\baccess\b/.test(normalized)) return "Access Bank";
  if (/\bmoniepoint\b/.test(normalized)) return "Moniepoint";
  return baseName || "Imported statement";
}

function stableId(date: string, description: string, amount: number, source: string, rowIndex: number): string {
  const input = `${date}|${description.toLowerCase()}|${amount.toFixed(2)}|${source}|${rowIndex}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `txn-${(hash >>> 0).toString(36)}-${rowIndex.toString(36)}`;
}

export function parseTransactionsCsv(text: string, fileName: string, options: CsvParseOptions = {}): ImportResult {
  const rows = readCsvRecords(text);
  if (rows.length < 2) {
    return {
      transactions: [],
      skipped: 0,
      warnings: ["The CSV needs a header row and at least one transaction."],
      diagnostics: {
        scannedRows: 0,
        validRows: 0,
        invalidRows: 0,
        missingDateRows: 0,
        invalidDateRows: 0,
        ambiguousDateRows: 0,
        headerDetected: rows.length > 0,
      },
    };
  }

  const headerIndex = rows
    .slice(0, Math.min(rows.length, 20))
    .findIndex((row) => {
      const candidate = mapHeaders(row);
      return (
        candidate.date >= 0 &&
        candidate.description >= 0 &&
        (candidate.amount >= 0 || candidate.debit >= 0 || candidate.credit >= 0)
      );
    });
  if (headerIndex < 0) {
    const scannedRows = Math.max(0, rows.length - 1);
    return {
      transactions: [],
      skipped: scannedRows,
      warnings: [
        "Couldn't identify the required columns. Include a date, description, and amount, debit, or credit column.",
      ],
      diagnostics: {
        scannedRows,
        validRows: 0,
        invalidRows: scannedRows,
        missingDateRows: 0,
        invalidDateRows: 0,
        ambiguousDateRows: 0,
        headerDetected: false,
      },
    };
  }

  const map = mapHeaders(rows[headerIndex]);
  const source = options.source?.trim() || sourceName(fileName);
  const warnings: string[] = [];
  const transactions: Transaction[] = [];
  let skipped = 0;
  let scannedRows = 0;
  let missingDateRows = 0;
  let invalidDateRows = 0;
  let ambiguousDateRows = 0;
  const hasSignedAmount = map.amount >= 0;
  let ambiguousPositiveRows = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const dateText = row[map.date] ?? "";
    const date = parseDate(dateText);
    const description = (row[map.description] ?? "").trim();
    const debitText = map.debit >= 0 ? row[map.debit] ?? "" : "";
    const creditText = map.credit >= 0 ? row[map.credit] ?? "" : "";
    const amountText = map.amount >= 0 ? row[map.amount] ?? "" : "";
    const debit = parseAmount(debitText);
    const credit = parseAmount(creditText);
    const rawAmount = map.amount >= 0 ? parseAmount(amountText) : null;
    const type = map.type >= 0 ? row[map.type] ?? "" : "";
    scannedRows += 1;
    if (!dateText.trim()) missingDateRows += 1;
    else if (!date) invalidDateRows += 1;
    if (date && isAmbiguousNumericDate(dateText)) ambiguousDateRows += 1;

    if (!date || !description) {
      skipped += 1;
      continue;
    }

    let direction: Direction;
    let amount: number;
    if (map.debit >= 0 || map.credit >= 0) {
      const hasDebit = debit !== null && debit !== 0;
      const hasCredit = credit !== null && credit !== 0;
      if (hasDebit && hasCredit) {
        skipped += 1;
        continue;
      }
      if (!hasDebit && !hasCredit) {
        skipped += 1;
        continue;
      }
      direction = hasCredit ? "income" : "expense";
      amount = Math.abs((hasCredit ? credit : debit) ?? 0);
    } else if (rawAmount !== null) {
      if (rawAmount === 0) {
        skipped += 1;
        continue;
      }
      direction = inferDirection(type, description);
      amount = Math.abs(rawAmount);
      if (!type && rawAmount > 0 && direction === "expense") ambiguousPositiveRows += 1;
    } else {
      skipped += 1;
      continue;
    }

    const transaction: Transaction = {
      id: stableId(date, description, amount, source, rowIndex),
      date,
      description,
      amount,
      direction,
      category: categorise(description, direction),
      source,
    };
    const time = parseTime(map.time >= 0 ? row[map.time] ?? "" : "") ?? parseTime(row[map.date] ?? "");
    if (time) transaction.time = time;
    if (isWalletProductMovement(description)) {
      transaction.category = "Transfers";
      transaction.internalTransfer = true;
    } else if (isOwnAccountTransfer(description, options.accountHolderName, options.accountNumber)) {
      transaction.category = "Transfers";
      transaction.ownAccountCandidate = true;
    }
    transactions.push(transaction);
  }

  if (hasSignedAmount && ambiguousPositiveRows > 0) {
    warnings.push(
      `${ambiguousPositiveRows} positive amount${ambiguousPositiveRows === 1 ? "" : "s"} had no debit/credit label; treated as spending unless the description suggested income. Review these rows.`,
    );
  }
  if (skipped > 0) warnings.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped because date, description, or amount was missing or invalid.`);
  if (ambiguousDateRows > 0) {
    warnings.push(
      `${ambiguousDateRows} numeric date${ambiguousDateRows === 1 ? "" : "s"} could also be read month-first; they were interpreted day-first using SpendWise's existing date convention.`,
    );
  }
  const diagnostics: ImportDiagnostics = {
    scannedRows,
    validRows: transactions.length,
    invalidRows: skipped,
    missingDateRows,
    invalidDateRows,
    ambiguousDateRows,
    headerDetected: true,
  };
  return { transactions, skipped, warnings, diagnostics };
}

export function transactionsToCsv(transactions: Transaction[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = [
    ["Date", "Time", "Description", "Direction", "Amount", "Category", "Source", "Internal transfer", "Possible own-account transfer", "Note"].join(","),
    ...transactions.map((transaction) =>
      [
        transaction.date,
        transaction.time ?? "",
        quote(transaction.description),
        transaction.direction,
        transaction.amount.toFixed(2),
        quote(transaction.category),
        quote(transaction.source),
        transaction.internalTransfer ? "yes" : "no",
        transaction.ownAccountCandidate ? "yes" : "no",
        quote(transaction.note ?? ""),
      ].join(","),
    ),
  ];
  return rows.join("\r\n");
}
