import { useMemo, useState } from "react";
import { Check, CircleHelp, Plus, Search, Ticket, Trash2, Upload, X } from "lucide-react";
import type { BetCategory, BetRecord, BetStatus, Transaction } from "./types";
import { betCategories } from "./types";
import { getBettingInsights, type BetAggregate } from "./lib/bettingInsights";
import { findBetMatchCandidates } from "./lib/bettingReconciliation";

interface BettingPageProps {
  bets: BetRecord[];
  transactions: Transaction[];
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

function formatPercent(value: number | null): string {
  return value === null
    ? "—"
    : `${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatSignedCurrency(amount: number, currency: string): string {
  return `${amount > 0 ? "+" : ""}${formatCurrency(amount, currency)}`;
}

function localDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export default function BettingPage({
  bets,
  transactions,
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
  const [breakdownMode, setBreakdownMode] = useState<"category" | "betType" | "source">("category");
  const [timeMode, setTimeMode] = useState<"month" | "day">("month");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredBets = useMemo(() => bets
    .filter((bet) => categoryFilter === "All categories" || bet.category === categoryFilter)
    .filter((bet) => statusFilter === "All outcomes" || bet.status === statusFilter)
    .filter((bet) => !normalizedQuery || `${bet.events.join(" ")} ${bet.source} ${bet.betType}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => b.date.localeCompare(a.date)), [bets, categoryFilter, statusFilter, normalizedQuery]);
  const insights = useMemo(() => getBettingInsights(bets), [bets]);
  const betMatchCandidates = useMemo(
    () => findBetMatchCandidates(transactions, bets),
    [transactions, bets],
  );
  const bettingBankDebits = useMemo(
    () => transactions.filter((transaction) => transaction.direction === "expense" && transaction.category === "Betting"),
    [transactions],
  );
  const outcomes: BetStatus[] = ["won", "lost", "open", "void", "cashed-out", "other"];
  const outcomeCounts = outcomes.map((outcome) => ({
    status: outcome,
    count: insights.outcomeCounts[outcome],
  }));
  const outcomeTotal = Math.max(bets.length, 1);
  const breakdownRows = breakdownMode === "category"
    ? insights.byCategory
    : breakdownMode === "betType"
      ? insights.byBetType
      : insights.bySource;
  const timeRows = timeMode === "month" ? insights.byMonth : insights.byDay;
  const maxPeriodNet = Math.max(1, ...timeRows.map((row) => Math.abs(row.net)));

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
          <p className="page-subtitle">Track stakes, returns, outcomes, and sport categories separately from everyday spending. Import HTML/MHTML, CSV, Excel, or a text-based PDF history.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" onClick={() => setShowAddForm(true)}><Plus size={15} /> Add bet</button>
          <button className="button button-primary" onClick={onImport}><Upload size={15} /> Import betting history</button>
        </div>
      </div>

      <div className="bet-metrics">
        <BetMetric label="BET RECORDS" value={String(insights.betCount)} detail={`${insights.activeDays} active date${insights.activeDays === 1 ? "" : "s"}`} />
        <BetMetric label="TOTAL STAKED" value={formatCurrency(insights.totalStaked, currency)} detail="All records, including open and unknown" />
        <BetMetric label="TOTAL RETURNED" value={formatCurrency(insights.totalReturned, currency)} detail="Recorded returns across all bets" />
        <BetMetric label="SETTLED NET" value={formatSignedCurrency(insights.settledNet, currency)} detail={`${insights.settledCount} resolved bets · open/unknown excluded`} tone={insights.settledNet >= 0 ? "positive" : "negative"} />
        <BetMetric label="SETTLED ROI" value={formatPercent(insights.roi)} detail="Resolved net ÷ resolved stake" tone={insights.roi === null || insights.roi >= 0 ? "positive" : "negative"} />
        <BetMetric label="WIN RATE" value={formatPercent(insights.winRate)} detail={`${insights.wins} wins ÷ ${insights.decisiveCount} won/lost bets`} />
        <BetMetric label="OPEN STAKE" value={formatCurrency(insights.openStake, currency)} detail={`${insights.openCount} open bet${insights.openCount === 1 ? "" : "s"} · not counted as profit`} />
        <BetMetric label="AVERAGE STAKE" value={insights.averageStake === null ? "—" : formatCurrency(insights.averageStake, currency)} detail="Mean stake across all records" />
      </div>

      <section className="panel bet-detail-panel">
        <div className="panel-heading"><div><div className="panel-kicker">MORE PERFORMANCE STATS</div><h2>Stake distribution and outcomes</h2></div></div>
        <div className="bet-quick-stats">
          <QuickStat label="MEDIAN STAKE" value={insights.medianStake === null ? "—" : formatCurrency(insights.medianStake, currency)} />
          <QuickStat label="AVG. SETTLED NET" value={insights.averageSettledNet === null ? "—" : formatSignedCurrency(insights.averageSettledNet, currency)} />
          <QuickStat label="RETURN / SETTLED STAKE" value={formatPercent(insights.settledReturnRate)} detail="Gross return; returned stake is included" />
          <QuickStat label="WIN / LOSS / EVEN" value={`${insights.positiveSettledCount} / ${insights.negativeSettledCount} / ${insights.evenSettledCount}`} />
          <QuickStat label="EVENTS CAPTURED" value={String(insights.capturedEvents)} detail={`${insights.hiddenEvents} hidden by source · ${insights.averageEventsPerBet?.toFixed(1) ?? "—"} average per bet`} />
        </div>
        <p className="bet-analysis-note">ROI is settled net divided by settled stake. Return rate is gross settled return divided by settled stake, including returned stake. Win rate counts only won and lost bets. Void and cashed-out returns are included in settled net; open and “other” records are excluded.</p>
      </section>

      <section className="panel bet-detail-panel bet-reconciliation-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">BANK-LEDGER REVIEW</div><h2>Possible statement-to-bet matches</h2></div>
          <span className="bet-outcome-total">{betMatchCandidates.length} exact candidate{betMatchCandidates.length === 1 ? "" : "s"}</span>
        </div>
        <p className="bet-analysis-note">Suggestions require one bank debit and one bet with the same date, bookmaker, and stake. A statement debit may be a wallet top-up rather than a bet, so these are not linked automatically or included in betting profit.</p>
        {betMatchCandidates.length > 0 ? (
          <div className="bet-match-list">
            {betMatchCandidates.slice(0, 10).map((candidate) => (
              <div className="bet-match-row" key={candidate.transactionId}>
                <span>{formatBetDate(candidate.date)}</span>
                <strong>{candidate.operator}</strong>
                <span>{formatCurrency(candidate.amount, currency)}</span>
              </div>
            ))}
            {betMatchCandidates.length > 10 && <div className="bet-match-more">And {betMatchCandidates.length - 10} more exact candidates.</div>}
          </div>
        ) : (
          <div className="bet-empty-chart">
            <CircleHelp size={18} />
            {bettingBankDebits.length
              ? `${bettingBankDebits.length} betting-related debit${bettingBankDebits.length === 1 ? "" : "s"} found, but none has a unique date, bookmaker, and stake match.`
              : "Import an OPay statement and a bookmaker bet history to check for possible matches."}
          </div>
        )}
      </section>

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
          <div className="bet-empty-chart"><Ticket size={18} />Import a betting history file or add your first bet to see outcomes here.</div>
        )}
      </section>

      <div className="bet-analytics-grid">
        <section className="panel bet-detail-panel">
          <div className="panel-heading bet-analysis-heading">
            <div><div className="panel-kicker">TIME TREND</div><h2>Settled net by {timeMode}</h2></div>
            <select value={timeMode} onChange={(event) => setTimeMode(event.target.value as "month" | "day")} aria-label="Group time trend by">
              <option value="month">Month</option><option value="day">Day</option>
            </select>
          </div>
          {timeRows.length ? (
            <div className="bet-period-list">
              {timeRows.map((row) => (
                <div className="bet-period-row" key={row.label}>
                  <span className="bet-period-label">{timeMode === "month" ? formatBetMonth(row.label) : formatBetDate(row.label)}</span>
                  <div className="bet-period-track" aria-label={`${row.label}: ${formatSignedCurrency(row.net, currency)}`}>
                    <i className={`bet-period-bar ${row.net < 0 ? "loss" : "gain"}`} style={{
                      width: `${(Math.abs(row.net) / maxPeriodNet) * 50}%`,
                      left: row.net >= 0 ? "50%" : undefined,
                      right: row.net < 0 ? "50%" : undefined,
                    }} />
                  </div>
                  <strong className={row.net < 0 ? "bet-net-negative" : row.net > 0 ? "bet-net-positive" : ""}>{formatSignedCurrency(row.net, currency)}</strong>
                  <small>{row.betCount} bet{row.betCount === 1 ? "" : "s"} · {row.wins}W/{row.losses}L</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="bet-analysis-empty">Add dated bet records to see a time trend.</div>
          )}
        </section>

        <section className="panel bet-detail-panel">
          <div className="panel-heading bet-analysis-heading">
            <div><div className="panel-kicker">PERFORMANCE BREAKDOWN</div><h2>By category, type, or source</h2></div>
            <select value={breakdownMode} onChange={(event) => setBreakdownMode(event.target.value as "category" | "betType" | "source")} aria-label="Break down performance by">
              <option value="category">Category</option><option value="betType">Bet type</option><option value="source">Source</option>
            </select>
          </div>
          {breakdownRows.length ? (
            <div className="bet-breakdown-wrap">
              <table className="bet-breakdown-table">
                <thead><tr><th>{breakdownMode === "betType" ? "BET TYPE" : breakdownMode.toUpperCase()}</th><th>BETS</th><th>SETTLED NET</th><th>ROI</th><th>WIN RATE</th></tr></thead>
                <tbody>{breakdownRows.map((row) => <BreakdownRow key={row.label} row={row} currency={currency} />)}</tbody>
              </table>
            </div>
          ) : (
            <div className="bet-analysis-empty">No bet records to compare yet.</div>
          )}
          <p className="bet-analysis-note">Groups include every record in the count; net, ROI, and win rate follow the definitions above.</p>
        </section>
      </div>

      <section className="panel bet-detail-panel">
        <div className="panel-heading"><div><div className="panel-kicker">RECORD EXTREMES</div><h2>Highest and lowest settled net</h2></div></div>
        <div className="bet-extremes-grid">
          <BetExtreme label="HIGHEST NET" bet={insights.bestBet} currency={currency} empty="No settled bets yet." />
          <BetExtreme label="LOWEST NET" bet={insights.lowestNetBet} currency={currency} empty="No settled bets yet." />
        </div>
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
            <p>{bets.length ? "Change the category, outcome, or search." : "Import a betting history file or add a bet manually. Files are read in this browser."}</p>
            {!bets.length && <button className="button button-primary" onClick={onImport}><Upload size={14} /> Import betting history</button>}
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

function QuickStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="bet-quick-stat"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function BreakdownRow({ row, currency }: { row: BetAggregate; currency: string }) {
  return (
    <tr>
      <td className="bet-breakdown-label" title={row.label}>{row.label}<small>{row.wins}W · {row.losses}L · {row.settledCount} resolved</small></td>
      <td>{row.betCount}</td>
      <td className={row.net > 0 ? "bet-net-positive" : row.net < 0 ? "bet-net-negative" : ""}>{formatSignedCurrency(row.net, currency)}</td>
      <td>{formatPercent(row.roi)}</td>
      <td>{formatPercent(row.winRate)}</td>
    </tr>
  );
}

function BetExtreme({ label, bet, currency, empty }: { label: string; bet: BetRecord | null; currency: string; empty: string }) {
  const net = bet ? bet.returnAmount - bet.stake : 0;
  return (
    <div className="bet-extreme">
      <span>{label}</span>
      {bet ? (
        <>
          <strong className={net >= 0 ? "bet-net-positive" : "bet-net-negative"}>{formatSignedCurrency(net, currency)}</strong>
          <small>{formatBetDate(bet.date)} · {bet.category} · {bet.betType}</small>
          <small>{bet.events.length ? bet.events.slice(0, 2).join(" · ") : "No event details in source"}</small>
        </>
      ) : <small>{empty}</small>}
    </div>
  );
}

function formatBetDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatBetMonth(value: string): string {
  const date = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { month: "short", year: "numeric" }).format(date);
}
