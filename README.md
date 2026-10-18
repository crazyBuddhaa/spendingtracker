# Spendwise

A private, local-first money tracker. Import transaction statements, review spending patterns, set savings goals, and keep betting records separate from everyday expenses.

## Run locally

```sh
npm install
npm run dev
```

Build and test:

```sh
npm test
npm run build
```

## Importing statements

Use **Import statement** to select `.csv`, `.xls`, `.xlsx`, or text-based `.pdf` files. Excel workbooks are read sheet by sheet; PDFs need selectable text and a readable transaction table. Scanned/image-only or password-protected PDFs are not OCR'd. Spendwise recognizes common English headers for date, description/narration, amount, debit, credit, and transaction type, including header rows that follow statement metadata. It accepts OPay-style `Date / Transaction Details / Amount / Type`, Access Bank-style `Value Date / Narration / Debit / Credit`, and Moniepoint-style `Date / Narration / Dr / Cr` tables. Dates can be ISO (`2026-10-16`), day-first (`16/10/2026`), or month-name dates such as `16-Oct-2026`. Filenames containing `OPay`, `Access`, or `Moniepoint` are used as the account label.

For the clearest results, export statements with separate **Debit** and **Credit** columns. A signed Amount column and a Debit/Credit or Type column are also supported. If a file has only positive amounts without a type column, positive rows are treated as spending unless their descriptions clearly indicate income; the app displays a warning so you can review the assumption.

These are flexible column mappings, not certified parsers for every bank export. PDF layouts vary by bank, so review imported rows and totals. Some text-based PDF tables may still need to be exported as CSV or Excel.

`sample-data/demo-transactions.csv` is fictional and can be used to try the import flow.
The initial version displays amounts in NGN and assumes imported statements use the same currency; it does not perform foreign-exchange conversion.

## Savings and betting

Savings goals store a target and a local contribution history. Contributions are manual tracker entries; the app does not move money between accounts.

Betting records have their own ledger and outcome chart, separate from transaction spending. Import a saved SportyBet page (`.mhtml`, `.mht`, or `.html`) or add a record manually. Sport categories include Unclassified, Football, Basketball, Tennis, Volleyball, Rugby, Cricket, Esports, and Other; imported bets start Unclassified when the page does not identify a sport. Categories can be changed per record.

## Privacy and scope

CSV, Excel, text-based PDF, and saved betting-page parsing run in the browser. Transactions, savings goals, and bets are saved in that browser's `localStorage`; source files and records are not sent to a server. Clearing browser data removes the saved history. The app does not request bank logins or connect to bank APIs. Direct bank feeds require a supported open-banking provider and a separate server-side integration.

## Stack

- React, TypeScript, and Vite
- Browser `localStorage` for local persistence
- Node's built-in test runner for import and calculation tests (Node 22.13+)

