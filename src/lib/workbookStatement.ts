import type { ImportResult, Transaction } from "../types.ts";
import { isWalletProductMovement } from "./categorise.ts";
import { parseTransactionsCsv } from "./csv.ts";

/** A worksheet reduced to what the statement parser needs, independent of the Excel library. */
export interface StatementSheet {
  name: string;
  csv: string;
  cell: (address: string) => string;
}

function amountValue(value: string): number | null {
  const cleaned = value.replace(/[₦$€£,\s]/g, "").replace(/^(?:NGN|N)/i, "");
  if (!cleaned || cleaned === "--" || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value);

export function isOpayWorkbook(sheets: StatementSheet[]): boolean {
  const hasWallet = sheets.some((sheet) => /wallet account transactions/i.test(sheet.name));
  const hasSavings = sheets.some((sheet) => /savings account transactions/i.test(sheet.name));
  const title = sheets.map((sheet) => sheet.cell("A1")).join(" ");
  return hasWallet && hasSavings && /account statement/i.test(title);
}

/**
 * Pairs wallet-side and savings-side legs of the same OPay movement (same date,
 * amount, and opposite direction). Both legs are already excluded from totals;
 * pairing is reported so the user can see the books balance.
 */
export function markOpayTransfers(transactions: Transaction[]): { pairs: number; amount: number; unpaired: number } {
  const savingsByKey = new Map<string, Transaction[]>();
  const keyFor = (transaction: Transaction, direction = transaction.direction) =>
    `${transaction.date}|${transaction.amount.toFixed(2)}|${direction}`;

  for (const transaction of transactions) {
    if (transaction.source !== "OPay Savings" || !isWalletProductMovement(transaction.description)) continue;
    transaction.category = "Transfers";
    transaction.internalTransfer = true;
    const key = keyFor(transaction);
    const group = savingsByKey.get(key) ?? [];
    group.push(transaction);
    savingsByKey.set(key, group);
  }

  let pairs = 0;
  let amount = 0;
  let unpaired = 0;
  for (const transaction of transactions) {
    if (transaction.source !== "OPay Wallet" || !isWalletProductMovement(transaction.description)) continue;
    transaction.category = "Transfers";
    transaction.internalTransfer = true;
    if (!/owealth/i.test(transaction.description)) continue;
    const oppositeDirection = transaction.direction === "income" ? "expense" : "income";
    const candidates = savingsByKey.get(keyFor(transaction, oppositeDirection));
    if (!candidates?.length) {
      unpaired += 1;
      continue;
    }
    candidates.shift();
    pairs += 1;
    amount += transaction.amount;
  }
  return { pairs, amount: Math.round(amount * 100) / 100, unpaired };
}

function opaySummaryWarnings(sheet: StatementSheet, source: string, transactions: Transaction[]): string[] {
  const entries = transactions.filter((transaction) => transaction.source === source);
  const summary = [
    { label: "debits", amountAddress: "D4", countAddress: "F4", direction: "expense" as const },
    { label: "credits", amountAddress: "D5", countAddress: "F5", direction: "income" as const },
  ];
  const warnings: string[] = [];
  const declaredDebit = amountValue(sheet.cell("D4"));
  const declaredCredit = amountValue(sheet.cell("D5"));
  for (const item of summary) {
    const declared = amountValue(sheet.cell(item.amountAddress));
    const declaredCount = Number(sheet.cell(item.countAddress));
    if (declared === null || !Number.isFinite(declaredCount)) continue;
    const matching = entries.filter((transaction) => transaction.direction === item.direction);
    const actualAmount = matching.reduce((total, transaction) => total + transaction.amount, 0);
    const amountDiff = Math.round((declared - actualAmount) * 100) / 100;
    const countDiff = declaredCount - matching.length;
    if (Math.abs(amountDiff) > 0.01 || countDiff !== 0) {
      const amountText = Math.abs(amountDiff) > 0.01 ? ` The summary differs from the row total by ${money(Math.abs(amountDiff))}.` : "";
      const countText = countDiff !== 0
        ? ` The summary count differs by ${Math.abs(countDiff).toLocaleString("en-NG")} row${Math.abs(countDiff) === 1 ? "" : "s"}.`
        : "";
      const sameFigure = declaredDebit !== null && declaredDebit === declaredCredit && countDiff === 0
        ? ` The statement header shows the same figure (${money(declared)}) for total debit and total credit, which points to a printing error in the statement rather than missing rows; the ${matching.length.toLocaleString("en-NG")} ${item.label.slice(0, -1)} rows add up to ${money(actualAmount)}.`
        : "";
      warnings.push(`${source}: the statement summary and transaction rows do not agree on ${item.label}.${amountText}${countText}${sameFigure}`);
    }
  }
  return warnings;
}

function labelled(sheet: StatementSheet, labelAddress: string, valueAddress: string, label: RegExp): string | undefined {
  return label.test(sheet.cell(labelAddress)) ? sheet.cell(valueAddress) || undefined : undefined;
}

export function parseStatementSheets(sheets: StatementSheet[], fileName: string): ImportResult {
  const opayWorkbook = isOpayWorkbook(sheets);
  const imports = sheets.map((sheet) => {
    const accountType = sheet.cell("B3");
    const source = opayWorkbook && /wallet account/i.test(accountType)
      ? "OPay Wallet"
      : opayWorkbook && /savings account/i.test(accountType)
        ? "OPay Savings"
        : undefined;
    // Statement headers commonly carry "Account Name" / "Account Number" pairs above the table.
    const accountHolderName = labelled(sheet, "A2", "B2", /^account name$/i);
    const accountNumber = labelled(sheet, "C2", "D2", /^account (?:number|no\.?)$/i);
    return {
      sheet,
      source,
      result: parseTransactionsCsv(sheet.csv, fileName, { source, accountHolderName, accountNumber }),
    };
  }).filter(({ result }) => result.transactions.length > 0);

  if (imports.length === 0) {
    return {
      transactions: [],
      skipped: 0,
      warnings: ["No readable transaction table was found in this workbook. Include date, description, and amount, debit, or credit columns."],
    };
  }

  const transactions = imports.flatMap(({ result }) => result.transactions);
  const warnings = imports.flatMap(({ sheet, result }) => result.warnings.map((warning) => `${sheet.name}: ${warning}`));
  if (opayWorkbook) {
    for (const { source, sheet } of imports) {
      if (source) warnings.push(...opaySummaryWarnings(sheet, source, transactions));
    }
    const matched = markOpayTransfers(transactions);
    const internal = transactions.filter((transaction) => transaction.internalTransfer).length;
    if (matched.pairs > 0) {
      warnings.push(
        `Matched ${matched.pairs.toLocaleString("en-NG")} OPay Wallet↔Savings transfer pair${matched.pairs === 1 ? "" : "s"} (${money(matched.amount)}). ` +
        `${internal.toLocaleString("en-NG")} OWealth, Spend & Save, and Targets movements are your own money moving between pots, so they are excluded from income and spending totals.`,
      );
    }
  }

  return {
    transactions,
    skipped: imports.reduce((total, { result }) => total + result.skipped, 0),
    warnings,
  };
}
