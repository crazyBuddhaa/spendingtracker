# Spendwise

A private, local-first money tracker. Import transaction statements, review spending patterns, set savings goals, and keep betting records separate from everyday expenses.

## Run locally

```sh
npm install
npm run dev
```

`xlsx` is pinned to SheetJS's CDN tarball rather than the npm registry, and recent npm versions refuse remote tarballs by default. The checked-in `.npmrc` sets `allow-remote=all`; if your npm reports `EALLOWREMOTE`, run `npm install --allow-remote=all` or add that line to your user config.

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
Existing dashboard reports display amounts in NGN and assume imported statements use that currency. The Accounts page can additionally label each account's native currency and show optional equivalents using manually entered fixed rates; it does not fetch live exchange rates or alter imported amounts.

### OPay statements

OPay Wallet + Savings workbooks are recognised automatically. Every movement between the wallet and OPay's own savings pots (OWealth, Auto-save, Spend & Save, Targets, Fixed) is treated as your own money moving and left out of income and spending totals. Bank charges (USSD charge, transfer VAT, Electronic Money Transfer Levy, stamp duty, SMS fees, redemption fees) are filed under **Bank fees**; refunds and reversals reduce spending instead of counting as income; football.com/SportyBet stakes and winnings are filed under **Betting**. The time of day is read from the `Trans. Date` column while the date itself comes from `Value Date`, so re-importing an older export does not create duplicates. If the statement header's totals do not match the rows (OPay sometimes prints the credit total as the debit total), the import note says so.

Transfers to or from your own name (in any order, at least two name parts, including PalmPay/PiggyVest prefixes), to your own account number, or top-ups from your own card are flagged as **possible own-account transfers**. Confirm them one by one or all at once to exclude them from totals.

## Working with transactions

- **Edit categories** inline. When other transactions look the same, Spendwise offers to apply the change to all of them and remember it as a **rule** for future imports. Manage rules under **Data & rules**.
- **Recipient profiles** join variations in names from bank statements. Add aliases, a preferred display name, a relationship/group label, a private note, and an automatic category; locked manual categories are never overwritten.
- **Exclude/include** any transaction from totals, **delete** it, or **add** a manual entry (cash spending or cash sales).
- **Periods**: last 30/90 days, this month, last month, last 12 months, this year, all time, or custom dates. When a period has no data the app shows where your history starts and ends.
- **Re-categorise history** (Data & rules) re-runs the latest categorisation over transactions imported with an older version, without touching categories you picked by hand.
- **Classification review** focuses on low-confidence and conflicting suggestions. Search and filter the queue, select a batch to confirm or accept, or adjust a category inline. **Accept & create rule** opens an editable match composer with a live preview of matching history and the number of unlocked categories that will change. Manual entries and hand-picked categories stay protected.

## Accounts, recurring bills and cash flow

- **Accounts** compares native money in, money out, net activity, transaction counts, and latest activity across accounts. Net activity is calculated from saved transactions, not a live bank balance.
- Each account can have its own display currency. Optional converted totals use fixed rates you enter yourself, such as `1 USD = 1500 NGN`; missing rates are shown explicitly rather than guessed. Changing a currency label never changes the underlying imported amounts.
- **Bills & cash flow** provides a month calendar for weekly, monthly, and yearly recurring expenses or income. Add, edit, pause, resume, or delete items and inspect occurrences by day.
- The 30/60/90-day projection starts from an opening balance you enter and applies recurring items to a daily running balance. It excludes variable spending and one-off transactions, skips items without a usable conversion rate, and never creates transactions or initiates payments.

## Insights, budgets and reports

- **Financial behaviour indicators** summarize period cashflow, spending against income, repeated lower-value outflows, recurring costs, budget pace, and estimated income-source mix. Each insight shows the rule and transaction evidence behind it; source labels are inferred from narration/category and never change a transaction. Income-source labels can be corrected per source and reset to automatic; those local overrides are included in backups.
- Cash-flow chart that follows the selected period; spending mix (click a category to see its transactions).
- Top payees and sources of money in, bank fees and levies, average daily spend and the heaviest weekday.
- **Monthly report** (money in, money out after refunds, net, betting, fees, top category) with CSV export.
- **Budgets** per category with month-by-month tracking and a projection for the month in progress; suggested limits use your average over the last three full months.
- **Regular payments** detected from weekly, fortnightly, monthly, quarterly, or yearly payments to the same payee with similar amounts; at least three occurrences are required.
- **Daily and weekly spending trends** compare recent spend pace and transaction frequency with the previous week, alongside peak spending days and weeks.
- **Spending-time and amount flags** highlight rare time windows and unusually large category expenses relative to earlier personal history. They are review prompts, not fraud or error determinations.
- **Spending forecasts** extrapolate month-end and next-30-day spending from the recorded run rate; estimates need a minimum history span and do not model seasonality or upcoming bills.
- **Behavioral spending patterns** summarize the cumulative value of low-cost expenses, compare income and spending across the latest three complete months and the prior three, describe context on high-spend days, flag possible rapid discretionary purchase clusters, and compare spending around recorded income dates with other days. These are descriptive patterns from transaction amounts, categories, dates, and available times; they do not establish emotional triggers or intent.
- **Typical fare ranges** show the 20th–80th percentile of identified Transport payments per payee after three transactions. Statements do not include trip routes, so this is a personal historical range rather than a route-price estimate.
- **Recurring Transport estimates** project a monthly amount only for named payees with at least three similar Transport payments on a steady weekly or monthly cadence.
- **Recipient timing patterns** show repeated outgoing transfers around a similar time of day. Possible recipient pairs and multi-recipient sequences are shown only when the same ordered pattern recurs on at least two dates; these are timing clues, not evidence of a journey or location.
- **Hourly spending, weekday/hour heatmaps, and a spending timeline** use timed expense rows in the selected period. Rows without a valid statement time are excluded from the hour charts and shown as missing coverage; confirmed internal transfers are excluded.

