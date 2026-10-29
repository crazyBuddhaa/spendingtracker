import { useMemo, useState } from "react";
import { Check, CircleHelp, Plus, Search, Trash2, TrendingUp, X } from "lucide-react";
import {
  investmentActions,
  investmentActionLabels,
  investmentAssetTypes,
  type InvestmentAction,
  type InvestmentAssetType,
  type InvestmentRecord,
  type InvestmentValuation,
} from "./types";
import { getInvestmentInsights, type AssetAnalytics } from "./lib/investments";
import { formatDate } from "./lib/format";

interface InvestmentsPageProps {
  records: InvestmentRecord[];
  valuations: InvestmentValuation[];
  currency: string;
  onAddRecord: (record: Omit<InvestmentRecord, "id">) => void;
  onDeleteRecord: (recordId: string) => void;
  onSetValuation: (asset: string, marketValue: number, asOf: string) => void;
  onClearValuation: (asset: string) => void;
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function moneySigned(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return `${amount > 0 ? "+" : ""}${money(amount, currency)}`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 1 }).format(value)}%`;
}

function localDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

type LedgerFilter = InvestmentAction | "all";

export default function InvestmentsPage({
  records,
  valuations,
  currency,
  onAddRecord,
  onDeleteRecord,
  onSetValuation,
  onClearValuation,
}: InvestmentsPageProps) {
  const [typeFilter, setTypeFilter] = useState<InvestmentAssetType | "All types">("All types");
  const [actionFilter, setActionFilter] = useState<LedgerFilter>("all");
  const [query, setQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [breakdownMode, setBreakdownMode] = useState<"assetType" | "broker">("assetType");
  const normalizedQuery = query.trim().toLowerCase();
  const insights = useMemo(() => getInvestmentInsights(records, valuations), [records, valuations]);
  const filteredRecords = useMemo(() => records
    .filter((row) => typeFilter === "All types" || row.assetType === typeFilter)
    .filter((row) => actionFilter === "all" || row.action === actionFilter)
    .filter((row) => !normalizedQuery || `${row.asset} ${row.broker} ${row.note ?? ""}`.toLowerCase().includes(normalizedQuery))
    .sort((first, second) => second.date.localeCompare(first.date)), [records, typeFilter, actionFilter, normalizedQuery]);
  const breakdownRows = breakdownMode === "assetType" ? insights.byType : insights.byBroker;
  const maxMonthFlow = Math.max(1, ...insights.monthly.map((row) => Math.abs(row.net)));
  const anyMissingUnits = insights.assets.some((asset) => asset.realizedProfit === null);
  const markMissingValue = insights.assets.some((asset) => asset.latestValuation === null);

  return (
    <section className="investments-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR OWN MODELS</div>
          <h1>Investments live in their own ledger.</h1>
          <p className="page-subtitle">Record buys, sales, fees, and interest per asset, mark what a holding is worth today, and see returns only from what you actually recorded. No live prices are fetched; valuations are yours.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-primary" onClick={() => setShowAddForm(true)}><Plus size={15} /> Add event</button>
        </div>
      </div>

      <div className="bet-metrics">
        <Metric label="LEDGER EVENTS" value={String(records.length)} detail={`${insights.assets.length} asset${insights.assets.length === 1 ? "" : "s"} tracked`} />
        <Metric label="MONEY IN" value={money(insights.totals.moneyIn, currency)} detail={`Buys and fees · ${insights.totals.eventCount} events`} />
        <Metric label="CASH BACK" value={money(insights.totals.moneyBack, currency)} detail="Sales proceeds and income" />
        <Metric label="INCOME RECEIVED" value={money(insights.totals.income, currency)} detail="Dividends, interest, coupons" tone="positive" />
        <Metric label="REALIZED P/L" value={anyMissingUnits ? "Needs units" : moneySigned(insights.totals.realizedProfit, currency)} detail={anyMissingUnits ? "Log units on buys and sells to measure" : "Sales minus average cost of units sold"} tone={insights.totals.realizedProfit >= 0 ? "positive" : "negative"} />
        <Metric label="PAPER VALUE" value={insights.totals.paperValue > 0 ? money(insights.totals.paperValue, currency) : "Not marked"} detail={`${insights.valuationCount} current value mark${insights.valuationCount === 1 ? "" : "s"} recorded`} />
        <Metric label="NET FLOW" value={moneySigned(insights.totals.netFlow, currency)} detail="Cash back minus money in" tone={insights.totals.netFlow >= 0 ? "positive" : "negative"} />
        <Metric label="OVERALL ROI" value={percent(insights.totals.roi)} detail="Realized plus income ÷ money in" tone={insights.totals.roi === null || insights.totals.roi >= 0 ? "positive" : "negative"} />
      </div>

      <section className="panel bet-detail-panel">
        <div className="panel-heading"><div><div className="panel-kicker">CURRENT HOLDINGS</div><h2>What you hold and what it was worth last time you checked</h2></div></div>
        {insights.assets.length === 0
          ? <EmptyLedger message="No assets recorded yet. Add your first buy to start a holdings ledger — entries stay in this browser." />
          : (
            <div className="inv-asset-grid">
              {insights.assets.map((asset) => (
                <AssetCard
                  key={asset.asset.toLowerCase()}
                  asset={asset}
                  currency={currency}
                  unmarked={markMissingValue}
                  onSetValuation={onSetValuation}
                  onClearValuation={onClearValuation}
                />
              ))}
            </div>
          )}
      </section>

      <div className="bet-analytics-grid">
        <section className="panel bet-detail-panel">
          <div className="panel-heading"><div><div className="panel-kicker">MONEY FLOW BY MONTH</div><h2>Invested, returned, and net</h2></div></div>
          {insights.monthly.length ? (
            <div className="bet-period-list">
              {insights.monthly.slice(0, 12).map((row) => (
                <div className="bet-period-row" key={row.label}>
                  <span className="bet-period-label">{formatDate(`${row.label}-01`).slice(4)}</span>
                  <div className="bet-period-track" aria-label={`${row.label}: net ${moneySigned(row.net, currency)}`}>
                    <i className={`bet-period-bar ${row.net < 0 ? "loss" : "gain"}`} style={{
                      width: `${(Math.abs(row.net) / maxMonthFlow) * 50}%`,
                      left: row.net >= 0 ? "50%" : undefined,
                      right: row.net < 0 ? "50%" : undefined,
                    }} />
                  </div>
                  <strong className={row.net < 0 ? "bet-net-negative" : row.net > 0 ? "bet-net-positive" : ""}>{moneySigned(row.net, currency)}</strong>
                  <small>{money(row.invested, currency)} in · {money(row.returned + row.income, currency)} back</small>
                </div>
              ))}
            </div>
          ) : <div className="bet-analysis-empty">Add dated events to see a monthly flow.</div>}
        </section>

        <section className="panel bet-detail-panel">
          <div className="panel-heading bet-analysis-heading">
            <div><div className="panel-kicker">PERFORMANCE BREAKDOWN</div><h2>By type or platform</h2></div>
            <select value={breakdownMode} onChange={(event) => setBreakdownMode(event.target.value as "assetType" | "broker")} aria-label="Break down performance by">
              <option value="assetType">Asset type</option><option value="broker">Platform</option>
            </select>
          </div>
          {breakdownRows.length ? (
            <div className="bet-breakdown-wrap">
              <table className="bet-breakdown-table">
                <thead><tr><th>GROUP</th><th>EVENTS</th><th>MONEY IN</th><th>CASH BACK</th><th>INCOME</th><th>ROI</th></tr></thead>
                <tbody>{breakdownRows.map((row) => (
                  <tr key={row.label}>
                    <td className="bet-breakdown-label" title={row.label}>{row.label}</td>
                    <td>{row.eventCount}</td>
                    <td>{money(row.moneyIn, currency)}</td>
                    <td>{money(row.moneyBack, currency)}</td>
                    <td>{money(row.income, currency)}</td>
                    <td>{percent(row.roi)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="bet-analysis-empty">No records to compare yet.</div>}
          <p className="bet-analysis-note">ROI here counts realized profit and recorded income against money in; paper gains need a marked value and never appear in this table.</p>
        </section>
      </div>

      <section className="panel bet-history-panel">
        <div className="bet-history-heading">
          <div><div className="panel-kicker">INVESTMENT LEDGER</div><h2>Recorded events <span className="heading-count">{filteredRecords.length}</span></h2></div>
          <div className="bet-filter-tools">
            <label className="bet-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search asset, platform, note" /></label>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as InvestmentAssetType | "All types")} aria-label="Filter by asset type">
              <option value="All types">All types</option>
              {investmentAssetTypes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as LedgerFilter)} aria-label="Filter by event type">
              <option value="all">All events</option>
              {investmentActions.map((item) => <option key={item} value={item}>{investmentActionLabels[item]}</option>)}
            </select>
          </div>
        </div>
        {filteredRecords.length ? (
          <div className="bet-table-wrap">
            <table className="bet-table">
              <thead><tr><th>DATE</th><th>ASSET</th><th>EVENT</th><th className="bet-amount-cell">AMOUNT</th><th className="bet-amount-cell">UNITS / PRICE</th><th>NOTE</th><th></th></tr></thead>
              <tbody>
                {filteredRecords.map((row) => (
                  <tr key={row.id}>
                    <td className="bet-date">{formatDate(row.date)}</td>
                    <td className="bet-description"><strong>{row.asset}</strong><span><i className={`inv-type-tag inv-type-${row.assetType.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{row.assetType}</i> {row.broker}</span></td>
                    <td><span className={`inv-action inv-action-${row.action}`}>{investmentActionLabels[row.action]}</span></td>
                    <td className={`bet-amount-cell ${row.action === "buy" || row.action === "fee" ? "bet-net-negative" : "bet-net-positive"}`}>{row.action === "buy" || row.action === "fee" ? "−" : "+"}{money(row.amount, currency)}</td>
                    <td className="bet-amount-cell">{row.units != null ? `${row.units.toLocaleString("en-NG")}${row.pricePerUnit != null ? ` @ ${money(row.pricePerUnit, currency)}` : ""}` : "—"}</td>
                    <td className="bet-description"><span>{row.note ?? "—"}</span></td>
                    <td><button className="icon-button bet-delete" onClick={() => window.confirm("Delete this investment event? The ledger entry is removed but other rows stay untouched.") && onDeleteRecord(row.id)} aria-label="Delete event"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyLedger message={records.length ? "No events match those filters." : "No investment events yet. Add a buy, sale, fee, or interest entry; everything stays local."} />
        )}
      </section>

      {showAddForm && (
        <AddEventModal
          currency={currency}
          brokers={[...new Set(records.map((row) => row.broker))]}
          onClose={() => setShowAddForm(false)}
          onSave={(record) => {
            onAddRecord(record);
            setShowAddForm(false);
          }}
        />
      )}
    </section>
  );
}

