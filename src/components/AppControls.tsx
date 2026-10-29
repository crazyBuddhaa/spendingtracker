import type * as React from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, FileText, LockKeyhole, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { DateRange, Period } from "../lib/insights";
import { pageTitles, periodOptions, type Change, type Page } from "../app/constants";

function NavButton({ page, active, onClick, icon, count }: { page: Page; active: Page; onClick: (page: Page) => void; icon: React.ReactNode; count?: number }) {
  return (
    <button className={active === page ? "nav-item active" : "nav-item"} onClick={() => onClick(page)} aria-current={active === page ? "page" : undefined}>
      {icon}<span>{pageTitles[page]}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count.toLocaleString("en-NG")}</span>}
    </button>
  );
}

function PeriodSelect({
  value,
  custom,
  bounds,
  onChange,
  onCustomChange,
}: {
  value: Period;
  custom: DateRange;
  bounds: { first: string; last: string };
  onChange: (value: Period) => void;
  onCustomChange: (range: DateRange) => void;
}) {
  return (
    <div className="period-controls">
      <label className="period-select">
        <select value={value} aria-label="Period" onChange={(event) => {
          const next = event.target.value as Period;
          if (next === "custom" && !custom.start && !custom.end && bounds.last) {
            onCustomChange({ start: `${bounds.last.slice(0, 7)}-01`, end: bounds.last });
          }
          onChange(next);
        }}>
          {periodOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
        <ChevronDown size={15} />
      </label>
      {value === "custom" && (
        <span className="custom-range">
          <input type="date" aria-label="From" value={custom.start ?? ""} max={custom.end ?? undefined} onChange={(event) => onCustomChange({ ...custom, start: event.target.value || null })} />
          <span>to</span>
          <input type="date" aria-label="To" value={custom.end ?? ""} min={custom.start ?? undefined} onChange={(event) => onCustomChange({ ...custom, end: event.target.value || null })} />
        </span>
      )}
    </div>
  );
}

function MetricCard({
  label,
  amount,
  change,
  goodWhenUp,
  icon,
  tint,
}: {
  label: string;
  amount: string;
  change: Change;
  goodWhenUp: boolean;
  icon: React.ReactNode;
  tint: string;
}) {
  const bad = change.direction !== null && (change.direction === "up") !== goodWhenUp;
  return (
    <section className="metric-card">
      <div className="metric-top"><span>{label}</span><span className={`metric-icon ${tint}`}>{icon}</span></div>
      <strong className="metric-value">{amount}</strong>
      <div className={`metric-comparison ${bad ? "comparison-warn" : ""}`}>
        {change.direction === "up" && <TrendingUp size={13} />}
        {change.direction === "down" && <TrendingDown size={13} />}
        <span>{change.text}</span>
      </div>
    </section>
  );
}

function EmptyState({ onImport, onDemo }: { onImport: () => void; onDemo: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-art">
        <div className="empty-orbit orbit-one" /><div className="empty-orbit orbit-two" />
        <div className="empty-wallet"><Wallet size={29} /></div>
        <span className="float-chip chip-one"><ArrowDownLeft size={15} /></span>
        <span className="float-chip chip-two"><ArrowUpRight size={15} /></span>
      </div>
      <div className="eyebrow"><span className="eyebrow-dot" /> YOUR PRIVATE MONEY DASHBOARD</div>
      <h2>Start with your transaction history.</h2>
      <p>Import CSV, Excel, or text-based PDF statements (OPay, Access Bank, Moniepoint and similar). Spendwise brings them together and shows your income, spending, and patterns in one place.</p>
      <div className="empty-actions"><button className="button button-primary" onClick={onImport}><FileText size={17} /> Import a bank statement</button><button className="button button-text" onClick={onDemo}>Explore with sample data</button></div>
      <div className="empty-foot"><LockKeyhole size={13} /> Statements are read locally and never uploaded.</div>
    </section>
  );
}