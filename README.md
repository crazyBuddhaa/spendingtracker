# Spendwise

A private, local-first spending analyzer. Import transaction CSV statements from multiple bank accounts to review income, outgoing payments, monthly cash flow, spending categories, and the transactions behind each insight.

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

Use **Import statement** and select one or more `.csv` files. Spendwise recognizes common English headers for date, description/narration, amount, debit, credit, and transaction type. Dates can be ISO (`2026-10-16`) or day-first (`16/10/2026`). When importing multiple files, each filename is used as the account label.

For the clearest results, export statements with separate **Debit** and **Credit** columns. A signed Amount column and a Debit/Credit or Type column are also supported. If a file has only positive amounts without a type column, positive rows are treated as spending unless their descriptions clearly indicate income; the app displays a warning so you can review the assumption.

`sample-data/demo-transactions.csv` is fictional and can be used to try the import flow.
The initial version displays amounts in NGN and assumes imported statements use the same currency; it does not perform foreign-exchange conversion.

## Privacy and scope

CSV parsing and analysis run in the browser. Imported rows are saved in that browser's `localStorage`; statement files and transactions are not sent to a server. Clearing browser data removes the saved history. The app does not request bank logins or connect to bank APIs. Direct bank feeds require a supported open-banking provider and a separate server-side integration.

## Stack

- React, TypeScript, and Vite
- Browser `localStorage` for local persistence
- Node's built-in test runner for CSV and calculation tests (Node 22.6+)

