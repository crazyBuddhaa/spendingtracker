import type { Category, Direction, ImportResult, Transaction } from "../types.ts";

type HeaderMap = {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  type: number;
};

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
    let [, day, month, year] = dayFirst;
    if (year.length === 2) year = `${Number(year) > 49 ? "19" : "20"}${year}`;
    return validDate(Number(year), Number(month), Number(day));
  }
  return null;
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

export function categorise(description: string, direction: Direction): Category {
  if (direction === "income") return "Income";
  const text = description.toLowerCase();
  if (/\b(transfer|trf|xfer|internal transfer|own account)\b/.test(text)) return "Transfers";
  if (/\b(uber|bolt|taxi|bus|transport|fuel|petrol|diesel|parking|ride)\b/.test(text)) return "Transport";
  if (/\b(grocery|market|food|restaurant|cafe|supermarket|shoprite|eat|chicken|mcdonald)\b/.test(text)) return "Food & groceries";
  if (/\b(electric|electricity|power|water|internet|airtime|data|dstv|gotv|utility|bill)\b/.test(text)) return "Bills & utilities";
  if (/\b(pharmacy|hospital|clinic|health|medical|doctor|lab test)\b/.test(text)) return "Health";
  if (/\b(school|tuition|course|udemy|education|books)\b/.test(text)) return "Education";
  if (/\b(netflix|spotify|cinema|movie|game|concert|entertainment)\b/.test(text)) return "Entertainment";
  if (/\b(shop|store|clothing|fashion|amazon|jumia|konga|purchase)\b/.test(text)) return "Shopping";
  return "Other";
}

function sourceName(fileName: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const normalized = baseName.toLowerCase();
  if (/\bopay\b/.test(normalized)) return "OPay";
  if (/\baccess\s*bank\b/.test(normalized) || /\baccess\b/.test(normalized)) return "Access Bank";
  if (/\bmoniepoint\b/.test(normalized)) return "Moniepoint";
  return baseName || "Imported statement";
}

function stableId(date: string, description: string, amount: number, source: string): string {
  const input = `${date}|${description.toLowerCase()}|${amount.toFixed(2)}|${source}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `txn-${(hash >>> 0).toString(36)}`;
}

export function parseTransactionsCsv(text: string, fileName: string): ImportResult {
  const rows = readCsvRecords(text);
  if (rows.length < 2) {
    return { transactions: [], skipped: 0, warnings: ["The CSV needs a header row and at least one transaction."] };
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
    return {
      transactions: [],
      skipped: rows.length - 1,
      warnings: [
        "Couldn't identify the required columns. Include a date, description, and amount, debit, or credit column.",
      ],
    };
  }

  const map = mapHeaders(rows[headerIndex]);
  const source = sourceName(fileName);
  const warnings: string[] = [];
  const transactions: Transaction[] = [];
  let skipped = 0;
  const hasSignedAmount = map.amount >= 0;
  let ambiguousPositiveRows = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseDate(row[map.date] ?? "");
    const description = (row[map.description] ?? "").trim();
    const debitText = map.debit >= 0 ? row[map.debit] ?? "" : "";
    const creditText = map.credit >= 0 ? row[map.credit] ?? "" : "";
    const amountText = map.amount >= 0 ? row[map.amount] ?? "" : "";
    const debit = parseAmount(debitText);
    const credit = parseAmount(creditText);
    const rawAmount = map.amount >= 0 ? parseAmount(amountText) : null;
    const type = map.type >= 0 ? row[map.type] ?? "" : "";

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

    transactions.push({
      id: stableId(date, description, amount, source),
      date,
      description,
      amount,
      direction,
      category: categorise(description, direction),
      source,
    });
  }

  if (hasSignedAmount && ambiguousPositiveRows > 0) {
    warnings.push(
      `${ambiguousPositiveRows} positive amount${ambiguousPositiveRows === 1 ? "" : "s"} had no debit/credit label; treated as spending unless the description suggested income. Review these rows.`,
    );
  }
  if (skipped > 0) warnings.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped because date, description, or amount was missing or invalid.`);
  return { transactions, skipped, warnings };
}

export function transactionsToCsv(transactions: Transaction[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = [
    ["Date", "Description", "Direction", "Amount", "Category", "Source"].join(","),
    ...transactions.map((transaction) =>
      [
        transaction.date,
        quote(transaction.description),
        transaction.direction,
        transaction.amount.toFixed(2),
        quote(transaction.category),
        quote(transaction.source),
      ].join(","),
    ),
  ];
  return rows.join("\r\n");
}
