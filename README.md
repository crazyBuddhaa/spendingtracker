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

### OPay statements

OPay Wallet + Savings workbooks are recognised automatically. Every movement between the wallet and OPay's own savings pots (OWealth, Auto-save, Spend & Save, Targets, Fixed) is treated as your own money moving and left out of income and spending totals. Bank charges (USSD charge, transfer VAT, Electronic Money Transfer Levy, stamp duty, SMS fees, redemption fees) are filed under **Bank fees**; refunds and reversals reduce spending instead of counting as income; football.com/SportyBet stakes and winnings are filed under **Betting**. The time of day is read from the `Trans. Date` column while the date itself comes from `Value Date`, so re-importing an older export does not create duplicates. If the statement header's totals do not match the rows (OPay sometimes prints the credit total as the debit total), the import note says so.

Transfers to or from your own name (in any order, at least two name parts, including PalmPay/PiggyVest prefixes), to your own account number, or top-ups from your own card are flagged as **possible own-account transfers**. Confirm them one by one or all at once to exclude them from totals.

## Working with transactions

- **Edit categories** inline. When other transactions look the same, Spendwise offers to apply the change to all of them and remember it as a **rule** for future imports. Manage rules under **Data & rules**.
- **Exclude/include** any transaction from totals, **delete** it, or **add** a manual entry (cash spending or cash sales).
- **Periods**: last 30/90 days, this month, last month, last 12 months, this year, all time, or custom dates. When a period has no data the app shows where your history starts and ends.
- **Re-categorise history** (Data & rules) re-runs the latest categorisation over transactions imported with an older version, without touching categories you picked by hand.

## Insights, budgets and reports

- Cash-flow chart that follows the selected period; spending mix (click a category to see its transactions).
- Top payees and sources of money in, bank fees and levies, average daily spend and the heaviest weekday.
- **Monthly report** (money in, money out after refunds, net, betting, fees, top category) with CSV export.
- **Budgets** per category with month-by-month tracking and a projection for the month in progress; suggested limits use your average over the last three full months.
- **Regular payments** detected from weekly or monthly payments to the same payee with similar amounts.

## Backups

**Data & rules → Download backup** saves transactions, goals, circles, bets, rules and budgets in one JSON file. **Restore from file** replaces what is in the browser.

Signed-in users can also create an on-demand cloud backup under **Data & rules → Cloud sync and storage**. The snapshot is saved in R2 and can be downloaded in the same JSON format for **Restore from file**. Cloud backups include D1 transactions and synced collections; original statement files remain separate R2 objects.

## Cloud sync with Cloudflare (D1 + R2 + Access)

The website is public. Guests use browser storage only; signing in with an email code enables per-email cloud sync:

- **D1** stores transactions, savings goals, circles, bets, rules, and budgets, scoped to the signed-in email.
- **R2** keeps the original statement files you import (CSV, Excel, PDF; up to 25 MB each, de-duplicated) and on-demand account backup snapshots. Download or delete them under **Data & rules**.
- **Cloudflare Access** protects only `/api/*`, not the public website. The API verifies the Access token (signature, audience, issuer, expiry) on every request and refuses cloud access until Access is configured.
- The browser keeps a copy, so the app opens instantly and works offline; changes made offline are queued (even across reloads) and sync when you reconnect. Other devices pick up changes on focus and every minute.
- Guests stay local until they choose **Sign in to sync**. On first sign-in, history already saved in that browser is uploaded to that email's cloud account.

Without these bindings (or with `npm run dev`), the app works exactly as before, storing everything in the browser.

### One-time setup

Run these from the project folder (log in with `npx wrangler login` first):

```sh
npx wrangler d1 create spendwise
npx wrangler d1 execute spendwise --remote --file=migrations/0001_init.sql
npx wrangler d1 execute spendwise --remote --file=migrations/0002_scrub_transaction_tombstones.sql
npx wrangler d1 execute spendwise --remote --file=migrations/0003_cloud_backups.sql
npx wrangler r2 bucket create spendwise-statements
```

