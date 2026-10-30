import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { parseBettingCsv, parseBettingWorkbook } from "./bettingFileImport.ts";
import { parseBettingPdfPages, parseBettingTableRows } from "./bettingTableImport.ts";
import { normaliseBets, parseSportyBetPage } from "./sportyBetImport.ts";

describe("betting history imports", () => {
  it("maps CSV betting records with common headers and day-first dates", async () => {
    const result = await parseBettingCsv(
      "Bet ID,Date,Event,Bet Type,Sport,Stake,Total Return,Status\nB-123,17/10/2026,Team A v Team B,Multiple,Football,\"1,000.00\",\"2,500.00\",Won",
      "sportybet-history.csv",
    );

    assert.equal(result.bets.length, 1);
    assert.equal(result.bets[0].date, "2026-10-17");
    assert.equal(result.bets[0].category, "Football");
    assert.equal(result.bets[0].betType, "Multiple");
    assert.equal(result.bets[0].status, "won");
    assert.equal(result.bets[0].stake, 1000);
    assert.equal(result.bets[0].returnAmount, 2500);
    assert.deepEqual(result.bets[0].events, ["Team A v Team B"]);
    assert.equal(result.bets[0].source, "sportybet history");
  });

  it("imports Excel sheets and skips unrecognised rows with a note", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["SportyBet history"],
      ["Date", "Match", "Stake", "Payout", "Result"],
      ["2026-10-18", "Team C v Team D", 250, 0, "Lost"],
      ["Totals", "", "", "", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Bets");
    const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const result = await parseBettingWorkbook(data, "bets.xlsx");

    assert.equal(result.bets.length, 1);
    assert.equal(result.bets[0].date, "2026-10-18");
    assert.equal(result.bets[0].status, "lost");
    assert.equal(result.bets[0].stake, 250);
    assert.equal(result.bets[0].returnAmount, 0);
    assert.match(result.warnings[0], /row without a readable date and stake was skipped/i);
  });

  it("imports table rows with a profit column when there is no payout column", () => {
    const result = parseBettingTableRows([
      ["Placed At", "Selection", "Amount Staked", "Profit", "Outcome"],
      ["Oct 19, 2026", "Team E v Team F", 300, 450, "Won"],
    ], "history.csv");

    assert.equal(result.bets.length, 1);
    assert.equal(result.bets[0].date, "2026-10-19");
    assert.equal(result.bets[0].returnAmount, 750);
    assert.equal(result.bets[0].status, "won");
  });

  it("extracts a positioned betting table from a text PDF", () => {
    const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
    const pages = [[
      item("Date", 10, 100),
      item("Event", 80, 100),
      item("Stake", 260, 100),
      item("Return", 330, 100),
      item("Status", 400, 100),
      item("20/10/2026", 10, 80),
      item("Team G v Team H", 80, 80),
      item("500", 260, 80),
      item("900", 330, 80),
      item("Won", 400, 80),
    ]];
    const result = parseBettingPdfPages(pages, "bet-history.pdf");

    assert.equal(result.bets.length, 1);
    assert.equal(result.bets[0].date, "2026-10-20");
    assert.equal(result.bets[0].stake, 500);
    assert.equal(result.bets[0].returnAmount, 900);
    assert.equal(result.bets[0].status, "won");
    assert.deepEqual(result.bets[0].events, ["Team G v Team H"]);
  });

  it("explains when a spreadsheet does not contain a betting table", () => {
    const result = parseBettingTableRows([
      ["Name", "Comment"],
      ["Sample", "No bet data"],
    ]);

    assert.equal(result.bets.length, 0);
    assert.match(result.warnings[0], /couldn't find betting columns/i);
  });

  it("derives stakes from Return and P/L when the file has no stake column", () => {
    const result = parseBettingTableRows([
      ["Date", "Selections", "Total Return", "Profit", "Status"],
      ["2026-10-21", "Team I v Team J", "800", "300", "Won"],
      ["2026-10-22", "Team K v Team L", "0", "-1200", "Lost"],
    ], "betting.csv");

    assert.equal(result.bets.length, 2);
    assert.equal(result.bets[0].stake, 500);
    assert.equal(result.bets[0].returnAmount, 800);
    assert.equal(result.bets[1].stake, 1200);
    assert.equal(result.bets[1].status, "lost");
    assert.match(result.warnings.join(" "), /derived from return − profit/i);
  });

  it("accepts Total Bet and Returns as stake and payout headers", () => {
    const result = parseBettingTableRows([
      ["Date", "Event", "Total Bet", "Returns", "Outcome"],
      ["2026-10-23", "Team M v Team N", "2,000", "3,600", "Won"],
    ], "history.csv");

    assert.equal(result.bets.length, 1);
    assert.equal(result.bets[0].stake, 2000);
    assert.equal(result.bets[0].returnAmount, 3600);
  });

  it("imports SportyBet cards that lack a return label, and reads dd/mm/yyyy card dates", () => {
    const html = [
      '<div data-op="bet-history-card-261301"><div>Single</div><div>Total stake</div><div>₦1,500</div><div>05/02/2026</div><div>Enyimba v Kano Pillars</div><div>Lost</div></div>',
    ].join("");
    const result = parseSportyBetPage(`<html><body>${html}</body></html>`);
    const bets = normaliseBets(result.bets);

    assert.equal(bets.length, 1);
    assert.equal(bets[0].date, "2026-02-05");
    assert.equal(bets[0].stake, 1500);
    assert.equal(bets[0].returnAmount, 0);
    assert.equal(bets[0].status, "lost");
    assert.deepEqual(bets[0].events, ["Enyimba v Kano Pillars"]);
  });
});
