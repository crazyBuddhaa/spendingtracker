import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, DatabaseBackup, Download, FileSpreadsheet, ListChecks, Plus, RefreshCw, Trash2, Upload, Wand2 } from "lucide-react";
import { categoryList, type Category, type CategoryRule, type Direction } from "./types";
import { formatDate, localIsoDate } from "./lib/format";
import type { SyncStatus } from "./useCloudSync";
import type { StoredBackup, StoredStatement } from "./lib/cloudApi";

interface CloudProps {
  status: SyncStatus;
  onSync: () => void;
  onSignIn: () => void;
  listStatements: () => Promise<StoredStatement[]>;
  deleteStatement: (id: string) => Promise<void>;
  statementUrl: (id: string) => string;
  listBackups: () => Promise<StoredBackup[]>;
  createCloudBackup: () => Promise<StoredBackup>;
  deleteCloudBackup: (id: string) => Promise<void>;
  backupUrl: (id: string) => string;
}

interface DataPageProps {
  rules: CategoryRule[];
  counts: { transactions: number; goals: number; circles: number; bets: number; budgets: number };
  matchCount: (rule: Pick<CategoryRule, "pattern" | "direction">) => number;
  onAddRule: (rule: Omit<CategoryRule, "id" | "createdAt">) => void;
  onDeleteRule: (ruleId: string) => void;
  onRefreshCategories: () => void;
  onExportBackup: () => void;
  onRestoreBackup: (file: File) => void;
  onClearTransactions: () => void;
  cloud: CloudProps;
}

