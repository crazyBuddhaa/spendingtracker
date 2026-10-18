import * as XLSX from "xlsx";
import type { ImportResult } from "../types.ts";
import { parseTransactionsCsv } from "./csv.ts";

export function parseExcelStatement(data: ArrayBuffer | Uint8Array, fileName: string): ImportResult {
  try {
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    const imports = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], {
        blankrows: false,
        dateNF: "yyyy-mm-dd",
      });
      return parseTransactionsCsv(csv, fileName);
    }).filter((result) => result.transactions.length > 0);

    if (imports.length === 0) {
      return {
        transactions: [],
        skipped: 0,
        warnings: [
          "No readable transaction table was found in this workbook. Include date, description, and amount, debit, or credit columns.",
        ],
      };
    }

    return {
      transactions: imports.flatMap((result) => result.transactions),
      skipped: imports.reduce((total, result) => total + result.skipped, 0),
      warnings: imports.flatMap((result) => result.warnings),
    };
  } catch {
    return {
      transactions: [],
      skipped: 0,
      warnings: ["This Excel file could not be opened. Try exporting the statement as .xls, .xlsx, or CSV."],
    };
  }
}
