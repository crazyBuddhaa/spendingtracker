import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { parseTransactionsCsv } from "./csv.ts";
import { expandSheetRange, parseExcelStatement } from "./excelImport.ts";
import { calculateTotals } from "./insights.ts";

describe("Excel statement imports", () => {
  it("parses a legacy XLS workbook using the existing transaction mapper", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Date", "Narration", "Debit", "Credit"],
      [new Date("2026-10-16T00:00:00Z"), "Market purchase", 3500, ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Transactions");
    const data = XLSX.write(workbook, { bookType: "xls", type: "array" });
    const result = parseExcelStatement(data, "access_bank.xls");

    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].date, "2026-10-16");
    assert.equal(result.transactions[0].source, "Access Bank");
    assert.equal(result.transactions[0].amount, 3500);
    assert.equal(result.transactions[0].direction, "expense");
  });

  it("expands OPay preamble rows, pairs OWealth entries, and reports summary mismatches", () => {
    const header = ["Transaction Date", "Value Date", "Description", "Debit (₦)", "Credit (₦)", "Balance After (₦)", "Channel", "Reference"];
    const makeSheet = (accountType, debitTotal, debitCount, creditTotal, creditCount, rows) => XLSX.utils.aoa_to_sheet([
      [`${accountType} Statement`],
      ["Account Name", "Test User", "Account Number", "masked"],
      ["Account Type", accountType],
      ["Opening Balance", "₦0.00", "Total Debit", `₦${debitTotal.toFixed(2)}`, "Debit Count", String(debitCount)],
      ["Closing Balance", "₦0.00", "Total Credit", `₦${creditTotal.toFixed(2)}`, "Credit Count", String(creditCount)],
      [],
      header,
      ...rows,
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, makeSheet(
      "Wallet Account",
      23,
      3,
      20,
      1,
      [
        ["16-Oct-2026", "16-Oct-2026", "Transfer to Test User | Local Bank", 10, "", 0, "Transfer", "W1"],
        ["16-Oct-2026", "16-Oct-2026", "Betting | 123 | SPORTYBET", 7, "", 0, "Betting", "W2"],
        ["16-Oct-2026", "16-Oct-2026", "OWealth Deposit", 5, "", 0, "OWealth", "W3"],
        ["16-Oct-2026", "16-Oct-2026", "Transfer from Test User | Local Bank", "", 20, 20, "Transfer", "W4"],
      ],
    ), "Wallet Account Transactions");
    XLSX.utils.book_append_sheet(workbook, makeSheet(
      "Savings Account",
      0,
      0,
      5,
      1,
      [["16-Oct-2026", "16-Oct-2026", "OWealth Deposit", "", 5, 5, "OWealth", "S1"]],
    ), "Savings Account Transactions");

    const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const result = parseExcelStatement(data, "opay-history.xlsx");

    assert.equal(result.transactions.length, 5);
    assert.equal(result.transactions.filter((item) => item.source === "OPay Wallet").length, 4);
    assert.equal(result.transactions.filter((item) => item.source === "OPay Savings").length, 1);
    assert.equal(result.transactions.filter((item) => item.ownAccountCandidate).length, 2);
    assert.equal(result.transactions.filter((item) => item.internalTransfer).length, 2);
    assert.equal(result.transactions.find((item) => item.category === "Betting")?.amount, 7);
    assert.ok(result.warnings.some((warning) => /summary and transaction rows do not agree/.test(warning)));
    assert.ok(result.warnings.some((warning) => /Matched 1 OPay Wallet↔Savings transfer pair/.test(warning)));
    assert.deepEqual(
      { income: calculateTotals(result.transactions).income, expenses: calculateTotals(result.transactions).expenses },
      { income: 20, expenses: 17 },
    );
  });

  it("finds the account holder in non-OPay header layouts", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Kuda Bank statement"],
      [],
      [],
      ["Account Name", "Oluwafemi Adedamola Adekanmi"],
      ["Account Number", "2030766703"],
      ["Account Type", "Savings"],
      [],
      ["Date", "Description", "Debit", "Credit"],
      ["2026-10-01", "Transfer to OLUWAFEMI ADEDAMOLA ADEKANMI | Palmpay | 8147119891", 2000, ""],
      ["2026-10-02", "Transfer to ISAAC ADEKANMI | OPay | 1", 700, ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Transactions");
    const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const result = parseExcelStatement(data, "kuda_statement.xlsx");

    assert.equal(result.transactions.length, 2);
    assert.equal(result.transactions[0].ownAccountCandidate, true);
    assert.notEqual(result.transactions[1].ownAccountCandidate, true);
  });

  it("expands a worksheet range back to A1 so earlier rows remain readable", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Statement export"],
      [],
      [],
      [],
      [],
      [],
      ["Date", "Description", "Debit", "Credit"],
      ["2026-10-16", "Market purchase", 900, ""],
    ]);
    sheet["!ref"] = "A10:H12";
    expandSheetRange(sheet);
    assert.equal(sheet["!ref"], "A1:H12");
    const result = parseTransactionsCsv(XLSX.utils.sheet_to_csv(sheet, { blankrows: false }), "range-test.xlsx");
    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].amount, 900);
  });

});