Then in the Cloudflare dashboard:

1. **Bindings**: Workers & Pages → your Pages project → Settings → Bindings → Add:
   - D1 database: variable name `DB` → `spendwise`
   - R2 bucket: variable name `STATEMENTS` → `spendwise-statements`
2. **Access**: Zero Trust → Access → Applications → Add or update a Self-hosted application:
   - Protect only each API path, such as `your-project.pages.dev/api/*` and `your-domain.example/api/*`. Do not add a hostname-wide rule; the public website must remain open to guests.
   - For self-service accounts, use the *One-time PIN* identity provider and an *Allow* policy that includes *Everyone*. To make the app private, replace *Everyone* with an explicit email allowlist.
   - After saving, copy the **Application Audience (AUD) Tag** from the application's overview.
3. **Variables**: Pages project → Settings → Variables and Secrets (Production):
   - `ACCESS_TEAM_DOMAIN` = `https://<your-team-name>.cloudflareaccess.com` (your team name is under Zero Trust → Settings → Custom pages)
   - `ACCESS_AUD` = the AUD tag from step 2
4. **Redeploy** the latest deployment (Deployments → ⋯ → Retry deployment) so the bindings and variables take effect.

Open the public site as a guest to keep data in the browser, or choose **Sign in to sync** and enter the emailed code. The sidebar should then show **Synced to Cloudflare**. To change the schema later, add a new file in `migrations/` and run it with the same `d1 execute` command.

To run the app with its API locally, copy `wrangler.example.toml` to `wrangler.toml`, fill in the IDs, set `DEV_USER_EMAIL`, then `npm run build && npx wrangler pages dev`.

## Savings and betting

Savings goals store a target and a local contribution history. Contributions are manual tracker entries; the app does not move money between accounts.

The Savings page also supports offline rotating contribution circles: set the contribution amount and interval, member count, your position, current turn, and whether you have already collected in the current rotation. It calculates the pool payout, full cycle length, turns until your next payout, and an approximate date when the current turn date is known. Contributions and payouts can be logged locally; these circle records are separate from personal savings goals and remain in browser `localStorage`.

Betting records have their own ledger and outcome chart, separate from transaction spending. Import a saved SportyBet page (`.mhtml`, `.mht`, or `.html`) or add a record manually. Sport categories include Unclassified, Football, Basketball, Tennis, Volleyball, Rugby, Cricket, Esports, and Other; imported bets start Unclassified when the page does not identify a sport. Categories can be changed per record.

Betting analytics include all-record stake and return totals, resolved net and ROI, win rate for won/lost bets, open stake exposure, average and median stake, return rate, daily/monthly net trends, and breakdowns by category, bet type, and source. ROI uses resolved net divided by resolved stake; open and unknown outcomes are excluded, while void and cashed-out outcomes are treated as resolved. The app also shows record-level highest/lowest resolved net and event details captured by the import. It cannot calculate odds, expected value, or bankroll changes because those fields are not recorded; event-level profit is not attributed across legs in multiple bets.

## Privacy and scope

With cloud sync set up, signed-in data is stored in your Cloudflare account (D1 and R2), behind your Cloudflare Access login; guest data stays in the browser:

CSV, Excel, text-based PDF, and saved betting-page parsing run in the browser. Transactions are saved in that browser's IndexedDB (multi-year statements outgrow `localStorage`; data from older versions is moved over automatically), and savings goals, bets, rules, and budgets in `localStorage`; source files and records are not sent to a server. Clearing browser data removes the saved history. The app does not request bank logins or connect to bank APIs. Direct bank feeds require a supported open-banking provider and a separate server-side integration.

## Stack

- React, TypeScript, and Vite
- Browser IndexedDB and `localStorage` for local persistence
- Node's built-in test runner for import, calculation, and API tests (Node 22.13+)
- Optional Cloudflare Pages Functions (`functions/`, `server/`) with D1, R2, and Access

