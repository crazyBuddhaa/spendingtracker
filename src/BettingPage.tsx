import { useMemo, useState } from "react";
import { Check, CircleHelp, Plus, Search, Ticket, Trash2, Upload, X } from "lucide-react";
import type { BetCategory, BetRecord, BetStatus } from "./types";
import { betCategories } from "./types";

interface BettingPageProps {
  bets: BetRecord[];
  currency: string;
  onImport: () => void;
  onAddBet: (bet: Omit<BetRecord, "id">) => void;
  onChangeCategory: (betId: string, category: BetCategory) => void;
  onDeleteBet: (betId: string) => void;
}

const statusLabels: Record<BetStatus, string> = {
  won: "Won",
  lost: "Lost",
  open: "Open",
  void: "Void",
  "cashed-out": "Cashed out",
  other: "Other",
};

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function localDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export default function BettingPage({
  bets,
  currency,
  onImport,
  onAddBet,
  onChangeCategory,
  onDeleteBet,
}: BettingPageProps) {
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [statusFilter, setStatusFilter] = useState("All outcomes");
  const [query, setQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [date, setDate] = useState(localDate());
  const [category, setCategory] = useState<BetCategory>("Unclassified");
  const [betType, setBetType] = useState("Multiple");
  const [status, setStatus] = useState<BetStatus>("open");
  const [stake, setStake] = useState("");
  const [returnAmount, setReturnAmount] = useState("");
  const [events, setEvents] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredBets = useMemo(() => bets
    .filter((bet) => categoryFilter === "All categories" || bet.category === categoryFilter)
    .filter((bet) => statusFilter === "All outcomes" || bet.status === statusFilter)
    .filter((bet) => !normalizedQuery || `${bet.events.join(" ")} ${bet.source} ${bet.betType}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => b.date.localeCompare(a.date)), [bets, categoryFilter, statusFilter, normalizedQuery]);
  const settledBets = bets.filter((bet) => bet.status !== "open" && bet.status !== "other");
  const totalStaked = bets.reduce((sum, bet) => sum + bet.stake, 0);
  const totalReturned = bets.reduce((sum, bet) => sum + bet.returnAmount, 0);
  const settledNet = settledBets.reduce((sum, bet) => sum + bet.returnAmount - bet.stake, 0);
  const decisiveBets = bets.filter((bet) => bet.status === "won" || bet.status === "lost");
  const wins = bets.filter((bet) => bet.status === "won").length;
  const winRate = decisiveBets.length ? Math.round((wins / decisiveBets.length) * 100) : 0;
  const outcomes: BetStatus[] = ["won", "lost", "open", "void", "cashed-out", "other"];
  const outcomeCounts = outcomes.map((outcome) => ({
    status: outcome,
    count: bets.filter((bet) => bet.status === outcome).length,
  }));
  const outcomeTotal = Math.max(bets.length, 1);

  const submitBet = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const stakeValue = Number(stake);
    const returnValue = Number(returnAmount || 0);
    if (!date || !Number.isFinite(stakeValue) || stakeValue <= 0 || !Number.isFinite(returnValue) || returnValue < 0) return;
    onAddBet({
      date,
      category,
      betType: betType.trim() || "Other",
      status,
      stake: stakeValue,
      returnAmount: returnValue,
      events: events.split(/\n|;/).map((item) => item.trim()).filter(Boolean),
      hiddenEvents: 0,
      source: "Manual entry",
    });
    setShowAddForm(false);
    setStake("");
    setReturnAmount("");
    setEvents("");
    setDate(localDate());
    setCategory("Unclassified");
    setBetType("Multiple");
    setStatus("open");
  };

  return (
    <section className="betting-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> BETTING ACTIVITY</div>
          <h1>Keep bets in their own ledger.</h1>
          <p className="page-subtitle">Track stakes, returns, outcomes, and sport categories separately from everyday spending.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" onClick={() => setShowAddForm(true)}><Plus size={15} /> Add bet</button>
          <button className="button button-primary" onClick={onImport}><Upload size={15} /> Import SportyBet page</button>
        </div>
      </div>

      <div className="bet-metrics">
        <BetMetric label="TOTAL STAKED" value={formatCurrency(totalStaked, currency)} detail={`${bets.length} bet${bets.length === 1 ? "" : "s"} recorded`} />
        <BetMetric label="TOTAL RETURNED" value={formatCurrency(totalReturned, currency)} detail="Amounts shown by the source page" />
        <BetMetric label="SETTLED NET" value={`${settledNet > 0 ? "+" : ""}${formatCurrency(settledNet, currency)}`} detail="Returns minus stakes on settled bets" tone={settledNet >= 0 ? "positive" : "negative"} />
        <BetMetric label="WIN RATE" value={decisiveBets.length ? `${winRate}%` : "—"} detail={`${wins} won · ${decisiveBets.length - wins} lost`} />
      </div>

      <section className="panel bet-outcomes-panel">
        <div className="panel-heading"><div><div className="panel-kicker">OUTCOME MIX</div><h2>How the recorded bets settled</h2></div><span className="bet-outcome-total">{bets.length} total</span></div>
        {bets.length ? (
          <>
            <div className="bet-outcome-chart" role="img" aria-label={outcomeCounts.filter((entry) => entry.count).map((entry) => `${entry.count} ${statusLabels[entry.status]}`).join(", ")}>
              {outcomeCounts.filter((entry) => entry.count).map((entry) => (
                <span key={entry.status} className={`outcome-segment outcome-${entry.status}`} style={{ width: `${(entry.count / outcomeTotal) * 100}%` }} title={`${statusLabels[entry.status]}: ${entry.count}`} />
              ))}
            </div>
            <div className="bet-outcome-legend">
              {outcomeCounts.filter((entry) => entry.count).map((entry) => (
                <span key={entry.status}><i className={`outcome-dot outcome-${entry.status}`} />{statusLabels[entry.status]} <strong>{entry.count}</strong></span>
              ))}
            </div>
          </>
        ) : (
          <div className="bet-empty-chart"><Ticket size={18} />Import a saved SportyBet page or add your first bet to see outcomes here.</div>
        )}
      </section>

      <section className="panel bet-history-panel">
        <div className="bet-history-heading">
          <div><div className="panel-kicker">BET HISTORY</div><h2>Recorded bets <span className="heading-count">{filteredBets.length}</span></h2></div>
          <div className="bet-filter-tools">
            <label className="bet-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" /></label>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category">
              <option>All categories</option>{betCategories.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by outcome">
              <option>All outcomes</option>{outcomes.map((item) => <option value={item} key={item}>{statusLabels[item]}</option>)}
            </select>
          </div>
        </div>

        {filteredBets.length ? (
          <div className="bet-table-wrap">
            <table className="bet-table">
              <thead><tr><th>DATE</th><th>CATEGORY</th><th>BET / EVENTS</th><th>OUTCOME</th><th className="bet-amount-cell">STAKE</th><th className="bet-amount-cell">RETURN</th><th className="bet-amount-cell">NET</th><th></th></tr></thead>
              <tbody>
                {filteredBets.map((bet) => {
                  const net = bet.returnAmount - bet.stake;
                  return (
                    <tr key={bet.id}>
                      <td className="bet-date">{formatBetDate(bet.date)}</td>
                      <td>
                        <select className={`bet-category-select category-tag-${bet.category.toLowerCase().replace(/[^a-z]+/g, "-")}`} value={bet.category} onChange={(event) => onChangeCategory(bet.id, event.target.value as BetCategory)} aria-label={`Category for bet on ${formatBetDate(bet.date)}`}>
                          {betCategories.map((item) => <option key={item}>{item}</option>)}
                        </select>
                      </td>
                      <td className="bet-description"><strong>{bet.betType}</strong><span>{bet.events.length ? bet.events.join(" · ") : "No event details in source"}{bet.hiddenEvents > 0 && <em> · +{bet.hiddenEvents} more match{bet.hiddenEvents === 1 ? "" : "es"} not shown</em>}</span><small>{bet.source}</small></td>
                      <td><span className={`bet-status status-${bet.status}`}>{statusLabels[bet.status]}</span></td>
                      <td className="bet-amount-cell">{formatCurrency(bet.stake, currency)}</td>
                      <td className="bet-amount-cell">{formatCurrency(bet.returnAmount, currency)}</td>
                      <td className={`bet-amount-cell bet-net ${net > 0 ? "bet-net-positive" : net < 0 ? "bet-net-negative" : ""}`}>{bet.status === "open" ? "Open" : `${net > 0 ? "+" : ""}${formatCurrency(net, currency)}`}</td>
                      <td><button className="icon-button bet-delete" onClick={() => window.confirm("Delete this bet record?") && onDeleteBet(bet.id)} aria-label="Delete bet"><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bet-empty-state">
            <div className="bet-empty-icon"><CircleHelp size={21} /></div>
            <strong>{bets.length ? "No bets match those filters." : "No betting records yet."}</strong>
            <p>{bets.length ? "Change the category, outcome, or search." : "Import your saved page or add a bet manually. Imported records stay in this browser."}</p>
            {!bets.length && <button className="button button-primary" onClick={onImport}><Upload size={14} /> Import SportyBet page</button>}
          </div>
        )}
      </section>

      {showAddForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowAddForm(false)}>
          <section className="privacy-modal bet-modal" role="dialog" aria-modal="true" aria-labelledby="new-bet-heading">
            <button className="icon-button modal-close" onClick={() => setShowAddForm(false)} aria-label="Close"><X size={18} /></button>
            <div className="privacy-modal-icon"><Ticket size={20} /></div>
            <div className="panel-kicker">MANUAL BET RECORD</div>
            <h2 id="new-bet-heading">Add a bet</h2>
            <p className="bet-form-help">This records the bet in your private tracker; it does not place or change a wager.</p>
            <form className="bet-form" onSubmit={submitBet}>
              <label>Date<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as BetCategory)}>{betCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Bet type<input maxLength={40} value={betType} onChange={(event) => setBetType(event.target.value)} placeholder="Multiple" /></label>
              <label>Outcome<select value={status} onChange={(event) => setStatus(event.target.value as BetStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Stake ({currency})<input required type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} placeholder="1000" /></label>
              <label>Return ({currency})<input type="number" min="0" step="0.01" value={returnAmount} onChange={(event) => setReturnAmount(event.target.value)} placeholder="0" /></label>
              <label className="bet-event-field">Events or notes<textarea rows={3} value={events} onChange={(event) => setEvents(event.target.value)} placeholder="One event per line" /></label>
              <button className="button button-primary bet-submit" type="submit"><Check size={15} /> Save bet record</button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function BetMetric({ label, value, detail, tone = "" }: { label: string; value: string; detail: string; tone?: string }) {
  return <section className={`panel bet-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></section>;
}

function formatBetDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
