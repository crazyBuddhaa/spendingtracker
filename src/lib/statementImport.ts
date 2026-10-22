import type { ImportResult } from "../types.ts";
import { parseTransactionsCsv } from "./csv.ts";

export async function parseStatementFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv")) {
    return parseTransactionsCsv(await file.text(), file.name);
  }

  if (name.endsWith(".xls") || name.endsWith(".xlsx")) {
    const { parseExcelStatement } = await import("./excelImport.ts");
    return parseExcelStatement(await file.arrayBuffer(), file.name);
  }

  if (name.endsWith(".pdf")) {
    const { parsePdfStatement } = await import("./pdfImport.ts");
    return parsePdfStatement(await file.arrayBuffer(), file.name);
  }

  return {
    transactions: [],
    skipped: 0,
    warnings: ["Unsupported file. Choose a CSV, Excel (.xls/.xlsx), or text-based PDF statement."],
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
