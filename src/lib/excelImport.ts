import * as XLSX from "xlsx";
import type { ImportResult } from "../types.ts";
import { parseStatementSheets, type StatementSheet } from "./workbookStatement.ts";

type Worksheet = XLSX.WorkSheet;

function cellText(sheet: Worksheet, address: string): string {
  const value = sheet[address]?.v;
  return value === undefined || value === null ? "" : String(value).trim();
}

export function expandSheetRange(sheet: Worksheet): void {
  if (!sheet["!ref"]) return;
  const current = XLSX.utils.decode_range(sheet["!ref"]);
  // Some OPay exports contain metadata and headers before the worksheet's declared !ref.
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: current.e });
}

export function parseExcelStatement(data: ArrayBuffer | Uint8Array, fileName: string): ImportResult {
  let sheets: StatementSheet[];
  try {
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    sheets = workbook.SheetNames.map((name): StatementSheet => {
      const sheet = workbook.Sheets[name];
      expandSheetRange(sheet);
      return {
        name,
        csv: XLSX.utils.sheet_to_csv(sheet, { blankrows: false, dateNF: "yyyy-mm-dd" }),
        cell: (address: string) => cellText(sheet, address),
      };
    });
  } catch {
    return {
      transactions: [],
      skipped: 0,
      warnings: ["This Excel file could not be opened. Try exporting the statement as .xls, .xlsx, or CSV."],
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
  return parseStatementSheets(sheets, fileName);
}
