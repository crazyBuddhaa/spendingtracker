import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Check, CheckCheck, CircleHelp, ListFilter, RotateCcw, Search, Wand2, X } from "lucide-react";
import { categoryList, type Category, type CategoryRule, type CategoryRuleMatchType, type Direction, type Transaction } from "./types";
import { formatCurrency, formatDate } from "./lib/format";
import type { ClassificationReviewCandidate, RecurringRecipient } from "./lib/transactionReview";
import { ruleMatches, similarityKey } from "./lib/categorise";

interface ClassificationReviewPageProps {
  candidates: ClassificationReviewCandidate[];
  recurringRecipients: RecurringRecipient[];
  transactions: Transaction[];
  currency: string;
  onAcceptSuggestion: (transactionId: string) => void;
  onAcceptAndCreateRule: (transactionId: string, rule: Omit<CategoryRule, "id" | "createdAt">) => void;
  onRejectSuggestion: (transactionId: string) => void;
  onConfirmCurrent: (transactionId: string) => void;
  onBulkDecision: (transactionIds: string[], decision: "accept" | "confirm") => void;
  onChooseCategory: (transactionId: string, category: Category) => void;
  onOpenRecipient: (name: string) => void;
}

type QueueFilter = "all" | "changes" | "low" | "income" | "expense";

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}

