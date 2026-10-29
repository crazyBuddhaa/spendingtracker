import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  Eye,
  FileClock,
  History,
  Landmark,
  Plus,
  Receipt,
  ScrollText,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { formatDate, formatCurrency } from "../lib/format";
import {
  buildMovementReport,
  reconcileStatement,
  suggestInferredRecords,
  transferMatchWindowDays,
  type InferredSuggestion,
  type LedgerIssue,
  type TransferIntelligence,
} from "../lib/reconciliation";
import type { MutationEntry, StatementSnapshot, Transaction } from "../types";

const issueBadges: Record<LedgerIssue["kind"], string> = {
  "exact-duplicate": "Repeated row",
  "near-duplicate": "Possible double-count",
  "period-gap": "Coverage gap",
};

const mutationLabels: Record<MutationEntry["kind"], string> = {
  import: "Import",
  add: "Added entry",
  "inferred-add": "Inferred record added",
  verify: "Inferred record verified",
  update: "Correction",
  delete: "Deletion",
  clear: "Bulk deletion",
  restore: "Restore",
};

const movementLineLabels: Record<string, { label: string; definition: string }> = {
  actualSpending: { label: "Actual spending", definition: "Money out that is not a transfer to your own accounts and not fees." },
  transfersOut: { label: "Transfers to others", definition: "Money sent to other people or external accounts." },
  transfersIn: { label: "Transfers received", definition: "Money received from other people or external accounts." },
  internalMoves: { label: "Own-account & savings moves", definition: "Moves between your own wallet, savings pots, and accounts. Excluded from totals." },
  bankFees: { label: "Bank fees & levies", definition: "Charges, VAT, levies, and stamp duty." },
  refunds: { label: "Refunds & reversals", definition: "Returned money. It reduces spending rather than counting as income." },
  unresolvedOut: { label: "Unexplained money out", definition: "Recorded spending or transfers with no matching arrival in another recorded account." },
  unresolvedIn: { label: "Unexplained money in", definition: "Recorded credits sent from no other recorded account." },
  inferredPending: { label: "Inferred, awaiting verification", definition: "Reconstructed rows suggested by reconciliation. Never original statement data." },
};

interface ReconcilePageProps {
  transactions: Transaction[];
  snapshots: StatementSnapshot[];
  auditLog: MutationEntry[];
  currency: string;
  accounts: string[];
  issues: LedgerIssue[];
  transferIntel: TransferIntelligence;
  onOpenTransactions: (ids: string[]) => void;
  onAddSnapshot: (snapshot: Omit<StatementSnapshot, "id" | "createdAt">) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
  onAddInferred: (suggestion: InferredSuggestion) => void;
  onVerifyInferred: (transactionId: string) => void;
}

interface SnapshotForm {
  account: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  closingBalance: string;
  declaredTotalIn: string;
  declaredTotalOut: string;
  note: string;
}

