import * as XLSX from "xlsx";
import type { ImportResult } from "../types.ts";
import { parseTransactionsCsv } from "./csv.ts";

type Worksheet = XLSX.WorkSheet;

function cellText(sheet: Worksheet, address: string): string {
  const value = sheet[address]?.v;
  return value === undefined || value === null ? "" : String(value).trim();
}

function amountValue(value: string): number | null {
  const cleaned = value.replace(/[₦$€£,\s]/g, "").replace(/^(?:NGN|N)/i, "");
  if (!cleaned || cleaned === "--" || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function expandSheetRange(sheet: Worksheet): void {
  if (!sheet["!ref"]) return;
  const current = XLSX.utils.decode_range(sheet["!ref"]);
  // Some OPay exports contain metadata and headers before the worksheet's declared !ref.
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: current.e });
}

function isOpayWorkbook(workbook: XLSX.WorkBook): boolean {
  const hasWallet = workbook.SheetNames.some((name) => /wallet account transactions/i.test(name));
  const hasSavings = workbook.SheetNames.some((name) => /savings account transactions/i.test(name));
  const title = workbook.SheetNames.map((name) => cellText(workbook.Sheets[name], "A1")).join(" ");
  return hasWallet && hasSavings && /account statement/i.test(title);
}

function isOwealthMovement(description: string): boolean {
  return /\bowealth\b|auto-save to owealth/i.test(description) &&
    !/\binterest earned\b/i.test(description);
}

function markOpayTransfers(transactions: ImportResult["transactions"]): { pairs: number; amount: number } {
  const savingsByKey = new Map<string, ImportResult["transactions"]>();
  const keyFor = (transaction: ImportResult["transactions"][number], direction = transaction.direction) =>
    `${transaction.date}|${transaction.amount.toFixed(2)}|${direction}`;

  for (const transaction of transactions) {
    if (transaction.source !== "OPay Savings" || !isOwealthMovement(transaction.description)) continue;
    transaction.category = "Transfers";
    transaction.internalTransfer = true;
    const key = keyFor(transaction);
    const group = savingsByKey.get(key) ?? [];
    group.push(transaction);
    savingsByKey.set(key, group);
  }

  let pairs = 0;
  let amount = 0;
  for (const transaction of transactions) {
    if (transaction.source !== "OPay Wallet" || !isOwealthMovement(transaction.description)) continue;
    transaction.category = "Transfers";
    transaction.internalTransfer = true;
    const oppositeDirection = transaction.direction === "income" ? "expense" : "income";
    const candidates = savingsByKey.get(keyFor(transaction, oppositeDirection));
    if (!candidates?.length) continue;
    candidates.shift();
    pairs += 1;
    amount += transaction.amount;
  }
  return { pairs, amount: Math.round(amount * 100) / 100 };
}

function opaySummaryWarnings(
  sheet: Worksheet,
  source: string,
  transactions: ImportResult["transactions"],
): string[] {
  const entries = transactions.filter((transaction) => transaction.source === source);
  const summary = [
    { label: "debits", amountAddress: "D4", countAddress: "F4", direction: "expense" as const },
    { label: "credits", amountAddress: "D5", countAddress: "F5", direction: "income" as const },
  ];
  const warnings: string[] = [];
  for (const item of summary) {
    const declared = amountValue(cellText(sheet, item.amountAddress));
    const declaredCount = Number(cellText(sheet, item.countAddress));
    if (declared === null || !Number.isFinite(declaredCount)) continue;
    const matching = entries.filter((transaction) => transaction.direction === item.direction);
    const actualAmount = matching.reduce((total, transaction) => total + transaction.amount, 0);
    const amountDiff = Math.round((declared - actualAmount) * 100) / 100;
    const countDiff = declaredCount - matching.length;
    if (Math.abs(amountDiff) > 0.01 || countDiff !== 0) {
      const amountText = Math.abs(amountDiff) > 0.01
        ? ` The summary differs from the row total by ₦${Math.abs(amountDiff).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
        : "";
      const countText = countDiff !== 0 ? ` The summary count differs by ${Math.abs(countDiff).toLocaleString("en-NG")} row${Math.abs(countDiff) === 1 ? "" : "s"}.` : "";
      warnings.push(`${source}: the statement summary and transaction rows do not agree on ${item.label}.${amountText}${countText}`);
    }
  }
  return warnings;
}

export function parseExcelStatement(data: ArrayBuffer | Uint8Array, fileName: string): ImportResult {
  try {
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    const opayWorkbook = isOpayWorkbook(workbook);
    const imports = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      expandSheetRange(sheet);
      const csv = XLSX.utils.sheet_to_csv(sheet, {
        blankrows: false,
        dateNF: "yyyy-mm-dd",
      });
      const accountType = cellText(sheet, "B3");
      const source = opayWorkbook && /wallet account/i.test(accountType)
        ? "OPay Wallet"
        : opayWorkbook && /savings account/i.test(accountType)
          ? "OPay Savings"
          : undefined;
      const accountHolderName = opayWorkbook && cellText(sheet, "A2").toLowerCase() === "account name"
        ? cellText(sheet, "B2")
        : undefined;
      return {
        name,
        source,
        sheet,
        result: parseTransactionsCsv(csv, fileName, { source, accountHolderName }),
      };
    }).filter(({ result }) => result.transactions.length > 0);

    if (imports.length === 0) {
      return {
        transactions: [],
        skipped: 0,
        warnings: [
          "No readable transaction table was found in this workbook. Include date, description, and amount, debit, or credit columns.",
        ],
      };
    }

    const transactions = imports.flatMap(({ result }) => result.transactions);
    const warnings = imports.flatMap(({ name, result }) =>
      result.warnings.map((warning) => `${name}: ${warning}`),
    );
    if (opayWorkbook) {
      for (const { source, sheet } of imports) {
        if (source) warnings.push(...opaySummaryWarnings(sheet, source, transactions));
      }
      const matched = markOpayTransfers(transactions);
      if (matched.pairs > 0) {
        warnings.push(
          `Matched ${matched.pairs.toLocaleString("en-NG")} OPay Wallet↔Savings transfer pairs (${new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(matched.amount)}). OWealth non-interest movements are classified as internal transfers and excluded from income and spending totals.`,
        );
      }
    }

    return {
      transactions,
      skipped: imports.reduce((total, { result }) => total + result.skipped, 0),
      warnings,
    };
  } catch {
    return {
      transactions: [],
      skipped: 0,
      warnings: ["This Excel file could not be opened. Try exporting the statement as .xls, .xlsx, or CSV."],
    };
  }
}