function categoryClass(category: Category): string {
  return `category-${category.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

export default function ClassificationReviewPage(props: ClassificationReviewPageProps) {
  const { candidates, recurringRecipients, transactions, currency, onOpenRecipient } = props;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [account, setAccount] = useState("All accounts");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ruleCandidate, setRuleCandidate] = useState<ClassificationReviewCandidate | null>(null);
  const accounts = useMemo(() => [...new Set(candidates.map(({ transaction }) => transaction.source))].sort(), [candidates]);
  const filtered = useMemo(() => candidates.filter(({ transaction, classification }) => {
    if (account !== "All accounts" && transaction.source !== account) return false;
    if (filter === "changes" && classification.category === transaction.category) return false;
    if (filter === "low" && classification.confidence >= 0.6) return false;
    if (filter === "income" && transaction.direction !== "income") return false;
    if (filter === "expense" && transaction.direction !== "expense") return false;
    return !query.trim() || `${transaction.description} ${transaction.category} ${classification.category} ${transaction.source}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [candidates, query, filter, account]);
  const selectedVisible = filtered.filter(({ transaction }) => selected.has(transaction.id));
  const allVisibleSelected = filtered.length > 0 && selectedVisible.length === filtered.length;
  const changes = candidates.filter(({ transaction, classification }) => transaction.category !== classification.category).length;
  const low = candidates.filter(({ classification }) => classification.confidence < 0.6).length;

  useEffect(() => {
    const ids = new Set(candidates.map(({ transaction }) => transaction.id));
    setSelected((current) => new Set([...current].filter((id) => ids.has(id))));
  }, [candidates]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const bulk = (decision: "accept" | "confirm") => {
    const ids = decision === "accept" ? selectedVisible.filter(({ transaction, classification }) => transaction.category !== classification.category).map(({ transaction }) => transaction.id) : selectedVisible.map(({ transaction }) => transaction.id);
    if (ids.length) props.onBulkDecision(ids, decision);
    setSelected(new Set());
  };

  return (
    <section className="classification-review-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> KEEPING CATEGORIES ACCURATE</div>
          <h1>Review less. Teach once.</h1>
          <p className="page-subtitle">Resolve one transaction, handle a focused batch, or create a precise rule with a live match preview.</p>
        </div>
      </div>

      <div className="review-stat-strip">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><span>OPEN DECISIONS</span><strong>{candidates.length}</strong><small>Full local queue</small></button>
        <button className={filter === "changes" ? "active" : ""} onClick={() => setFilter("changes")}><span>CATEGORY CHANGES</span><strong>{changes}</strong><small>Suggested alternatives</small></button>
        <button className={filter === "low" ? "active" : ""} onClick={() => setFilter("low")}><span>LOW CONFIDENCE</span><strong>{low}</strong><small>Below 60% confidence</small></button>
      </div>

      <section className="panel review-queue-panel">
        <div className="panel-heading review-panel-title">
          <div><div className="panel-kicker">SUGGESTIONS TO REVIEW</div><h2>Decision queue <span className="heading-count">{filtered.length.toLocaleString("en-NG")}</span></h2></div>
          <span className="heading-note"><CircleHelp size={14} /> Hand-picked categories stay locked</span>
        </div>
        <div className="review-tools">
          <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payee, category, account…" aria-label="Search review queue" />{query && <button className="icon-button search-clear" onClick={() => setQuery("")} aria-label="Clear review search"><X size={13} /></button>}</label>
          <label className="filter-select"><ListFilter size={14} /><select value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)} aria-label="Review type"><option value="all">All decisions</option><option value="changes">Suggested changes</option><option value="low">Low confidence</option><option value="income">Money in</option><option value="expense">Money out</option></select></label>
          <label className="filter-select"><select value={account} onChange={(event) => setAccount(event.target.value)} aria-label="Review account"><option>All accounts</option>{accounts.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>

        {selectedVisible.length > 0 && <div className="review-bulk-bar" role="status"><strong>{selectedVisible.length} selected</strong><span>Apply a decision without creating rules.</span><button className="button button-secondary" onClick={() => setSelected(new Set())}>Clear</button><button className="button button-secondary" onClick={() => bulk("confirm")}><Check size={14} /> Confirm current</button><button className="button button-primary" onClick={() => bulk("accept")} disabled={!selectedVisible.some(({ transaction, classification }) => transaction.category !== classification.category)}><CheckCheck size={14} /> Accept changes</button></div>}

        {filtered.length ? (
          <>
            <label className="review-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map(({ transaction }) => transaction.id)) : new Set())} /> Select all {filtered.length} visible</label>
            <div className="review-queue-list">
              {filtered.map((candidate) => {
                const { transaction, classification } = candidate;
                const differs = classification.category !== transaction.category;
                const confidenceTone = classification.confidence >= 0.85 ? "high" : classification.confidence >= 0.6 ? "medium" : "low";
                const isIncome = transaction.direction === "income";
                return (
                  <article className={`review-queue-item ${selected.has(transaction.id) ? "is-selected" : ""}`} key={transaction.id}>
                    <input className="review-row-check" type="checkbox" checked={selected.has(transaction.id)} onChange={() => toggle(transaction.id)} aria-label={`Select ${transaction.description}`} />
                    <div className="review-queue-item-main">
                      <div className={`transaction-icon ${isIncome ? "transaction-icon-income" : ""}`}>{isIncome ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</div>
                      <div className="review-queue-item-copy"><strong title={transaction.description}>{transaction.description}</strong><span>{formatDate(transaction.date)} · {transaction.source} · {formatCurrency(transaction.amount, currency)}</span><span className="review-queue-reason">{classification.reason}</span></div>
                    </div>
                    <div className="review-queue-category">
                      <select className={`category-select ${categoryClass(transaction.category)}`} value={transaction.category} onChange={(event) => props.onChooseCategory(transaction.id, event.target.value as Category)} aria-label={`Current category for ${transaction.description}`}>{categoryList.map((category) => <option key={category}>{category}</option>)}</select>
                      <span className="review-queue-arrow" aria-hidden="true">→</span>
                      <span className={`category-pill ${categoryClass(classification.category)}`}>{differs ? "Suggest · " : "Check · "}{classification.category}</span>
                      <span className={`classification-confidence classification-confidence--${confidenceTone}`}>{confidenceLabel(classification.confidence)}</span>
                    </div>
                    <div className="review-queue-actions">
                      {differs ? <><button className="button button-text" onClick={() => props.onRejectSuggestion(transaction.id)}><X size={14} /> Reject</button><button className="button button-secondary" onClick={() => setRuleCandidate(candidate)}><Wand2 size={14} /> Accept & create rule</button><button className="button button-primary" onClick={() => props.onAcceptSuggestion(transaction.id)}><Check size={14} /> Accept</button></> : <button className="button button-primary" onClick={() => props.onConfirmCurrent(transaction.id)}><Check size={14} /> Confirm {transaction.category}</button>}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : <div className="review-queue-empty"><div className="review-queue-empty-icon"><Check size={18} /></div><strong>{candidates.length ? "No decisions match these filters." : "Nothing needs a category decision."}</strong><span>{candidates.length ? "Clear the search or choose another queue filter." : "New low-confidence or conflicting suggestions will appear here."}</span>{candidates.length > 0 && <button className="button button-secondary" onClick={() => { setQuery(""); setFilter("all"); setAccount("All accounts"); }}>Clear filters</button>}</div>}
      </section>

      <section className="panel recurring-recipient-panel">
        <div className="panel-heading"><div><div className="panel-kicker">REPEATED TRANSFERS</div><h2>Recurring recipients <span className="heading-count">{recurringRecipients.length.toLocaleString("en-NG")}</span></h2></div><span className="heading-note"><CalendarClock size={14} /> Detected from transaction dates</span></div>
        <p className="panel-note">A recipient appears here after at least three transfers on a reasonably regular schedule. These are estimates from your local history, not scheduled payments. Add confirmed commitments to the Bills calendar.</p>
        {recurringRecipients.length ? <div className="recurring-recipient-list">{recurringRecipients.map((recipient) => <div className="recurring-recipient-row" key={recipient.key}><div className="recurring-recipient-name"><strong>{recipient.name}</strong><span>{recipient.frequencyLabel} · {recipient.count} transfers · {recipient.direction === "expense" ? "Money out" : "Money in"}</span></div><div><span>Average transfer</span><strong>{formatCurrency(recipient.averageAmount, currency)}</strong></div><div><span>Last seen</span><strong>{formatDate(recipient.lastDate)}</strong></div><div><span>Next expected</span><strong>{formatDate(recipient.nextExpectedDate)}</strong></div><button className="button button-text recurring-recipient-open" onClick={() => onOpenRecipient(recipient.name)}><RotateCcw size={13} /> View history</button></div>)}</div> : <div className="counterparty-empty">No regular recipients found yet. Three or more transfers on a steady schedule are needed.</div>}
      </section>

      {ruleCandidate && <RuleComposer candidate={ruleCandidate} transactions={transactions} onClose={() => setRuleCandidate(null)} onSave={(rule) => { props.onAcceptAndCreateRule(ruleCandidate.transaction.id, rule); setRuleCandidate(null); }} />}
    </section>
  );
}

function RuleComposer({ candidate, transactions, onClose, onSave }: { candidate: ClassificationReviewCandidate; transactions: Transaction[]; onClose: () => void; onSave: (rule: Omit<CategoryRule, "id" | "createdAt">) => void }) {
  const { transaction, classification } = candidate;
  const [pattern, setPattern] = useState(similarityKey(transaction.description));
  const [matchType, setMatchType] = useState<CategoryRuleMatchType>("contains");
  const [direction, setDirection] = useState<"" | Direction>(transaction.direction);
  const [category, setCategory] = useState<Category>(classification.category);
  const [error, setError] = useState("");
  const probe = { pattern: pattern.trim().toLowerCase(), category, direction: direction || undefined, matchType };
  const matches = pattern.trim().length >= 2 ? transactions.filter((item) => ruleMatches(probe, item)) : [];
  const unlockedChanges = matches.filter((item) => !item.manual && !item.categoryLocked && item.category !== category).length;

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="privacy-modal rule-composer" role="dialog" aria-modal="true" aria-labelledby="rule-composer-title">
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close rule composer"><X size={18} /></button><div className="privacy-modal-icon"><Wand2 size={19} /></div><div className="panel-kicker">ACCEPT & TEACH</div><h2 id="rule-composer-title">Turn this decision into a rule</h2><p>Fine-tune the match before saving. The rule applies to future imports and matching unlocked history.</p>
    <div className="rule-source-transaction"><strong>{transaction.description}</strong><span>{transaction.source} · {formatDate(transaction.date)}</span></div>
    <form className="savings-form" onSubmit={(event) => { event.preventDefault(); if (pattern.trim().length < 2) { setError("Use at least two characters for a reliable match."); return; } onSave(probe); }}>
      <label>Match type<select value={matchType} onChange={(event) => setMatchType(event.target.value as CategoryRuleMatchType)}><option value="contains">Description contains</option><option value="startsWith">Description starts with</option><option value="exact">Exact normalized description</option><option value="merchant">Merchant matches</option><option value="counterparty">Recipient or sender matches</option></select></label>
      <label>Match text<input autoFocus value={pattern} maxLength={120} onChange={(event) => setPattern(event.target.value)} /></label>
      <div className="form-two-col"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categoryList.map((item) => <option key={item}>{item}</option>)}</select></label><label>Applies to<select value={direction} onChange={(event) => setDirection(event.target.value as "" | Direction)}><option value="">Money in and out</option><option value="expense">Money out only</option><option value="income">Money in only</option></select></label></div>
      <div className="rule-live-preview" aria-live="polite"><span>LIVE MATCH PREVIEW</span><strong>{matches.length.toLocaleString("en-NG")} transactions match</strong><p>{unlockedChanges.toLocaleString("en-NG")} unlocked categor{unlockedChanges === 1 ? "y" : "ies"} will change now. Manual entries and hand-picked categories are protected.</p>{matches.length > 0 && <small>{matches.slice(0, 3).map((item) => item.description).join(" · ")}{matches.length > 3 ? ` · +${matches.length - 3} more` : ""}</small>}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="rule-composer-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={pattern.trim().length < 2}><Check size={14} /> Accept & save rule</button></div>
    </form>
  </section></div>;
}