export default function ReconcilePage({
  transactions,
  snapshots,
  auditLog,
  currency,
  accounts,
  issues: ledgerIssues,
  transferIntel: transfers,
  onOpenTransactions,
  onAddSnapshot,
  onDeleteSnapshot,
  onAddInferred,
  onVerifyInferred,
}: ReconcilePageProps) {
  const [form, setForm] = useState<SnapshotForm>({
    account: accounts[0] ?? "",
    periodStart: "",
    periodEnd: "",
    openingBalance: "",
    closingBalance: "",
    declaredTotalIn: "",
    declaredTotalOut: "",
    note: "",
  });

  const report = useMemo(
    () => buildMovementReport(transactions, transfers.unmatched, false),
    [transactions, transfers.unmatched],
  );
  const results = useMemo(
    () => snapshots.map((snapshot) => reconcileStatement(transactions, snapshot)),
    [snapshots, transactions],
  );
  const inference = useMemo(
    () => snapshots.map((snapshot) => {
      const result = results.find((item) => item.snapshotId === snapshot.id);
      return result && result.reason.startsWith("Recorded history does not fully explain")
        ? suggestInferredRecords(transactions, snapshot, result)
        : [];
    }),
    [snapshots, results, transactions],
  );
  const inferredRows = useMemo(() => transactions.filter((transaction) => transaction.inferred).sort((a, b) => b.date.localeCompare(a.date)), [transactions]);
  const formDatesValid = Boolean(form.account && form.periodStart && form.periodEnd) && form.periodStart <= form.periodEnd;

  const submitSnapshot = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numeric = (value: string) => {
      const parsed = Number(value);
      return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
    };
    onAddSnapshot({
      account: form.account,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      openingBalance: numeric(form.openingBalance),
      closingBalance: numeric(form.closingBalance),
      declaredTotalIn: numeric(form.declaredTotalIn),
      declaredTotalOut: numeric(form.declaredTotalOut),
      recordedBy: "manual",
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    });
    setForm({ ...form, periodStart: "", periodEnd: "", openingBalance: "", closingBalance: "", declaredTotalIn: "", declaredTotalOut: "", note: "" });
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> NOTHING HIDDEN</div>
          <h1>Transparency &amp; reconciliation</h1>
          <p className="page-subtitle">A separate place that cross-checks your history, links money movements between accounts, and explains every figure — including the ones that are not yet explained.</p>
        </div>
      </div>

      <section className="reconcile-rule-banner" role="note">
        <ShieldCheck size={17} />
        <p>
          <strong>Every figure is traceable.</strong> Reconciled numbers come only from the transactions recorded in this browser or from statement values you enter. Reconstructed ("inferred") records are labelled wherever they appear and stay suggestions until you accept them. Nothing here deletes, rewrites, or duplicates your original rows.
        </p>
      </section>

      {/* ------------------------------------------------- ledger integrity */}
      <section className="panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">INTACT RECORDS</div><h2>History integrity check</h2></div>
          <span className="review-banner-actions"><Eye size={15} /> Read-only audit of what you already saved</span>
        </div>
        {ledgerIssues.length === 0
          ? <p className="reconcile-quiet">No repeated or suspicious rows found. Your saved history looks internally consistent.</p>
          : (
            <ul className="reconcile-issue-list">
              {ledgerIssues.map((issue) => (
                <li key={issue.message}>
                  <span className={`reconcile-badge reconcile-badge--${issue.kind}`}>{issueBadges[issue.kind]}</span>
                  <div>
                    <p>{issue.message}</p>
                    {issue.transactionIds.length > 0 && (
                      <button className="subtle-link" onClick={() => onOpenTransactions(issue.transactionIds)}>
                        Show these {issue.transactionIds.length.toLocaleString("en-NG")} row{issue.transactionIds.length === 1 ? "" : "s"} <ArrowLeftRight size={12} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

      {/* ------------------------------------------------ transfer matching */}
      <section className="panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">WHERE IT WENT</div><h2>Movements across accounts</h2></div>
          <span className="reconcile-window-note">Amounts equal to the kobo, arrival within {transferMatchWindowDays} days. Each row links at most once.</span>
        </div>
        {transfers.links.length > 0 ? (
          <div className="counterparty-list transfer-link-list">
            <div className="counterparty-list-heading"><span>MOVEMENT</span><span>AMOUNT</span><span>CONFIDENCE</span></div>
            {transfers.links.map((link) => {
              const out = transactions.find((transaction) => transaction.id === link.outId);
              const incoming = transactions.find((transaction) => transaction.id === link.inId);
              return (
                <div className="counterparty-list-row reconcile-link-row" key={link.id} title={link.reason}>
                  <strong>{out?.source ?? "?"} <ArrowLeftRight size={12} /> {incoming?.source ?? "?"} · {formatDate(link.date)}</strong>
                  <span>{formatCurrency(link.amount, currency, true)}</span>
                  <span>{Math.round(link.confidence * 100)}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="reconcile-quiet">No same-amount departure-and-arrival pairs found across your recorded accounts within the matching window.</p>
        )}
        {transfers.unmatched.length > 0 && (
          <>
            <div className="reconcile-unmatched-heading">
              <TriangleAlert size={15} />
              <span>{transfers.unmatched.length.toLocaleString("en-NG")} recorded movement{transfers.unmatched.length === 1 ? "" : "s"} no other record explains</span>
            </div>
            <ul className="reconcile-unmatched-list">
              {transfers.unmatched.slice(0, 12).map(({ transaction, reason }) => (
                <li key={transaction.id}>
                  <button className="subtle-link reconcile-unmatched-row" onClick={() => onOpenTransactions([transaction.id])}>
                    <strong>{transaction.direction === "income" ? "+" : "−"}{formatCurrency(transaction.amount, currency)}</strong>
                    <span>{transaction.description} · {transaction.source} · {formatDate(transaction.date)}</span>
                  </button>
                  <p>{reason}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ------------------------------------------- statement reconciliation */}
      <section className="panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">MISSING MONEY</div><h2>Statement comparison</h2></div>
          <span className="reconcile-window-note"><Receipt size={14} /> Enter what a statement declares; the engine compares it with recorded rows.</span>
        </div>
        <form className="reconcile-snapshot-form form-grid" onSubmit={submitSnapshot}>
          <label>Account
            <select value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })} required>
              <option value="" disabled>Choose account</option>
              {accounts.map((account) => <option key={account} value={account}>{account}</option>)}
            </select>
          </label>
          <div className="reconcile-range-fields">
            <label>Period from<input required type="date" value={form.periodStart} onChange={(event) => setForm({ ...form, periodStart: event.target.value })} /></label>
            <label>Period to<input required type="date" min={form.periodStart || undefined} value={form.periodEnd} onChange={(event) => setForm({ ...form, periodEnd: event.target.value })} /></label>
          </div>
          <label>Opening balance<input type="number" step="any" placeholder="optional" value={form.openingBalance} onChange={(event) => setForm({ ...form, openingBalance: event.target.value })} /></label>
          <label>Closing balance<input type="number" step="any" placeholder="optional" value={form.closingBalance} onChange={(event) => setForm({ ...form, closingBalance: event.target.value })} /></label>
          <label>Statement money in<input type="number" step="any" placeholder="optional" value={form.declaredTotalIn} onChange={(event) => setForm({ ...form, declaredTotalIn: event.target.value })} /></label>
          <label>Statement money out<input type="number" step="any" placeholder="optional" value={form.declaredTotalOut} onChange={(event) => setForm({ ...form, declaredTotalOut: event.target.value })} /></label>
          <label className="form-wide">Note<input maxLength={280} placeholder="e.g. October statement downloaded from the app" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          <div className="form-wide reconcile-form-foot">
            <button className="button button-primary" type="submit" disabled={!formDatesValid}>
              <Plus size={14} /> Compare this period
            </button>
            <span>Opening and closing balance enable the balance check; declared totals enable the totals check. Levels are stored only in this browser.</span>
          </div>
        </form>

        {snapshots.length === 0 && <p className="reconcile-quiet">No statement periods recorded yet. Add one above — or after importing a statement — to look for missing or unexplained rows.</p>}
        {snapshots.map((snapshot, index) => {
          const result = results[index];
          const suggestions = inference[index] ?? [];
          return (
            <article className="reconcile-snapshot" key={snapshot.id}>
              <header className="reconcile-snapshot-head">
                <div>
                  <Landmark size={15} />
                  <strong>{snapshot.account}</strong>
                  <span>{formatDate(snapshot.periodStart)} – {formatDate(snapshot.periodEnd)}</span>
                  {snapshot.note && <span className="reconcile-snapshot-note">{snapshot.note}</span>}
                </div>
                <button className="icon-button" onClick={() => onDeleteSnapshot(snapshot.id)} title="Remove this comparison (recorded transactions are untouched)" aria-label={`Remove comparison for ${snapshot.account}`}><Trash2 size={14} /></button>
              </header>
              <p className={`reconcile-snapshot-verdict ${result.reason.startsWith("Recorded history does not fully explain") ? "reconcile-snapshot-verdict--flagged" : "reconcile-snapshot-verdict--clean"}`}>{result.reason}</p>
              <div className="reconcile-snapshot-grid">
                <div><span>Recorded rows used</span><strong>{result.recordedCount.toLocaleString("en-NG")}</strong></div>
                <div><span>Recorded money in</span><strong>{formatCurrency(result.recordedIn, currency, true)}</strong></div>
                <div><span>Recorded money out</span><strong>{formatCurrency(result.recordedOut, currency, true)}</strong></div>
                {result.declaredIn !== null && <div><span>Declared − recorded in</span><strong>{result.inDifference === 0 ? "Exact match" : formatCurrency(result.inDifference!, currency, true)}</strong></div>}
                {result.declaredOut !== null && <div><span>Declared − recorded out</span><strong>{result.outDifference === 0 ? "Exact match" : formatCurrency(result.outDifference!, currency, true)}</strong></div>}
                {result.deltaDifference !== null && <div><span>Balance move vs records</span><strong>{result.deltaDifference === 0 ? "Explained" : formatCurrency(result.deltaDifference!, currency, true)}</strong></div>}
              </div>
              {suggestions.length > 0 && (
                <div className="reconcile-inferred-block">
                  <div className="reconcile-unmatched-heading"><Eye size={14} /><span>Suggested reconstructed record{suggestions.length === 1 ? "" : "s"} (labelled inferred, verified only after you accept)</span></div>
                  {suggestions.map((suggestion) => (
                    <div className="reconcile-inferred-row" key={suggestion.id}>
                      <div>
                        <strong>{suggestion.direction === "income" ? "+" : "−"}{formatCurrency(suggestion.amount, currency)}</strong>
                        <span>{formatDate(suggestion.date)} · {suggestion.account}</span>
                        <small className="reconcile-basis">{suggestion.basis}</small>
                      </div>
                      <button className="button button-secondary" onClick={() => onAddInferred(suggestion)}><Check size={13} /> Add as inferred</button>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </section>

      {/* --------------------------------------------- inferred rows pending */}
      <section className="panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">RECONSTRUCTED</div><h2>Inferred records awaiting verification</h2></div>
          <span className="reconcile-window-note">Shown nowhere as original data: every list, table, and export marks them.</span>
        </div>
        {inferredRows.length === 0
          ? <p className="reconcile-quiet">No inferred records in your history. Comparisons above can propose them; you verify before they count.</p>
          : (
            <ul className="reconcile-unmatched-list">
              {inferredRows.map((row) => (
                <li key={row.id}>
                  <div className="reconcile-unmatched-row">
                    <strong>{row.direction === "income" ? "+" : "−"}{formatCurrency(row.amount, currency)}</strong>
                    <span>{row.description} · {row.source} · {formatDate(row.date)}</span>
                  </div>
                  <p>{row.note ?? "Inferred by reconciliation."}</p>
                  <button className="button button-secondary reconcile-verify-button" onClick={() => onVerifyInferred(row.id)}>
                    <Check size={13} /> I have verified this — treat as original
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>

      {/* ------------------------------------------------ movement breakdown */}
      <section className="panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">SAME NUMBERS, SEPARATED</div><h2>Where money moved, with definitions</h2></div>
          <span className="reconcile-window-note">{report.transactionCount.toLocaleString("en-NG")} recorded row{report.transactionCount === 1 ? "" : "s"} analysed</span>
        </div>
        <div className="reconcile-report-list">
          {Object.entries(movementLineLabels).map(([key, meta]) => (
            <div className="reconcile-report-row" key={key}>
              <span className="reconcile-report-label">
                <ExperimentLabelIcon name={key} />
                <strong>{meta.label}</strong>
                <small>{meta.definition}</small>
              </span>
              <strong className="reconcile-report-value">{formatCurrency(report[key as keyof typeof report] as number, currency, true)}</strong>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- audit trail */}
      <section className="panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">TRACEABLE CHANGES</div><h2>Audit trail</h2></div>
          <span className="reconcile-window-note"><History size={14} /> Recorded locally since this engine was added. Stays in this browser.</span>
        </div>
        {auditLog.length === 0
          ? <p className="reconcile-quiet">No changes recorded yet. From now on, imports, corrections, deletions, matching, and verification get logged here.</p>
          : (
            <ul className="reconcile-issue-list">
              {[...auditLog].reverse().slice(0, 25).map((entry) => (
                <li key={entry.id}>
                  <span className={`reconcile-badge reconcile-badge--mut-${entry.kind}`}>{mutationLabels[entry.kind]}</span>
                  <div>
                    <p>{entry.detail}{entry.evidence ? <small className="reconcile-basis"> {entry.evidence}</small> : null}</p>
                    <small>{new Date(entry.at).toLocaleString()}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

      <div className="page-footnote"><ScrollText size={14} /> Reconciliation reads your stored history and never sends it anywhere.</div>
    </>
  );
}

function ExperimentLabelIcon({ name }: { name: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    actualSpending: <Receipt size={14} />,
    transfersOut: <ArrowLeftRight size={14} />,
    transfersIn: <ArrowLeftRight size={14} />,
    internalMoves: <ArrowLeftRight size={14} />,
    bankFees: <Receipt size={14} />,
    refunds: <Receipt size={14} />,
    unresolvedOut: <TriangleAlert size={14} />,
    unresolvedIn: <TriangleAlert size={14} />,
    inferredPending: <FileClock size={14} />,
  };
  return <i className="reconcile-report-icon">{iconMap[name] ?? <ScrollText size={14} />}</i>;
}