function Metric({ label, value, detail, tone = "" }: { label: string; value: string; detail: string; tone?: string }) {
  return <section className={`panel bet-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></section>;
}

function AssetCard({
  asset,
  currency,
  unmarked,
  onSetValuation,
  onClearValuation,
}: {
  asset: AssetAnalytics;
  currency: string;
  unmarked: boolean;
  onSetValuation: (asset: string, marketValue: number, asOf: string) => void;
  onClearValuation: (asset: string) => void;
}) {
  const [valueInput, setValueInput] = useState("");
  const submitValue = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number(valueInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onSetValuation(asset.asset, parsed, localDate());
    setValueInput("");
  };
  return (
    <article className="inv-asset">
      <header className="inv-asset-head">
        <strong title={asset.asset}>{asset.asset}</strong>
        <span className="inv-asset-head-meta">
          <i className={`inv-type-tag inv-type-${asset.assetType.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{asset.assetType}</i>
          {asset.brokers.join(" · ")}
        </span>
      </header>
      <dl className="inv-asset-facts">
        <div><dt>Money in</dt><dd>{money(asset.moneyIn, currency)}</dd></div>
        <div><dt>Cash back</dt><dd>{money(asset.moneyBack, currency)}</dd></div>
        <div><dt>{asset.unitsKnown ? `Units held · avg cost` : "Units"}</dt>
          <dd>{asset.unitsKnown ? `${asset.heldUnits ?? 0} @ ${money(asset.averageCostPerUnit ?? 0, currency)}` : "Not recorded — log unit counts to measure returns"}</dd></div>
        <div><dt>Realized P/L</dt><dd className={asset.realizedProfit != null && asset.realizedProfit < 0 ? "bet-net-negative" : asset.realizedProfit != null ? "bet-net-positive" : ""}>{asset.realizedProfit === null ? "Needs units" : moneySigned(asset.realizedProfit, currency)}</dd></div>
        <div><dt>Income</dt><dd>{money(asset.income, currency)}</dd></div>
      </dl>
      <div className="inv-value-block">
        {asset.latestValuation ? (
          <p className="inv-value-current">
            <TrendingUp size={14} />
            Last marked <strong>{money(asset.latestValuation.marketValue, currency)}</strong> on {formatDate(asset.latestValuation.asOf)} · paper P/L {" "}
            <strong className={asset.unrealizedProfit != null && asset.unrealizedProfit < 0 ? "bet-net-negative" : "bet-net-positive"}>{moneySigned(asset.unrealizedProfit, currency)}</strong>
            {asset.totalReturn !== null && <em> · total return {percent(asset.roi)}</em>}
          </p>
        ) : (
          <p className="inv-value-current inv-value-current--unset">{unmarked ? <CircleHelp size={14} /> : <TrendingUp size={14} />} No value mark yet{asset.lastEventDate ? ` · last event ${formatDate(asset.lastEventDate)}` : ""}.</p>
        )}
        <form className="inv-value-form" onSubmit={submitValue}>
          <input
            type="number"
            step="any"
            min="0"
            placeholder={`Mark value today (${currency})`}
            value={valueInput}
            onChange={(event) => setValueInput(event.target.value)}
            aria-label={`Mark current value of ${asset.asset}`}
          />
          <button className="button button-secondary" type="submit" disabled={!Number(valueInput)}><Check size={13} /> Mark</button>
          {asset.latestValuation && <button className="button button-text" type="button" onClick={() => onClearValuation(asset.asset)}>Clear mark</button>}
        </form>
      </div>
    </article>
  );
}

function EmptyLedger({ message }: { message: string }) {
  return <div className="bet-empty-state"><div className="bet-empty-icon"><TrendingUp size={21} /></div><strong>{message}</strong></div>;
}

function AddEventModal({
  currency,
  brokers,
  onClose,
  onSave,
}: {
  currency: string;
  brokers: string[];
  onClose: () => void;
  onSave: (record: Omit<InvestmentRecord, "id">) => void;
}) {
  const [date, setDate] = useState(localDate());
  const [assetType, setAssetType] = useState<InvestmentAssetType>("Stocks");
  const [asset, setAsset] = useState("");
  const [action, setAction] = useState<InvestmentAction>("buy");
  const [amount, setAmount] = useState("");
  const [units, setUnits] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [broker, setBroker] = useState("Manual entry");
  const [note, setNote] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountValue = Number(amount);
    const unitsValue = units === "" ? undefined : Number(units);
    const priceValue = pricePerUnit === "" ? undefined : Number(pricePerUnit);
    if (!date || !asset.trim() || !Number.isFinite(amountValue) || amountValue <= 0) return;
    onSave({
      date,
      assetType,
      asset: asset.trim(),
      action,
      amount: Math.round(amountValue * 100) / 100,
      ...(unitsValue !== undefined && Number.isFinite(unitsValue) && unitsValue > 0 ? { units: unitsValue } : {}),
      ...(priceValue !== undefined && Number.isFinite(priceValue) && priceValue > 0 ? { pricePerUnit: priceValue } : {}),
      broker: broker.trim() || "Manual entry",
      ...(note.trim() ? { note: note.trim().slice(0, 280) } : {}),
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="privacy-modal bet-modal" role="dialog" aria-modal="true" aria-labelledby="new-investment-heading">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="privacy-modal-icon"><TrendingUp size={20} /></div>
        <div className="panel-kicker">INVESTMENT LEDGER</div>
        <h2 id="new-investment-heading">Add an event</h2>
        <p className="bet-form-help">Records what you actually did. The tracker stores it locally; it does not place trades or fetch prices.</p>
        <form className="bet-form" onSubmit={submit}>
          <label>Date<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>Asset type<select value={assetType} onChange={(event) => setAssetType(event.target.value as InvestmentAssetType)}>{investmentAssetTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Asset<input required maxLength={120} value={asset} onChange={(event) => setAsset(event.target.value)} placeholder="e.g. GTB shares" /></label>
          <label>Event<select value={action} onChange={(event) => setAction(event.target.value as InvestmentAction)}>{investmentActions.map((item) => <option key={item} value={item}>{investmentActionLabels[item]}</option>)}</select></label>
          <label>Amount ({currency})<input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="25000" /></label>
          <label>Units (optional)<input type="number" min="0" step="any" value={units} onChange={(event) => setUnits(event.target.value)} placeholder="500" /></label>
          <label>Price per unit (optional)<input type="number" min="0" step="any" value={pricePerUnit} onChange={(event) => setPricePerUnit(event.target.value)} placeholder="50" /></label>
          <label>Platform<input list="known-investment-brokers" maxLength={60} value={broker} onChange={(event) => setBroker(event.target.value)} /></label>
          <datalist id="known-investment-brokers">{["Manual entry", ...brokers].map((item) => <option key={item} value={item} />)}</datalist>
          <label className="bet-event-field">Note (optional)<input maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anything worth remembering" /></label>
          <button className="button button-primary bet-submit" type="submit"><Check size={15} /> Save event</button>
        </form>
      </section>
    </div>
  );
}
