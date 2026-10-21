import type * as XLSX from "xlsx";
import type { BetImportResult } from "../types.ts";
import { parseBettingPdfPages, parseBettingTableRows } from "./bettingTableImport.ts";
import { parseSportyBetPage } from "./sportyBetImport.ts";

function sourceName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported file";
}

function worksheetRows(sheet: XLSX.WorkSheet, xlsx: typeof import("xlsx")): unknown[][] {
  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
    dateNF: "yyyy-mm-dd",
  }) as unknown[][];
}

export async function parseBettingCsv(source: string, fileName = "betting-history.csv"): Promise<BetImportResult> {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(source, { type: "string", cellDates: true });
    const results = workbook.SheetNames.map((name) => parseBettingTableRows(worksheetRows(workbook.Sheets[name], XLSX), fileName));
    const usable = results.filter((result) => result.bets.length);
    return usable.length
      ? {
          bets: usable.flatMap((result) => result.bets),
          warnings: usable.flatMap((result) => result.warnings),
        }
      : { bets: [], warnings: results.flatMap((result) => result.warnings).slice(0, 3) };
  } catch {
    return { bets: [], warnings: ["This CSV file could not be read. Check that it is a comma-separated betting-history export."] };
  }
}

export async function parseBettingWorkbook(data: ArrayBuffer | Uint8Array, fileName = "betting-history.xlsx"): Promise<BetImportResult> {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    const results = workbook.SheetNames.map((name) => parseBettingTableRows(worksheetRows(workbook.Sheets[name], XLSX), fileName));
    const usable = results.filter((result) => result.bets.length);
    return usable.length
      ? {
          bets: usable.flatMap((result) => result.bets),
          warnings: usable.flatMap((result) => result.warnings),
        }
      : { bets: [], warnings: results.flatMap((result) => result.warnings).slice(0, 3) };
  } catch {
    return { bets: [], warnings: ["This Excel file could not be opened. Try exporting the betting history as .xlsx or CSV."] };
  }
}

export async function parseBettingFile(file: File): Promise<BetImportResult> {
  const name = file.name.toLowerCase();
  if (/\.(mhtml|mht|html|htm)$/i.test(name)) return parseSportyBetPage(await file.text());
  if (/\.csv$/i.test(name)) return parseBettingCsv(await file.text(), file.name);
  if (/\.(xls|xlsx)$/i.test(name)) return parseBettingWorkbook(await file.arrayBuffer(), file.name);
  if (/\.pdf$/i.test(name)) {
    const { readPdfPages } = await import("./pdfImport.ts");
    return parseBettingPdfPages(await readPdfPages(await file.arrayBuffer()), sourceName(file.name));
  }
  return {
    bets: [],
    warnings: ["Choose an HTML/MHTML page, CSV, Excel (.xls/.xlsx), or a text-based PDF betting history file."],
  };
}
