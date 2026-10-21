import type { BetCategory, BetImportResult, BetRecord, BetStatus } from "../types.ts";
import { betCategories } from "../types.ts";
import type { PositionedPdfTextItem } from "./pdfText.ts";

type BetColumns = {
  date: number;
  stake: number;
  returnAmount: number;
  profit: number;
  status: number;
  event: number;
  betType: number;
  category: number;
  id: number;
};

const headerAliases = {
  date: ["date", "bet date", "placed date", "placed at", "placed on", "created at", "created on", "timestamp", "date time"],
  stake: ["total stake", "stake amount", "amount staked", "bet amount", "wager amount", "wager", "stake"],
  amount: ["amount"],
  returnAmount: ["total return", "return amount", "total payout", "payout", "potential return", "potential payout", "total winnings", "winnings", "win amount", "amount won", "return"],
  profit: ["net profit", "net winnings", "profit loss", "profit"],
  status: ["bet status", "settlement status", "result", "outcome", "settlement", "status"],
  event: ["event name", "match name", "bet details", "description", "fixture", "selection", "selections", "match", "event", "game"],
  betType: ["bet type", "wager type", "type"],
  category: ["sport category", "sport", "sports", "category"],
  id: ["bet reference", "ticket number", "ticket id", "bet number", "reference", "bet id", "id"],
} as const;

function text(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return value === null || value === undefined ? "" : String(value).trim();
}

function normaliseHeader(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAlias(value: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => value === alias || value.startsWith(`${alias} `));
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => matchesAlias(normaliseHeader(header), aliases));
}

function mapColumns(headers: string[]): BetColumns {
  const explicitStake = findColumn(headers, headerAliases.stake);
  return {
    date: findColumn(headers, headerAliases.date),
    stake: explicitStake >= 0 ? explicitStake : findColumn(headers, headerAliases.amount),
    returnAmount: findColumn(headers, headerAliases.returnAmount),
    profit: findColumn(headers, headerAliases.profit),
    status: findColumn(headers, headerAliases.status),
    event: findColumn(headers, headerAliases.event),
    betType: findColumn(headers, headerAliases.betType),
    category: findColumn(headers, headerAliases.category),
    id: findColumn(headers, headerAliases.id),
  };
}

function classifyHeader(value: string): keyof BetColumns | null {
  const columns = mapColumns([value]);
  const key = (Object.keys(columns) as Array<keyof BetColumns>).find((candidate) => columns[candidate] === 0);
  return key ?? null;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return validDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 20000 && value <= 100000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const input = text(value);
  const iso = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = input.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})/);
  if (dayFirst) {
    const year = Number(dayFirst[3]) < 100 ? 2000 + Number(dayFirst[3]) : Number(dayFirst[3]);
    return validDate(year, Number(dayFirst[2]), Number(dayFirst[1]));
  }

  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
    october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const namedDayFirst = input.match(/^(\d{1,2})[\s/-]+([a-z]{3,9})[\s,-]+(\d{4})$/i);
  const namedMonthFirst = input.match(/^([a-z]{3,9})[\s/-]+(\d{1,2}),?[\s/-]+(\d{4})$/i);
  if (namedDayFirst) {
    const month = months[namedDayFirst[2].toLowerCase()];
    return month ? validDate(Number(namedDayFirst[3]), month, Number(namedDayFirst[1])) : null;
  }
  if (namedMonthFirst) {
    const month = months[namedMonthFirst[1].toLowerCase()];
    return month ? validDate(Number(namedMonthFirst[3]), month, Number(namedMonthFirst[2])) : null;
  }
  return null;
}

function parseAmount(value: unknown, allowNegative = false): number | null {
  if (typeof value === "number") return Number.isFinite(value) && (allowNegative || value >= 0) ? value : null;
  const input = text(value);
  if (!input || /^[-–—]$/.test(input)) return null;
  const isNegative = /^\s*-/.test(input) || /^\s*\(.*\)\s*$/.test(input);
  let numeric = input.replace(/[^\d,.-]/g, "");
  if (numeric.includes(".")) {
    numeric = numeric.replace(/,/g, "");
  } else if (numeric.includes(",")) {
    numeric = /,\d{1,2}$/.test(numeric) ? numeric.replace(",", ".") : numeric.replace(/,/g, "");
  }
  const amount = Number(numeric.replace(/[()]/g, ""));
  if (!Number.isFinite(amount)) return null;
  const signed = isNegative ? -Math.abs(amount) : amount;
  return allowNegative || signed >= 0 ? signed : null;
}

function parseStatus(value: unknown): BetStatus {
  const status = normaliseHeader(value);
  if (/\b(cash out|cashout|cashed out)\b/.test(status)) return "cashed-out";
  if (/\b(won|win|winner|winning)\b/.test(status)) return "won";
  if (/\b(lost|lose|loss)\b/.test(status)) return "lost";
  if (/\b(void|voided|refunded|refund|cancelled|canceled)\b/.test(status)) return "void";
  if (/\b(open|pending|active|unsettled)\b/.test(status)) return "open";
  return "other";
}

function parseCategory(value: unknown): BetCategory | "Unclassified" {
  const category = normaliseHeader(value);
  if (/\b(soccer|football)\b/.test(category)) return "Football";
  if (/\bbasketball\b/.test(category)) return "Basketball";
  if (/\btennis\b/.test(category)) return "Tennis";
  if (/\bvolleyball\b/.test(category)) return "Volleyball";
  if (/\brugby\b/.test(category)) return "Rugby";
  if (/\bcricket\b/.test(category)) return "Cricket";
  if (/\b(esports|e sports)\b/.test(category)) return "Esports";
  const exact = betCategories.find((item) => item.toLowerCase() === category);
  return exact ?? "Unclassified";
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function sourceLabel(source: string): string {
  return source.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 80) || "Imported file";
}