## Backups

**Data & rules → Download backup** saves transactions, goals, circles, bets, recipient profiles, rules, budgets, recurring items, account display preferences, income-source labels, and the projection opening balance in one JSON file. **Restore from file** replaces what is in the browser. Older backups without the newer optional fields remain supported.

If a saved value cannot be read, Spendwise pauses saving and shows a banner offering a raw recovery download before you discard it.

## Cloudflare Access sign-in

The website and financial tracker remain local-first. Cloudflare Access is an optional identity check; signing in does not upload or sync transactions, goals, bets, rules, budgets, or statement files.

To enable the sign-in flow:

1. In Cloudflare Zero Trust → Access → Applications, add a Self-hosted application covering only `/api/me` on your Pages hostname. Leave `/api/auth/start` and the public website outside the Access application so the sign-in button can begin the login flow.
2. Choose an identity provider such as **One-time PIN**, then set an **Allow** policy for the people who should be able to sign in. Copy the application's **Audience (AUD) Tag**.
3. In the Pages project's Variables and Secrets, set `ACCESS_TEAM_DOMAIN` to your team's `https://<team>.cloudflareaccess.com` address and `ACCESS_AUD` to that tag.
4. Redeploy the Pages project.

The sign-in button opens Cloudflare Access and returns to the app. The authenticated `/api/me` endpoint verifies the Access token and returns the normalized email for display; it has no financial-data or storage routes.

For local API testing, copy `wrangler.example.toml` to `wrangler.toml`, set `DEV_USER_EMAIL` for localhost, then run `npm run build && npx wrangler pages dev`.

## Savings and betting

Savings goals store a target and a local contribution history. Contributions are manual tracker entries; the app does not move money between accounts.

The Savings page also supports offline rotating contribution circles: set the contribution amount and interval, member count, your position, current turn, and whether you have already collected in the current rotation. It calculates the pool payout, full cycle length, turns until your next payout, and an approximate date when the current turn date is known. Contributions and payouts can be logged locally; these circle records are separate from personal savings goals and remain in browser `localStorage`.

Betting records have their own ledger and outcome chart, separate from transaction spending. Import a saved SportyBet page (`.mhtml`, `.mht`, or `.html`) or add a record manually. Sport categories include Unclassified, Football, Basketball, Tennis, Volleyball, Rugby, Cricket, Esports, and Other; imported bets start Unclassified when the page does not identify a sport. Categories can be changed per record.

Betting analytics include all-record stake and return totals, resolved net and ROI, win rate for won/lost bets, open stake exposure, average and median stake, return rate, daily/monthly net trends, and breakdowns by category, bet type, and source. ROI uses resolved net divided by resolved stake; open and unknown outcomes are excluded, while void and cashed-out outcomes are treated as resolved. The app also shows record-level highest/lowest resolved net and event details captured by the import. It cannot calculate odds, expected value, or bankroll changes because those fields are not recorded; event-level profit is not attributed across legs in multiple bets.

## Privacy and scope

CSV, Excel, text-based PDF, and saved betting-page parsing run in the browser. Transactions are saved in that browser's IndexedDB (multi-year statements outgrow `localStorage`; data from older versions is moved over automatically), and savings goals, bets, rules, recipient profiles, budgets, recurring items, account display preferences, and projection settings in `localStorage`. Spendwise asks the browser for persistent storage after the first successful load or save so it is less likely to be evicted. Financial records and source files are not sent to a server. Cloudflare Access, when enabled, verifies sign-in identity only. Clearing browser data removes the saved history. The app does not request bank logins or connect to bank APIs. Direct bank feeds require a supported open-banking provider and a separate server-side integration.

## Stack

- React, TypeScript, and Vite
- Browser IndexedDB and `localStorage` for local persistence
- Node's built-in test runner for import, calculation, and API tests (Node 22.13+)
- Optional Cloudflare Pages Functions (`functions/`, `server/`) for Cloudflare Access identity verification

