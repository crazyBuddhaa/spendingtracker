import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTransactionsCsv } from "./csv.ts";
import { refreshCategories } from "./categorise.ts";
import {
  calculateTotals,
  getCategoryTotals,
  getMonthlySeries,
  getMonthlyTotals,
  largestExpense,
} from "./insights.ts";

let nextId = 0;
function tx(overrides = {}) {
  nextId += 1;
  return {
    id: `tx-${nextId}`,
    date: "2026-10-10",
    description: "Test transaction",
    amount: 100,
    direction: "expense",
    category: "Other",
    source: "Test Bank",
    ...overrides,
  };
}

describe("money out reconciliation", () => {
  const transactions = [
    tx({ description: "Salary", amount: 100000, direction: "income", category: "Income" }),
    tx({ description: "Market", amount: 20000, category: "Food & groceries" }),
    tx({ description: "Transfer to Jane | Bank", amount: 30000, category: "Transfers" }),
    tx({ description: "Transfer to own account", amount: 50000, category: "Transfers", internalTransfer: true }),
    tx({ description: "Reversal", amount: 2000, direction: "income", category: "Refunds" }),
    tx({ description: "Transfer from Ada | Bank", amount: 15000, direction: "income", category: "Transfers" }),
  ];

  it("splits money out into spending and external transfers without counting internal moves", () => {
    const totals = calculateTotals(transactions);
    assert.equal(totals.income, 115000);
    assert.equal(totals.transfersIn, 15000);
    assert.equal(totals.refunds, 2000);
    assert.equal(totals.spending, 18000);
    assert.equal(totals.transfersOut, 30000);
    assert.equal(totals.expenses, 48000);
    assert.equal(totals.expenses, totals.spending + totals.transfersOut);
    assert.equal(totals.net, 67000);
    assert.equal(totals.internalTransfersOut, 50000);
    assert.equal(totals.internalTransferCount, 1);
  });

  it("category breakdown adds up to the same Money out figure", () => {
    const totals = calculateTotals(transactions);
    const categories = getCategoryTotals(transactions);
    const sum = categories.reduce((total, item) => total + item.amount, 0);
    assert.equal(sum, totals.expenses);
    assert.equal(categories.find((item) => item.category === "Transfers")?.amount, 30000);
    assert.equal(categories.find((item) => item.category === "Refunds")?.amount, -2000);
    assert.ok(Math.abs(categories.reduce((total, item) => total + item.share, 0) - 100) < 1e-9);
  });

  it("monthly charts use the same money-out rule as the totals card", () => {
    const dated = [
      ...transactions,
      tx({ date: "2026-09-03", description: "Transfer to Sam | Bank", amount: 7000, category: "Transfers" }),
      tx({ date: "2026-09-04", description: "Rent", amount: 5000, category: "Rent & housing" }),
    ];
    const totals = calculateTotals(dated);
    const series = getMonthlySeries(dated, { start: null, end: null });
    assert.equal(series.reduce((sum, month) => sum + month.income, 0), totals.income);
    assert.equal(series.reduce((sum, month) => sum + month.expenses, 0), totals.expenses);
    assert.equal(series[0].expenses, 7000 + 5000);
    assert.equal(series[1].expenses, 48000);
    const six = getMonthlyTotals(dated, 3, new Date(2026, 9, 20));
    assert.equal(six.reduce((sum, month) => sum + month.expenses, 0), 7000 + 5000 + 48000);
  });

  it("confirms own-account candidates without touching genuine spending", () => {
    const imported = [
      tx({ description: "Salary", amount: 100000, direction: "income", category: "Income" }),
      tx({ description: "Market", amount: 20000, category: "Food & groceries" }),
      tx({ description: "Transfer to OLUWAFEMI ADEDAMOLA ADEKANMI | Kuda MFB", amount: 30000, category: "Transfers", ownAccountCandidate: true }),
      tx({ description: "Transfer to Jane | Bank", amount: 10000, category: "Transfers" }),
      tx({ description: "Reversal", amount: 1000, direction: "income", category: "Refunds" }),
    ];
    const before = calculateTotals(imported);
    const after = calculateTotals(imported.map((item) => item.ownAccountCandidate
      ? { ...item, internalTransfer: true, ownAccountCandidate: false }
      : item));
    assert.equal(after.spending, before.spending);
    assert.equal(after.transfersOut, before.transfersOut - 30000);
    assert.equal(after.expenses, before.expenses - 30000);
    assert.equal(after.internalTransfersOut, 30000);
  });

  it("picks the largest genuine spending payment, not a transfer", () => {
    const payment = largestExpense([
      tx({ description: "Transfer to Jane", amount: 50000, category: "Transfers" }),
      tx({ description: "Own move", amount: 40000, category: "Transfers", internalTransfer: true }),
      tx({ description: "Rent", amount: 25000, category: "Rent & housing" }),
    ]);
    assert.equal(payment?.description, "Rent");
  });
});

describe("internal transfer classification across banks and wallets", () => {
  it("flags own-name transfers at OPay, Kuda, PalmPay, Moniepoint and Access, but not relatives", () => {
    const result = parseTransactionsCsv(
      [
        "Date,Description,Debit,Credit",
        "2026-10-01,Transfer from OLUWAFEMI ADEDAMOLA ADEKANMI | Kuda MFB | 203****703,,5000",
        "2026-10-02,Transfer to OLUWAFEMI ADEDAMOLA ADEKANMI | Palmpay | 8147119891,2000,",
        "2026-10-03,Transfer to OLUWAFEMI ADEDAMOLA ADEKANMI | MONIE POINT | 507****591,3000,",
        "2026-10-04,Transfer to OLUWAFEMI ADEDAMOLA ADEKANMI | Access Bank | 122****640,4000,",
        "2026-10-05,Add Money-Bank Card | Access Bank | 418745******4190,,6000",
        "2026-10-06,Transfer to ISAAC ADEKANMI | OPay | 811****152,700,",
        "2026-10-07,OWealth Deposit,1000,",
      ].join("\n"),
      "opay.csv",
      { accountHolderName: "OLUWAFEMI ADEDAMOLA ADEKANMI", accountNumber: "8147119891" },
    ).transactions;

    for (const index of [0, 1, 2, 3, 4]) {
      assert.equal(result[index].category, "Transfers");
      assert.equal(result[index].ownAccountCandidate, true);
      assert.notEqual(result[index].internalTransfer, true);
    }
    assert.notEqual(result[5].ownAccountCandidate, true);
    assert.equal(result[6].internalTransfer, true);
    assert.equal(result[6].category, "Transfers");
  });

  it("keeps a manually confirmed internal transfer when categories are refreshed", () => {
    const confirmed = tx({ description: "Transfer to Jane | Bank", category: "Transfers", internalTransfer: true, categoryLocked: true });
    const { transactions } = refreshCategories([confirmed], []);
    assert.equal(transactions[0].internalTransfer, true);
    assert.equal(transactions[0].category, "Transfers");
  });
});
