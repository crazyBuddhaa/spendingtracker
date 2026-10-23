import { useRef, useState } from "react";
import { DatabaseBackup, Download, ListChecks, LockKeyhole, Plus, ShieldCheck, Trash2, Upload, Wand2 } from "lucide-react";
import { categoryList, type Category, type CategoryRule, type CategoryRuleMatchType, type Direction, type Transaction } from "./types";
import { formatDate } from "./lib/format";
import type { AccessStatus } from "./useAccessAuth";

const ruleMatchTypeLabels: Record<CategoryRuleMatchType, string> = {
  contains: "Description contains",
  startsWith: "Description starts with",
  exact: "Exact normalized description",
  merchant: "Merchant matches",
  counterparty: "Recipient or sender matches",
};

interface DataPageProps {
  rules: CategoryRule[];
  transactions: Transaction[];
  counts: { transactions: number; goals: number; circles: number; bets: number; budgets: number; profiles: number };
  matchCount: (rule: Pick<CategoryRule, "pattern" | "direction" | "matchType">) => number;
  onAddRule: (rule: Omit<CategoryRule, "id" | "createdAt">) => void;
  onDeleteRule: (ruleId: string) => void;
  onRefreshCategories: (startDate?: string, endDate?: string) => void;
  onExportBackup: () => void;
  onRestoreBackup: (file: File) => void;
  onClearTransactions: () => void;
  access: AccessStatus;
  onSignIn: () => void;
}

