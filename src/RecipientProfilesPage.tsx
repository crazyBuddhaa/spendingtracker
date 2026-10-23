import { useMemo, useState } from "react";
import { CalendarClock, Car, CircleHelp, Pencil, Search, Tag, Trash2, Users, X } from "lucide-react";
import { findRecurringPayments } from "./lib/analytics";
import { formatCurrency, formatDate } from "./lib/format";
import { detectTypicalFareRanges } from "./lib/recipientAnalytics";
import { getRecipientDirectory, normaliseRecipientProfiles, type RecipientSummary } from "./lib/recipientProfiles";
import { categoryList, type RecipientProfile, type Transaction } from "./types";

interface RecipientProfilesPageProps {
  transactions: Transaction[];
  profiles: RecipientProfile[];
  currency: string;
  onSaveProfile: (profile: RecipientProfile) => void;
  onDeleteProfile: (profileId: string) => void;
  onOpenTransactions: (query: string) => void;
}

export default function RecipientProfilesPage({
  transactions,
  profiles,
  currency,
  onSaveProfile,
  onDeleteProfile,
  onOpenTransactions,
}: RecipientProfilesPageProps) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "recipient" | "merchant" | "sender">("all");
  const [editing, setEditing] = useState<RecipientSummary | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [aliases, setAliases] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");

  const directory = useMemo(() => getRecipientDirectory(transactions, profiles), [transactions, profiles]);
  const recurringPayments = useMemo(() => findRecurringPayments(transactions, profiles), [transactions, profiles]);
  const fareRanges = useMemo(() => detectTypicalFareRanges(transactions, profiles), [transactions, profiles]);
  const filtered = directory.filter((item) =>
    (kindFilter === "all" || item.kind === kindFilter) &&
    (!query.trim() || `${item.name} ${item.aliases.join(" ")} ${item.note ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())));
  const profileCount = profiles.length;
  const transportFareCount = fareRanges.length;

  const openEditor = (summary: RecipientSummary) => {
    const stored = profiles.find((profile) => profile.id === summary.id);
    setEditing(summary);
    setDisplayName(stored?.name ?? summary.name);
    setAliases((stored?.aliases ?? summary.aliases).join("\n"));
    setCategory(stored?.category ?? "");
    setNote(stored?.note ?? "");
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || !displayName.trim()) return;
    const next = normaliseRecipientProfiles([{
      id: editing.id,
      kind: editing.kind,
      name: displayName.trim(),
      aliases: [
        ...aliases.split(/[\n,;]+/).map((alias) => alias.trim()).filter(Boolean),
        ...(editing.name.trim().toLowerCase() !== displayName.trim().toLowerCase() ? [editing.name] : []),
      ],
      category: category || undefined,
      note: note.trim() || undefined,
    }])[0];
    if (!next) return;
    onSaveProfile(next);
    setEditing(null);
  };

  return (
    <section className="recipient-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> PEOPLE AND PAYEES</div>
          <h1>Recipient profiles.</h1>
          <p className="page-subtitle">Bring statement-name variants together, set a consistent category, and see the payment patterns behind each profile. Everything stays in this browser.</p>
        </div>
      </div>

      <div className="recipient-summary">
        <div><span>IDENTIFIED PAYEES & PAYERS</span><strong>{directory.length.toLocaleString("en-NG")}</strong></div>
        <div><span>MANAGED PROFILES</span><strong>{profileCount.toLocaleString("en-NG")}</strong></div>
        <div><span>REGULAR PAYMENTS</span><strong>{recurringPayments.length.toLocaleString("en-NG")}</strong></div>
        <div><span>TRANSPORT FARE BANDS</span><strong>{transportFareCount.toLocaleString("en-NG")}</strong></div>
      </div>

      <section className="panel recipient-directory">
        <div className="panel-heading">
          <div><div className="panel-kicker">NORMALISED DIRECTORY</div><h2>Recipients, merchants, and senders</h2></div>
          <span className="heading-note"><Users size={14} /> {filtered.length} shown</span>
        </div>
        <p className="panel-note">Edit a profile to give it a preferred name, add statement aliases, or set a category that applies to future and unlocked historical transactions. Manual categories remain protected.</p>
        <div className="recipient-tools">
          <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names and aliases…" /></label>
          <label className="filter-select"><Tag size={13} /><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)} aria-label="Filter party type"><option value="all">All types</option><option value="recipient">Recipients</option><option value="merchant">Merchants</option><option value="sender">Senders</option></select></label>
        </div>
        {filtered.length ? (
          <div className="simple-table-wrap">
            <table className="simple-table recipient-table">
              <thead><tr><th>PROFILE</th><th>TYPE</th><th>PAYMENTS</th><th>MONEY OUT</th><th>MONEY IN</th><th>LAST ACTIVITY</th><th /></tr></thead>
              <tbody>
                {filtered.map((item) => {
                  const configured = profiles.find((profile) => profile.id === item.id);
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{configured?.name ?? item.name}</strong>
                        <small title={configured?.note}>
                          {[
                            configured?.aliases.length ? `Also: ${configured.aliases.join(", ")}` : null,
                            configured?.note ? `Note: ${configured.note}` : null,
                            configured?.category ? `Profile category · ${configured.category}` : !configured && item.category ? `Common category · ${item.category}` : null,
                          ].filter(Boolean).join(" · ") || "Category not set"}
                        </small>
                      </td>
                      <td><span className="recipient-kind">{item.kind}</span></td>
                      <td>{item.transactions.toLocaleString("en-NG")}</td>
                      <td>{formatCurrency(item.sent, currency, true)}</td>
                      <td>{formatCurrency(item.received, currency, true)}</td>
                      <td>{item.lastDate ? formatDate(item.lastDate) : "—"}</td>
                      <td className="recipient-actions">
                        <button className="button button-text" onClick={() => onOpenTransactions(item.name)}><Search size={12} /> History</button>
                        <button className="icon-button" onClick={() => openEditor(item)} aria-label={`Edit ${item.name} profile`}><Pencil size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="counterparty-empty"><Users size={15} /> {transactions.length ? "No identified parties match that search." : "Import a statement to build your recipient directory."}</div>
        )}
      </section>

      <section className="panel recipient-insight-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">PAYMENT RHYTHM</div><h2>Recurring payments</h2></div>
          <span className="heading-note"><CalendarClock size={14} /> {recurringPayments.length} detected</span>
        </div>
        <p className="panel-note">Weekly or monthly payments with a steady date rhythm and similar amounts. These are historical estimates, not scheduled payments.</p>
        {recurringPayments.length ? (
          <div className="simple-table-wrap">
            <table className="simple-table">
              <thead><tr><th>PAYEE</th><th>CADENCE</th><th>USUAL AMOUNT</th><th>MONTHLY ESTIMATE</th><th>NEXT EXPECTED</th></tr></thead>
              <tbody>{recurringPayments.map((item) => (
                <tr key={item.key}>
                  <td><strong>{item.name}</strong><small>{item.category} · {item.occurrences} payments</small></td>
                  <td>{item.cadence === "weekly" ? "Weekly" : "Monthly"}</td>
                  <td>{formatCurrency(item.typicalAmount, currency)}</td>
                  <td>{formatCurrency(item.monthlyCost, currency)}</td>
                  <td><span className="next-date"><CalendarClock size={12} /> {formatDate(item.nextExpected)}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="counterparty-empty">No steady weekly or monthly payments found yet. At least three transactions on a regular rhythm are needed.</div>}
      </section>

      <section className="panel recipient-insight-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">TRANSPORT SPEND</div><h2>Typical fare ranges</h2></div>
          <span className="heading-note"><Car size={14} /> {fareRanges.length} payees</span>
        </div>
        <p className="panel-note">The 20th–80th percentile of your recorded Transport payments per payee, shown after at least three fares. It describes your history, not a route-based market price.</p>
        {fareRanges.length ? (
          <div className="recipient-fare-grid">
            {fareRanges.map((fare) => (
              <article className="recipient-fare-card" key={fare.key}>
                <div><strong>{fare.name}</strong><span>{fare.count.toLocaleString("en-NG")} fares · last {formatDate(fare.lastDate)}</span></div>
                <div className="recipient-fare-amount"><small>USUAL RANGE</small><strong>{formatCurrency(fare.lowerAmount, currency)} – {formatCurrency(fare.upperAmount, currency)}</strong></div>
                <div className="recipient-fare-median"><span>Median</span><strong>{formatCurrency(fare.medianAmount, currency)}</strong></div>
              </article>
            ))}
          </div>
        ) : (
          <div className="counterparty-empty"><CircleHelp size={15} /> No payee has three identified Transport payments yet. Categorise ride payments as Transport to include them.</div>
        )}
      </section>

      {editing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}>
          <section className="privacy-modal recipient-profile-modal" role="dialog" aria-modal="true" aria-labelledby="recipient-profile-heading">
            <button className="icon-button modal-close" onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button>
            <div className="data-card-icon"><Users size={18} /></div>
            <div className="panel-kicker">MANAGE {editing.kind.toUpperCase()} PROFILE</div>
            <h2 id="recipient-profile-heading">Keep this identity consistent.</h2>
            <p>Aliases connect spelling and narration variants in this browser. The chosen category becomes the profile’s automatic category.</p>
            <form className="savings-form" onSubmit={save}>
              <label>Preferred name<input autoFocus required maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
              <label>Other names from statements<textarea rows={3} maxLength={1200} value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder={"One per line, e.g.\nJANE A DOE\nJANE DOE - PALMPAY"} /></label>
              <label>Automatic category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Use existing rules and history</option>{categoryList.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Private note<textarea rows={2} maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional reminder about this profile" /></label>
              <div className="recipient-profile-actions">
                {profiles.some((profile) => profile.id === editing.id) && (
                  <button type="button" className="button button-text recipient-delete" onClick={() => {
                    if (window.confirm(`Remove the saved profile for ${editing.name}? Transactions will remain; aliases and its category rule will be removed.`)) {
                      onDeleteProfile(editing.id);
                      setEditing(null);
                    }
                  }}><Trash2 size={13} /> Remove profile</button>
                )}
                <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="button button-primary" type="submit"><Pencil size={13} /> Save profile</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
