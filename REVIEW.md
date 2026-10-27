# Spendwise — code review

Reviewed commit `f6edfc5` (main, 27 Oct 2026) in a local clone.

## What it is

A local-first personal finance tracker: import bank statements (CSV/XLS/XLSX/text PDF),
categorise transactions with rules and a review queue, and explore dashboards, budgets,
recurring bills, savings goals/circles and a betting ledger. Optional Cloudflare Access
identity check on `/api/me`. No financial data leaves the browser.

- React 18 + TypeScript 5.7 + Vite 6, `strict: true`, `noUnusedLocals/Parameters`.
- ~11.7k lines of app code in 53 files, ~2.2k lines of tests in 14 files (134 test cases, 140 with suites).
- Persistence: transactions in IndexedDB (`src/lib/persistentStore.ts`), everything else in `localStorage`.
- Server: two routes (`/api/auth/start`, `/api/me`) in `server/`, exposed by `functions/api/[[path]].ts`.

### Architecture map

| Area | Files |
| --- | --- |
| App shell, all state and handlers | `src/App.tsx` (2,136 lines) |
| Import pipeline | `statementImport` → `csv` / `excelImport` / `pdfImport` → `workbookStatement`, `pdfText` |
| Classification | `categorise`, `transactionIntelligence`, `transactionReview`, `recipientProfiles` |
| Analytics | `insights`, `analytics`, `spending*`, `timeSpendingAnalytics`, `financialIndicators` |
| Persistence/backup | `transactionStorage`, `persistentStore`, `backup` |
| Auth | `server/auth.ts`, `server/api.ts`, `src/useAccessAuth.ts`, `src/lib/accessApi.ts` |

## Verified locally

| Check | Result |
| --- | --- |
| `node --experimental-strip-types --test src/lib/*.test.mjs server/*.test.mjs` | 140/140 pass |
| `npm run build` (`tsc -b && vite build`) | passes; `index` 505 kB (145 kB gzip), `pdfImport` 487 kB, `xlsx` 500 kB, pdf worker 1.26 MB |
| `npm install` (npm 12 defaults) | **fails**, see H1 |
| `npm run preview` + browser smoke test | app renders, demo data charts and metrics compute, one console 404 for `/api/me` when Access is not configured (handled in UI) |

## High

### H1. `npm install` fails on npm 12 because `xlsx` is a remote tarball

`package.json:18` pins `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`.
npm 12 defaults to `allow-remote=none`, so a clean install stops with:

