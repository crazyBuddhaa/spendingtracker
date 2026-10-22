import type { ImportResult } from "../types.ts";
import { parseTransactionsCsv } from "./csv.ts";

export interface PositionedPdfTextItem {
  str: string;
  transform?: number[];
}

type ColumnKey = "date" | "description" | "amount" | "debit" | "credit" | "type";

interface PdfColumn {
  x: number;
  key: ColumnKey | null;
  label: string;
}

interface PdfLine {
  items: PositionedPdfTextItem[];
  text: string;
  y: number;
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function classifyHeader(value: string): { key: ColumnKey | null; label: string } | null {
  const text = normalise(value).replace(/[()[\]]/g, " ");
  if (/\b(balance|reference|ref no|transaction id|serial no|currency|branch)\b/.test(text)) {
    return { key: null, label: value.trim() };
  }
  if (/\b(type|direction|dr\/cr|debit\/credit|credit\/debit)\b/.test(text)) {
    return { key: "type", label: "Type" };
  }
  if (/\b(debit|dr|withdrawal|withdrawals|paid out|money out|outflow)\b/.test(text)) {
    return { key: "debit", label: "Debit" };
  }
  if (/\b(credit|cr|deposit|deposits|paid in|money in|inflow)\b/.test(text)) {
    return { key: "credit", label: "Credit" };
  }
  if (/\b(description|details|narration|particulars|remarks|memo|payee|merchant|beneficiary)\b/.test(text)) {
    return { key: "description", label: "Description" };
  }
  if (/\b(date|timestamp)\b/.test(text)) {
    return { key: "date", label: "Date" };
  }
  if (/\b(amount|amt|transaction value|value)\b/.test(text)) {
    return { key: "amount", label: "Amount" };
  }
  return null;
}

function groupLines(items: PositionedPdfTextItem[]): PdfLine[] {
  const positioned = items
    .filter((item) => item.str?.trim() && item.transform && Number.isFinite(item.transform[4]) && Number.isFinite(item.transform[5]))
    .map((item) => ({ item, x: item.transform![4], y: item.transform![5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfLine[] = [];

  for (const entry of positioned) {
    let line = lines.find((candidate) => Math.abs(candidate.y - entry.y) <= 2.5);
    if (!line) {
      line = { items: [], text: "", y: entry.y };
      lines.push(line);
    }
    line.items.push(entry.item);
  }

  return lines
    .map((line) => {
      line.items.sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0));
      return { ...line, text: line.items.map((item) => item.str.trim()).filter(Boolean).join(" ") };
    })
    .sort((a, b) => b.y - a.y);
}

function headerColumns(line: PdfLine): PdfColumn[] {
  const columns = line.items.flatMap((item) => {
    const classification = classifyHeader(item.str);
    const x = item.transform?.[4];
    return classification && Number.isFinite(x) ? [{ x: x as number, ...classification }] : [];
  }).sort((a, b) => a.x - b.x);

  const unique: PdfColumn[] = [];
  for (const column of columns) {
    const duplicate = unique.find((existing) => Math.abs(existing.x - column.x) < 3);
    if (duplicate) {
      if (!duplicate.key && column.key) {
        duplicate.key = column.key;
        duplicate.label = column.label;
      }
      continue;
    }
    if (column.key && unique.some((existing) => existing.key === column.key)) continue;
    unique.push(column);
  }

  const keys = new Set(unique.map((column) => column.key));
  return keys.has("date") && keys.has("description") && (keys.has("amount") || keys.has("debit") || keys.has("credit"))
    ? unique
    : [];
}

function hasDate(value: string): boolean {
  return /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}|\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ]\d{2,4})\b/.test(value);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function valuesForLine(line: PdfLine, columns: PdfColumn[]): string[] {
  const values = columns.map(() => "");
  for (const item of line.items) {
    const x = item.transform?.[4];
    if (!Number.isFinite(x)) continue;
    let columnIndex = 0;
    for (let index = 0; index < columns.length - 1; index += 1) {
      const midpoint = (columns[index].x + columns[index + 1].x) / 2;
      if ((x as number) >= midpoint) columnIndex = index + 1;
      else break;
    }
    if (!columns[columnIndex].key) continue;
    values[columnIndex] = `${values[columnIndex]} ${item.str.trim()}`.trim();
  }
  return values;
}

export function parsePdfPages(
  pages: PositionedPdfTextItem[][],
  fileName: string,
): ImportResult {
  let columns: PdfColumn[] = [];
  const records: string[][] = [];

  for (const page of pages) {
    const lines = groupLines(page);
    const headerIndex = lines.findIndex((line) => {
      const candidate = headerColumns(line);
      return candidate.length > 0;
    });

    if (headerIndex >= 0) {
      columns = headerColumns(lines[headerIndex]);
      if (records.length === 0) records.push(columns.map((column) => column.label));
      for (const line of lines.slice(headerIndex + 1)) {
        const values = valuesForLine(line, columns);
        const dateIndex = columns.findIndex((column) => column.key === "date");
        const descriptionIndex = columns.findIndex((column) => column.key === "description");
        if (hasDate(values[dateIndex] ?? "") && values[descriptionIndex]?.trim()) {
          records.push(values);
        } else if (records.length > 1 && values[descriptionIndex]?.trim()) {
          const previous = records[records.length - 1];
          previous[descriptionIndex] = `${previous[descriptionIndex]} ${values[descriptionIndex]}`.trim();
        }
      }
    } else if (columns.length > 0) {
      for (const line of lines) {
        const values = valuesForLine(line, columns);
        const dateIndex = columns.findIndex((column) => column.key === "date");
        const descriptionIndex = columns.findIndex((column) => column.key === "description");
        if (hasDate(values[dateIndex] ?? "") && values[descriptionIndex]?.trim()) {
          records.push(values);
        } else if (records.length > 1 && values[descriptionIndex]?.trim()) {
          const previous = records[records.length - 1];
          previous[descriptionIndex] = `${previous[descriptionIndex]} ${values[descriptionIndex]}`.trim();
        }
      }
    }
  }

  if (records.length < 2) {
    const hasText = pages.some((page) => page.some((item) => item.str?.trim()));
    return {
      transactions: [],
      skipped: 0,
      warnings: [
        hasText
          ? "Couldn't identify a transaction table in this PDF. It needs selectable text and columns for date, description, and amount, debit, or credit."
          : "This PDF has no selectable text. Scanned/image-only statements need OCR; try exporting the statement as CSV or Excel.",
      ],
      diagnostics: {
        scannedRows: 0,
        validRows: 0,
        invalidRows: 0,
        missingDateRows: 0,
        invalidDateRows: 0,
        ambiguousDateRows: 0,
        headerDetected: false,
      },
    };
  }

  const csv = records.map((record) => record.map(csvCell).join(",")).join("\n");
  return parseTransactionsCsv(csv, fileName);
}