export default function DataPage({
  rules,
  counts,
  matchCount,
  onAddRule,
  onDeleteRule,
  onRefreshCategories,
  onExportBackup,
  onRestoreBackup,
  onClearTransactions,
  cloud,
}: DataPageProps) {
  const restoreInput = useRef<HTMLInputElement>(null);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState<Category>("Business");
  const [direction, setDirection] = useState<"" | Direction>("");
  const [markInternal, setMarkInternal] = useState(false);
  const preview = pattern.trim().length >= 2 ? matchCount({ pattern: pattern.trim().toLowerCase(), direction: direction || undefined }) : null;

  const submitRule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pattern.trim().length < 2) return;
    onAddRule({ pattern: pattern.trim().toLowerCase(), category, direction: direction || undefined, markInternal: markInternal || undefined });
    setPattern("");
    setMarkInternal(false);
  };

  return (
    <section className="data-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR DATA</div>
          <h1>Rules, backups, and housekeeping.</h1>
          <p className="page-subtitle">Teach Spendwise how to categorise your payees, and keep a backup file so your history survives a cleared browser or a new device.</p>
        </div>
      </div>

      <CloudPanel cloud={cloud} />

      <div className="data-grid">
        <section className="panel data-card">
          <div className="data-card-icon"><DatabaseBackup size={18} /></div>
          <h2>Backup and restore</h2>
          <p>One file with your {counts.transactions.toLocaleString("en-NG")} transactions, {counts.goals} savings goal{counts.goals === 1 ? "" : "s"}, {counts.circles} circle{counts.circles === 1 ? "" : "s"}, {counts.bets} bet record{counts.bets === 1 ? "" : "s"}, {counts.budgets} budget{counts.budgets === 1 ? "" : "s"}, and {rules.length} rule{rules.length === 1 ? "" : "s"}. Restoring replaces what is in this browser.</p>
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
          <div className="data-card-icon"><RefreshCw size={18} /></div>
          <h2>Re-check categories</h2>
          <p>Runs the latest automatic categorisation and your rules over everything already imported. Categories you picked by hand and manual entries are left alone.</p>
          <div className="data-actions">
            <button className="button button-secondary" onClick={onRefreshCategories} disabled={!counts.transactions}><Wand2 size={14} /> Re-categorise history</button>
          </div>
        </section>
      </div>

      <section className="panel rules-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">CATEGORY RULES</div><h2>Always categorise these payees the same way</h2></div>
          <span className="heading-note"><ListChecks size={13} /> {rules.length} rule{rules.length === 1 ? "" : "s"}</span>
        </div>
        <p className="panel-note">A rule matches when its text appears in a transaction description. Rules apply to future imports and to history (except categories you set by hand). Tip: changing a category on the Transactions page offers to create a rule for you.</p>
        <form className="rule-form" onSubmit={submitRule}>
          <label>Description contains<input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="e.g. transfer to kehinde ibukun" maxLength={120} /></label>
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categoryList.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Applies to<select value={direction} onChange={(event) => setDirection(event.target.value as "" | Direction)}><option value="">Money in and out</option><option value="expense">Money out only</option><option value="income">Money in only</option></select></label>
          <label className="rule-check"><input type="checkbox" checked={markInternal} onChange={(event) => setMarkInternal(event.target.checked)} /> Treat as my own money moving (exclude from totals)</label>
          <button className="button button-primary" type="submit" disabled={pattern.trim().length < 2}><Plus size={14} /> Add rule{preview !== null ? ` · matches ${preview.toLocaleString("en-NG")}` : ""}</button>
        </form>
        {rules.length ? (
          <div className="simple-table-wrap">
            <table className="simple-table">
              <thead><tr><th>WHEN DESCRIPTION CONTAINS</th><th>CATEGORY</th><th>APPLIES TO</th><th>MATCHES</th><th>ADDED</th><th /></tr></thead>
              <tbody>
                {[...rules].reverse().map((rule) => (
                  <tr key={rule.id}>
                    <td><strong>“{rule.pattern}”</strong>{rule.markInternal && <small>Excluded from totals</small>}</td>
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

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function CloudPanel({ cloud }: { cloud: CloudProps }) {
  const { status } = cloud;
  const [statements, setStatements] = useState<StoredStatement[] | null>(null);
  const [backups, setBackups] = useState<StoredBackup[] | null>(null);
  const [error, setError] = useState("");
  const [creatingBackup, setCreatingBackup] = useState(false);
  const active = status.mode === "cloud";
  const canListFiles = active && status.filesEnabled && status.state !== "signed-out" && status.state !== "offline";

  const load = useCallback(async () => {
    if (!canListFiles) return;
    try {
      setError("");
      const [nextStatements, nextBackups] = await Promise.all([cloud.listStatements(), cloud.listBackups()]);
      setStatements(nextStatements);
      setBackups(nextBackups);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load cloud files.");
    }
  }, [canListFiles, cloud.listStatements, cloud.listBackups]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (statement: StoredStatement) => {
    if (!window.confirm(`Delete the stored file “${statement.fileName}” from R2? Transactions already imported from it are kept.`)) return;
    try {
      await cloud.deleteStatement(statement.id);
      setStatements((current) => current?.filter((item) => item.id !== statement.id) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the file.");
    }
  };

  const createBackup = async () => {
    try {
      setCreatingBackup(true);
      setError("");
      const backup = await cloud.createCloudBackup();
      setBackups((current) => [backup, ...(current ?? []).filter((item) => item.id !== backup.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a cloud backup.");
    } finally {
      setCreatingBackup(false);
    }
  };

  const removeBackup = async (backup: StoredBackup) => {
    if (!window.confirm("Delete this cloud backup from R2? This cannot be undone.")) return;
    try {
      await cloud.deleteCloudBackup(backup.id);
      setBackups((current) => current?.filter((item) => item.id !== backup.id) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the cloud backup.");
    }
  };

  if (!active) {
    return (
      <section className="panel cloud-panel cloud-panel--local">
        <div className="data-card-icon"><Cloud size={18} /></div>
        <div>
          <h2>{status.state === "signed-out" ? "Guest mode — data stays here" : "Cloud sync is off"}</h2>
          <p>{status.state === "not-configured" && status.message
            ? status.message
            : status.state === "signed-out"
              ? "Your data stays in this browser. Sign in with your email code to sync it across devices and create cloud backups."
              : "This copy of the app is not connected to Cloudflare, so everything stays in this browser. When it runs on Cloudflare Pages with D1, R2, and Cloudflare Access set up, signed-in users can sync across devices."}</p>
          {status.state === "signed-out" && <button className="button button-primary" onClick={cloud.onSignIn}>Sign in to sync</button>}
        </div>
      </section>
    );
  }

  return (
    <section className="panel cloud-panel">
      <div className="panel-heading">
        <div>
          <div className="panel-kicker">CLOUDFLARE</div>
          <h2>Cloud sync and storage</h2>
        </div>
        {status.state === "signed-out"
          ? <button className="button button-primary" onClick={cloud.onSignIn}>Sign in again</button>
          : <button className="button button-secondary" onClick={cloud.onSync} disabled={status.state === "syncing"}><RefreshCw size={14} /> Sync now</button>}
      </div>
      <div className="cloud-facts">
        <div><span>SIGNED IN AS</span><strong>{status.email ?? "—"}</strong></div>
        <div><span>LAST SYNCED</span><strong>{status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "Not yet"}</strong></div>
        <div><span>WAITING TO SYNC</span><strong>{status.pending.toLocaleString("en-NG")}</strong></div>
      </div>
      {status.message && <p className="panel-note">{status.message}</p>}

      <h3 className="cloud-subheading"><DatabaseBackup size={14} /> On-demand account backups (R2)</h3>
      <p className="panel-note">Snapshots include this account’s cloud transactions and synced collections. Download one to restore it with “Restore from file”; original statement files are stored separately below.</p>
      <div className="data-actions">
        <button className="button button-secondary" onClick={() => void createBackup()} disabled={!canListFiles || creatingBackup}>
          <DatabaseBackup size={14} /> {creatingBackup ? "Creating backup…" : "Create cloud backup"}
        </button>
      </div>
      {!status.filesEnabled ? (
        <div className="counterparty-empty">R2 storage is not connected. Add an R2 binding named STATEMENTS to store backups.</div>
      ) : error ? (
        <div className="counterparty-empty">{error}</div>
      ) : backups === null ? (
        <div className="counterparty-empty">{canListFiles ? "Loading…" : "Sign in and connect to view cloud backups."}</div>
      ) : backups.length === 0 ? (
        <div className="counterparty-empty">No cloud backups yet. Create one before changing devices or restoring data.</div>
      ) : (
        <div className="simple-table-wrap">
          <table className="simple-table">
            <thead><tr><th>CREATED</th><th>TRANSACTIONS</th><th>SIZE</th><th /></tr></thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.id}>
                  <td>{formatDate(localIsoDate(new Date(backup.createdAt)))}</td>
                  <td>{backup.transactionCount.toLocaleString("en-NG")}</td>
                  <td>{formatBytes(backup.size)}</td>
                  <td className="row-actions">
                    <a className="icon-button" href={cloud.backupUrl(backup.id)} download title="Download backup" aria-label="Download cloud backup"><Download size={14} /></a>
                    <button className="icon-button" onClick={() => void removeBackup(backup)} title="Delete backup" aria-label="Delete cloud backup"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="cloud-subheading"><FileSpreadsheet size={14} /> Original statement files (R2)</h3>
      {!status.filesEnabled ? (
        <div className="counterparty-empty">R2 storage is not connected. Add an R2 binding named STATEMENTS to keep copies of imported statements.</div>
      ) : error ? (
        <div className="counterparty-empty">{error}</div>
      ) : statements === null ? (
        <div className="counterparty-empty">Loading…</div>
      ) : statements.length === 0 ? (
        <div className="counterparty-empty">No files yet. Statements you import from now on are stored here automatically.</div>
      ) : (
        <div className="simple-table-wrap">
          <table className="simple-table">
            <thead><tr><th>FILE</th><th>ROWS</th><th>SIZE</th><th>UPLOADED</th><th /></tr></thead>
            <tbody>
              {statements.map((statement) => (
                <tr key={statement.id}>
                  <td><strong>{statement.fileName}</strong></td>
                  <td>{statement.rowsImported.toLocaleString("en-NG")}</td>
                  <td>{formatBytes(statement.size)}</td>
                  <td>{formatDate(localIsoDate(new Date(statement.uploadedAt)))}</td>
                  <td className="row-actions">
                    <a className="icon-button" href={cloud.statementUrl(statement.id)} download={statement.fileName} title="Download" aria-label={`Download ${statement.fileName}`}><Download size={14} /></a>
                    <button className="icon-button" onClick={() => void remove(statement)} title="Delete file" aria-label={`Delete ${statement.fileName}`}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