export default function DataPage({
  rules,
  transactions,
  counts,
  matchCount,
  onAddRule,
  onDeleteRule,
  onRefreshCategories,
  onExportBackup,
  onRestoreBackup,
  onClearTransactions,
  access,
  onSignIn,
}: DataPageProps) {
  const restoreInput = useRef<HTMLInputElement>(null);
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState<CategoryRuleMatchType>("contains");
  const [category, setCategory] = useState<Category>("Business");
  const [direction, setDirection] = useState<"" | Direction>("");
  const [markInternal, setMarkInternal] = useState(false);
  const [historyStart, setHistoryStart] = useState("");
  const [historyEnd, setHistoryEnd] = useState("");
  const preview = pattern.trim().length >= 2 ? matchCount({ pattern: pattern.trim().toLowerCase(), direction: direction || undefined, matchType }) : null;
  const historyRangeValid = !historyStart || !historyEnd || historyStart <= historyEnd;
  const historyEligibleCount = historyRangeValid ? transactions.filter((transaction) =>
    !transaction.manual && !transaction.categoryLocked &&
    (!historyStart || transaction.date >= historyStart) &&
    (!historyEnd || transaction.date <= historyEnd)).length : 0;

  const submitRule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pattern.trim().length < 2) return;
    onAddRule({ pattern: pattern.trim().toLowerCase(), category, direction: direction || undefined, matchType, markInternal: markInternal || undefined });
    setPattern("");
    setMarkInternal(false);
  };

  return (
    <section className="data-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR DATA</div>
          <h1>Rules, backups, and housekeeping.</h1>
          <p className="page-subtitle">Manage your categorisation rules and keep a backup file so your history survives a cleared browser or a new device.</p>
        </div>
      </div>

      <AccessPanel status={access} onSignIn={onSignIn} />

      <div className="data-grid">
        <section className="panel data-card">
          <div className="data-card-icon"><DatabaseBackup size={18} /></div>
          <h2>Backup and restore</h2>
          <p>One file with your {counts.transactions.toLocaleString("en-NG")} transactions, {counts.profiles} recipient profile{counts.profiles === 1 ? "" : "s"}, {counts.goals} savings goal{counts.goals === 1 ? "" : "s"}, {counts.circles} circle{counts.circles === 1 ? "" : "s"}, {counts.bets} bet record{counts.bets === 1 ? "" : "s"}, {counts.budgets} budget{counts.budgets === 1 ? "" : "s"}, and {rules.length} rule{rules.length === 1 ? "" : "s"}. Restoring replaces what is in this browser.</p>
          <div className="data-actions">
            <button className="button button-primary" onClick={onExportBackup}><Download size={14} /> Download backup</button>
            <button className="button button-secondary" onClick={() => restoreInput.current?.click()}><Upload size={14} /> Restore from file</button>
            <input
              ref={restoreInput}
              className="visually-hidden"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onRestoreBackup(file);
                event.target.value = "";
              }}
            />
          </div>
        </section>

        <section className="panel data-card">
          <div className="data-card-icon"><Wand2 size={18} /></div>
          <h2>Reclassify transaction history</h2>
          <p>Re-run current rules and learned payee choices over imported history. Choose an inclusive date window, or leave both dates blank for all history. Categories picked by hand and manual entries are protected.</p>
          <div className="history-reclassification-range">
            <label>From<input type="date" value={historyStart} onChange={(event) => setHistoryStart(event.target.value)} /></label>
            <label>Through<input type="date" value={historyEnd} onChange={(event) => setHistoryEnd(event.target.value)} /></label>
          </div>
          <div className="history-reclassification-count" aria-live="polite">
            {historyRangeValid
              ? `${historyEligibleCount.toLocaleString("en-NG")} unlocked transaction${historyEligibleCount === 1 ? "" : "s"} in range`
              : "Choose a start date on or before the end date."}
          </div>
          <div className="data-actions">
            <button className="button button-secondary" onClick={() => onRefreshCategories(historyStart || undefined, historyEnd || undefined)} disabled={!historyRangeValid || historyEligibleCount === 0}><Wand2 size={14} /> Re-categorise history</button>
          </div>
        </section>
      </div>

      <section className="panel rules-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">CATEGORY RULES</div><h2>Always categorise these payees the same way</h2></div>
          <span className="heading-note"><ListChecks size={13} /> {rules.length} rule{rules.length === 1 ? "" : "s"}</span>
        </div>
        <p className="panel-note">Rules can match descriptions, merchants, or recipients/senders. They apply to future imports and unlocked history; the most recently added matching rule wins. Categories you set by hand stay protected.</p>
        <form className="rule-form" onSubmit={submitRule}>
          <label>Match type<select value={matchType} onChange={(event) => setMatchType(event.target.value as CategoryRuleMatchType)}><option value="contains">Description contains</option><option value="startsWith">Description starts with</option><option value="exact">Exact normalized description</option><option value="merchant">Merchant matches</option><option value="counterparty">Recipient or sender matches</option></select></label>
          <label>{matchType === "merchant" ? "Merchant" : matchType === "counterparty" ? "Recipient or sender" : "Match text"}<input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder={matchType === "merchant" ? "e.g. Shoprite" : matchType === "counterparty" ? "e.g. Jane Doe" : "e.g. transfer to Jane Doe"} maxLength={120} /></label>
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categoryList.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Applies to<select value={direction} onChange={(event) => setDirection(event.target.value as "" | Direction)}><option value="">Money in and out</option><option value="expense">Money out only</option><option value="income">Money in only</option></select></label>
          <label className="rule-check"><input type="checkbox" checked={markInternal} onChange={(event) => setMarkInternal(event.target.checked)} /> Treat as my own money moving (exclude from totals)</label>
          <button className="button button-primary" type="submit" disabled={pattern.trim().length < 2}><Plus size={14} /> Add rule{preview !== null ? ` · matches ${preview.toLocaleString("en-NG")}` : ""}</button>
        </form>
        {rules.length ? (
          <div className="simple-table-wrap">
            <table className="simple-table">
              <thead><tr><th>MATCH CONDITION</th><th>CATEGORY</th><th>APPLIES TO</th><th>MATCHES</th><th>ADDED</th><th /></tr></thead>
              <tbody>
                {[...rules].reverse().map((rule) => (
                  <tr key={rule.id}>
                    <td><strong>{ruleMatchTypeLabels[rule.matchType ?? "contains"]}: “{rule.pattern}”</strong>{rule.markInternal && <small>Excluded from totals</small>}</td>
                    <td>{rule.category}</td>
                    <td>{rule.direction === "income" ? "Money in" : rule.direction === "expense" ? "Money out" : "Both"}</td>
                    <td>{matchCount(rule).toLocaleString("en-NG")}</td>
                    <td>{rule.createdAt ? formatDate(rule.createdAt) : "—"}</td>
                    <td><button className="icon-button" onClick={() => onDeleteRule(rule.id)} aria-label={`Delete rule ${rule.pattern}`}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="counterparty-empty">No rules yet.</div>
        )}
      </section>

      <section className="panel danger-panel">
        <div>
          <h2>Clear transaction history</h2>
          <p>Removes every imported and manual transaction from this browser. Download a backup first if you may need it.</p>
        </div>
        <button className="button button-danger" onClick={onClearTransactions} disabled={!counts.transactions}><Trash2 size={14} /> Clear transactions</button>
      </section>
    </section>
  );
}

function AccessPanel({ status, onSignIn }: { status: AccessStatus; onSignIn: () => void }) {
  const title = status.state === "signed-in"
    ? "Identity verified"
    : status.state === "checking"
      ? "Checking Cloudflare Access"
      : "Sign-in is separate from your records";
  const detail = status.state === "signed-in"
    ? `Signed in as ${status.email}. Access verifies your identity only; financial records remain in this browser.`
    : status.state === "signed-out"
      ? "Your records remain in this browser. Cloudflare Access sign-in does not upload or sync financial data."
      : status.state === "unavailable"
        ? status.message ?? "Access identity verification is unavailable on this deployment."
        : "Checking whether this site has an active Access session.";
  return (
    <section className="panel access-panel" role="status" aria-live="polite">
      <div className="data-card-icon"><ShieldCheck size={18} /></div>
      <div className="access-panel-copy">
        <div className="panel-kicker">CLOUDFLARE ACCESS</div>
        <h2>{title}</h2>
        <p>{detail}</p>
        {status.state === "signed-out" && <button className="button button-secondary" onClick={onSignIn}><LockKeyhole size={14} /> Sign in</button>}
      </div>
    </section>
  );
}