```
npm error code EALLOWREMOTE
npm error Refusing to fetch "xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

npm 12 also blocks dependency install scripts by default (`esbuild` postinstall), which makes
`npm install` exit non-zero even when the tree is usable. The README's two-line "Run locally"
recipe therefore does not work for a new contributor or a CI runner on current Node/npm.

Recommendation: vendor the tarball into the repo, move to the registry `xlsx` build (0.18.5),
or pin the install recipe (`.npmrc` with `allow-remote`/`allowScripts`, or a documented
`npm install --allow-remote=all`) and add CI so this cannot regress. The lockfile does carry an
integrity hash, so supply-chain integrity is fine; the problem is installability and `npm audit`
coverage.

### H2. Unreadable/corrupt storage is treated as "no data" and then overwritten

`parseStoredTransactions` returns `[]` both for a genuinely empty history and for corrupt JSON
(`src/lib/transactionStorage.ts:76-78`, `:120-122`), and `App.tsx:307-317` happily sets
`loaded = true` with an empty list. Verified:

```
parseStoredTransactions("{not json") -> []
parseStoredTransactions("[]")        -> []
```

After that, any edit or import writes the new (possibly near-empty) list back over the stored
value (`App.tsx:319-331`). The same pattern exists for rules, budgets, goals, bets and
preferences: `readJson` swallows parse errors and returns `[]`
(`App.tsx:166-172`), then the next `update*` call persists the empty array.

This is the worst failure mode for an app whose only copy of the data is local: a truncated
IndexedDB/localStorage value looks exactly like a fresh install.

Recommendation: return a discriminated result (`{status: "ok" | "empty" | "corrupt"; value}`),
keep the raw string aside when parsing fails, block saves and show a recovery banner offering to
download the raw value. Add a test for corrupt/partial payloads.

### H3. Projection opening balance is not in the backup

`createBackup` (`src/lib/backup.ts:62-77`) covers transactions, goals, circles, bets, rules,
budgets, profiles, bills, account preferences and income-source overrides — but not
`spendwise.projection-opening-balance.v1` (`App.tsx:106`, `:271`). Restoring on a new browser
silently resets the bills/cash-flow projection to a zero opening balance, and the README's
privacy section lists "projection settings" among the saved settings. Add the field to
`BackupData` and `restoreBackup`, and cover it with a round-trip test.

## Medium

### M1. Incoming rows can be classified as spending

`inferDirection` tests expense keywords first and "payment" is greedy
(`src/lib/csv.ts:217-226`). Verified against a signed-amount CSV with no type column:

```
2026-10-05  Payment from CLIENT ACME   -> expense / Other     (should be income)
2026-10-06  Credit payment received    -> expense / Other     (should be income)
2026-10-07  TRANSFER FROM JOHN DOE     -> income  / Income    (ok)
```

The README warns that positive amounts default to spending, but here the narration *does*
suggest income and is still misread, which removes real income from totals and inflates spending.
Check directional cues ("from", "received", "credit", "inbound") before generic "payment", and
require "payment to/for" for outgoing.

### M2. Deduplication is filename/source sensitive

`sourceName` derives the account label from the filename for anything that is not OPay, Access
Bank or Moniepoint (`src/lib/csv.ts:242-249`), and both the dedupe key and the transaction id
include that source (`src/lib/transactionDeduplication.ts:3-10`, `csv.ts:251-259`). Verified:

```
same rows, same filename            -> 0 new
same rows, "GTBank statement (1).csv" -> 1 new
```

Re-downloading a statement creates a second account and double-counts every row. Normalise
filenames (strip " (1)", "(2)", date stamps), or dedupe on date/amount/description across sources
and surface a warning instead of importing silently.

### M3. CSV parser assumes commas

`readCsvRecords` only splits on commas (`src/lib/csv.ts:79-111`). Semicolon-delimited exports
(the Excel default in many locales) and tab-separated exports fail with "Couldn't identify the
required columns". Sniff the delimiter from the header line; it is a small change with a big
compatibility win.

### M4. PDF parsing folds footer/total lines into the previous transaction

`pdfText.ts:152-166` appends any description-cell text on a non-dated line to the previous row,
which is right for wrapped descriptions but also catches totals and page footers. Verified:

```
'17/10/2026 | TRANSFER TO JOHN Total withdrawals: Page 1 of 2 | 2000'
```

Repeated table headers are skipped correctly when they are detected as a header line, but
footers are not filtered. Ignore lines matching totals/footer patterns before merging, and keep
the raw narration available for review.

### M5. No storage persistence request or quota handling

Nothing calls `navigator.storage.persist()` or `estimate()`. All financial history lives in one
browser origin; under storage pressure the browser may evict it. Request persistent storage when
the first import succeeds, show quota/usage in Data & rules, and keep the backup reminder
prominent.

### M6. Whole-array rewrites on every change

Each transaction edit re-serialises and rewrites the entire array to IndexedDB
(`App.tsx:319-331`, `transactionStorage.ts:32-58`), debounced 250 ms. With the multi-year history
the README advertises (tens of thousands of rows), that is O(n) string work per edit and one large
value to write. Consider an object store keyed by transaction id, or chunked/append-only writes,
and measure with a 50k-row fixture.

### M7. App.tsx is a single 2,136-line component with no tests, no lint, no CI

All state, import workflow, rules, review decisions, savings/betting/bills wiring and the UI live
in `App.tsx`, with ~45 `useState` hooks. There are no component tests, no ESLint config, no
`.github/workflows`, and no error boundary — one render exception blanks the page with the user's
history loaded. Extract domain hooks (`useTransactions`, `useRules`, `useStatementImport`), add
React Testing Library around the import/confirm and bulk-categorise flows, add ESLint plus a CI
job running `test`/`build`, and wrap the shell in an error boundary offering backup download.

### M8. Destructive actions are inconsistent

Transactions confirm before delete (`App.tsx:735-739`), but bets, savings goals and circles delete
immediately with no confirmation or undo (`App.tsx:814-817`, `:833-836`, `:847-850`). "Clear
history" confirms but is irreversible. Add a delete confirmation everywhere and an undo snackbar
that re-inserts the removed record.

### M9. No security headers or CSP

There is no `public/_headers` and no CSP. For an app holding financial records, add at least
`Content-Security-Policy` (`default-src 'self'`; keep `connect-src 'self'`), `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` and a restrictive
`Permissions-Policy`. React escapes output and the betting importer does not use
`innerHTML`/`DOMParser` (it parses text with regular expressions), so this is hardening rather
than a live injection hole.

### M10. Access protects only the identity endpoint, by design

The README documents this, but it is easy to misread as "the tracker is private": anyone who
knows the Pages URL can load the app; only the data stays local because it never leaves the
browser. If the intent is "only I can open it", put the whole site behind an Access application
and keep `/api/auth/start` public.

## Low / nits

- `src/lib/spendingTimeAnalytics.ts` and `src/lib/timeSpendingAnalytics.ts` are near-identical
  names with different exports, both imported by `InsightsExtras.tsx`. Rename one.
- `formatCurrency` rounds to whole units (`format.ts:1-6`) while the transaction table shows
  decimals (`App.tsx:1898`), so a column of rows can differ from the displayed total by rounding.
- Amount parsing is duplicated with different behaviour: `csv.ts:203-215` handles parentheses and
  currency words; `workbookStatement.ts:12-17` does not. Unify into one parser.
- Malformed base64 in a token signature throws out of `verifyAccessJwt` (`auth.ts:23-29`, `:87-93`)
  and becomes a 500 instead of a 401; wrap it in `AuthError`.
- `/api/me` is called on every load, so sites without Access log a 404 in the console. Consider
  gating the probe behind a build flag or returning JSON 503 from a stub.
- The backup format has no version negotiation (`backup.ts:11`, `:87`); a future format bump will
  make old clients reject new files instead of migrating. Accept `v1`+ and normalise.
- `restoreBackup` replaces everything after one `window.confirm` (`App.tsx:872-894`) with no
  preview of what will change. Show counts and per-collection results.
- Add a LICENSE (public repo, no license text) and a short "known limitations" link from the app.

## Strengths worth keeping

- The import diagnostics are unusually good: header detection, ambiguous-date warning,
  signed-amount assumption warning, OPay summary reconciliation, and a preview that reports
  duplicates, potential changes and outside-range rows before anything is written.
- Auth is done properly where it exists: RS256 verification against the team JWKS with `kid`
  refresh, `aud`, `iss`, `exp`, `nbf` checks, cookie fallback, fail-closed production, and a
  localhost-only dev identity — plus tests for tampered, expired, wrong-audience, wrong-issuer and
  unknown-key tokens, and a test asserting no financial endpoints exist.
- The README is unusually honest about what the heuristics cannot do (PDF layouts, date order,
  forecasts, betting attribution), which matches the code's own confidence labels and warnings.
- Strict TypeScript, compact versioned storage format with a legacy JSON reader, and 140 passing
  tests over parsers and analytics make the core logic easy to change safely.

## Suggested order of work

1. Make install work on current npm and add CI (H1, M7 CI half).
2. Stop silent data loss: storage read status + recovery path (H2), backup completeness (H3).
3. Fix direction inference and filename-insensitive dedupe; add fixtures (M1, M2).
4. PDF footer filtering and delimiter sniffing (M3, M4).
5. Durability and scale: `persist()`, quota UI, per-record writes (M5, M6).
6. Split `App.tsx`, add component tests and an error boundary; consistent delete/undo (M7, M8).
7. Security headers and Access scope documentation (M9, M10).

## Fixes applied

Fixed in the working tree after the review; the original findings above are left intact for
context. Re-verified with `npm test` (146/146 pass) and `npm run build` (passes).

| Finding | Change |
| --- | --- |
| H1 | Added `.npmrc` with `allow-remote=all`, `.github/workflows/ci.yml` (Node 22: `npm ci`, test, build), and an install note in the README. |
| H2 | `transactionStorage.ts` now exposes `inspectStoredTransactions()` with `empty`/`ok`/`corrupt` status, a reason and a dropped-record count. `App.tsx` records unreadable `localStorage` values, blocks every save while damage is present (`persistJson` + `writesBlocked`), and shows a banner with **Download raw data** and **Discard & continue**. |
| H3 | `projectionOpeningBalance` is written by `createBackup`, read/normalised by `readBackup` (defaults to 0 for older files), restored by `restoreBackup`, and covered by a round-trip test. |
| M1 | `inferDirection` checks incoming phrasing (`payment/transfer/deposit/credit from`, `received`, `inward/incoming`) before outgoing wording, requires `payment/transfer/sent/paid to` for outflows, and treats card repayment/settlement as spending. |
| M2 | `sourceName` strips download suffixes (` (1)`, `- copy`), and the dedupe key normalises the account label, so a renamed copy of the same statement is not re-imported. |
| M3 | `detectDelimiter()` sniffs comma, semicolon or tab from the header line; decimal-comma amounts (`1.234,56`) are parsed for non-comma files. |
| M4 | `pdfText.ts` skips totals, page numbers, opening/closing balance lines and repeated table headers before merging wrapped descriptions. |
| M5 (request) | `requestPersistentStorage()` calls `navigator.storage.persist()` once after a successful load/save. |
| M7 (boundary/CI) | Added `src/ErrorBoundary.tsx` (reload or download the saved history) around `<App />`, plus the CI workflow from H1. |
| M8 | Bet, savings-goal, savings-circle and recipient-profile deletes now confirm first, matching transactions. |
| M9 | Added `public/_headers` with nosniff, Referrer-Policy, Permissions-Policy, COOP and a CSP (`default-src 'self'`, `connect-src 'self'`, `worker-src 'self' blob:`, `frame-ancestors 'none'`). Google Fonts hosts are allowed because `styles.css` imports them. |

Still open from the review: quota/usage display and per-record IndexedDB writes (M5/M6), splitting
`App.tsx` and adding component tests/ESLint (M7), undo for deletes (M8), the Access scope wording
(M10), and the low-severity items (analytics module names, `formatCurrency` rounding, duplicated
amount parsers, malformed-token 500, `/api/me` probe, backup version negotiation, restore preview,
LICENSE).