export function parseBettingTableRows(rows: unknown[][], source = "Imported file"): BetImportResult {
  const normalisedRows = rows.map((row) => row.map(text));
  let headerIndex = -1;
  let columns: BetColumns | null = null;

  for (let index = 0; index < Math.min(normalisedRows.length, 50); index += 1) {
    const candidate = mapColumns(normalisedRows[index]);
    if (candidate.date >= 0 && candidate.stake >= 0) {
      headerIndex = index;
      columns = candidate;
      break;
    }
  }

  if (headerIndex < 0 || !columns) {
    return {
      bets: [],
      warnings: ["Couldn't find betting columns. Include headers such as Date, Stake, Return, Status, and Event."],
    };
  }

  const bets: BetRecord[] = [];
  let skipped = 0;
  const sourceName = sourceLabel(source);
  for (const row of normalisedRows.slice(headerIndex + 1)) {
    if (!row.some(Boolean)) continue;
    const date = parseDate(row[columns.date]);
    const stake = parseAmount(row[columns.stake]);
    if (!date || stake === null) {
      skipped += 1;
      continue;
    }

    const status = parseStatus(columns.status >= 0 ? row[columns.status] : "");
    const explicitReturn = columns.returnAmount >= 0 ? parseAmount(row[columns.returnAmount]) : null;
    const profit = columns.profit >= 0 ? parseAmount(row[columns.profit], true) : null;
    const returnAmount = explicitReturn
      ?? (profit !== null ? Math.max(0, stake + profit) : status === "void" ? stake : 0);
    const event = columns.event >= 0 ? row[columns.event].trim() : "";
    const externalId = columns.id >= 0 ? row[columns.id].trim() : "";
    const key = externalId || row.join("\u001f");

    bets.push({
      id: `import-${stableHash(`${sourceName.toLowerCase()}|${key.toLowerCase()}`)}`,
      date,
      category: parseCategory(columns.category >= 0 ? row[columns.category] : ""),
      betType: (columns.betType >= 0 ? row[columns.betType].trim() : "") || "Other",
      status,
      stake,
      returnAmount,
      events: event ? [event] : [],
      hiddenEvents: 0,
      source: sourceName,
    });
  }

  const warnings: string[] = [];
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? "" : "s"} without a readable date and stake ${skipped === 1 ? "was" : "were"} skipped.`);
  if (!bets.length && !warnings.length) warnings.push("No betting rows were found below the table headers.");
  return { bets, warnings };
}

interface PdfEntry {
  str: string;
  x: number;
  y: number;
}

interface PdfHeaderLayout {
  headers: string[];
  anchors: number[];
}

function groupPdfLines(page: PositionedPdfTextItem[]): PdfEntry[][] {
  const entries = page
    .filter((item) => item.str?.trim() && item.transform && Number.isFinite(item.transform[4]) && Number.isFinite(item.transform[5]))
    .map((item) => ({ str: item.str.trim(), x: item.transform![4], y: item.transform![5] }))
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: PdfEntry[][] = [];

  for (const entry of entries) {
    let line = lines.find((candidate) => Math.abs(candidate[0].y - entry.y) <= 2.5);
    if (!line) {
      line = [];
      lines.push(line);
    }
    line.push(entry);
  }
  return lines.map((line) => line.sort((left, right) => left.x - right.x));
}

function pdfHeaderLayout(items: PdfEntry[]): PdfHeaderLayout | null {
  const headers: string[] = [];
  const anchors: number[] = [];
  let index = 0;

  while (index < items.length) {
    let matchedWidth = 0;
    for (let width = Math.min(3, items.length - index); width >= 2; width -= 1) {
      const label = items.slice(index, index + width).map((item) => item.str).join(" ");
      const combinedKey = classifyHeader(label);
      const componentKeys = items.slice(index, index + width).map((item) => classifyHeader(item.str));
      if (combinedKey && componentKeys.every((key) => key === null || key === combinedKey)) {
        matchedWidth = width;
        break;
      }
    }
    const width = matchedWidth || 1;
    headers.push(items.slice(index, index + width).map((item) => item.str).join(" "));
    anchors.push(items[index].x);
    index += width;
  }

  const columns = mapColumns(headers);
  return columns.date >= 0 && columns.stake >= 0 ? { headers, anchors } : null;
}

function pdfColumnAt(x: number, anchors: number[]): number {
  let column = 0;
  for (let index = 1; index < anchors.length; index += 1) {
    if (x < (anchors[index - 1] + anchors[index]) / 2) break;
    column = index;
  }
  return column;
}

export function parseBettingPdfPages(pages: PositionedPdfTextItem[][], source = "Imported PDF"): BetImportResult {
  let layout: PdfHeaderLayout | null = null;
  const rows: string[][] = [];

  for (const page of pages) {
    for (const line of groupPdfLines(page)) {
      const repeatedHeader = pdfHeaderLayout(line);
      if (repeatedHeader) {
        layout = repeatedHeader;
        if (!rows.length) rows.push(layout.headers);
        continue;
      }
      if (!layout) continue;

      const cells = Array.from({ length: layout.headers.length }, () => "");
      for (const item of line) {
        const column = pdfColumnAt(item.x, layout.anchors);
        cells[column] = [cells[column], item.str].filter(Boolean).join(" ");
      }
      if (cells.some(Boolean)) rows.push(cells);
    }
  }

  if (!rows.length) {
    return {
      bets: [],
      warnings: ["No readable betting table with Date and Stake columns was found. Use a text-based PDF or export the history as CSV or Excel."],
    };
  }
  return parseBettingTableRows(rows, source);
}
