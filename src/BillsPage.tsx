import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, CirclePause, CirclePlay, Pencil, Plus, ReceiptText, Trash2, X } from "lucide-react";
import { categoryList, supportedCurrencies, type AccountPreferences, type BillFrequency, type Category, type Direction, type RecurringBill } from "./types";
import { accountCurrency, convertAccountAmount } from "./lib/accounts";
import { addDays, dateFromDay, dayNumber, getBillOccurrences, projectCashFlow } from "./lib/recurringBills";
import { formatCurrency, formatDate, localIsoDate, newId } from "./lib/format";

interface BillsPageProps {
  bills: RecurringBill[];
  accounts: string[];
  preferences: AccountPreferences;
  startingBalance: number;
  onStartingBalanceChange: (value: number) => void;
  onSave: (bill: RecurringBill) => void;
  onDelete: (billId: string) => void;
  onTogglePause: (billId: string) => void;
}

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

export default function BillsPage({ bills, accounts, preferences, startingBalance, onStartingBalanceChange, onSave, onDelete, onTogglePause }: BillsPageProps) {
  const today = localIsoDate();
  const [visibleMonth, setVisibleMonth] = useState(() => monthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [projectionDays, setProjectionDays] = useState(30);
  const [editing, setEditing] = useState<RecurringBill | null | "new">(null);
  const monthStart = `${visibleMonth}-01`;
  const monthEnd = dateFromDay(new Date(Date.UTC(Number(visibleMonth.slice(0, 4)), Number(visibleMonth.slice(5, 7)), 0)).getTime() / 86_400_000);
  const monthOccurrences = useMemo(() => getBillOccurrences(bills, monthStart, monthEnd), [bills, monthStart, monthEnd]);
  const monthTitle = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart}T00:00:00Z`));
  const firstDay = dayNumber(monthStart);
  const mondayOffset = (new Date(`${monthStart}T00:00:00Z`).getUTCDay() + 6) % 7;
  const calendarStart = addDays(monthStart, -mondayOffset);
  const calendarDays = Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
  void firstDay;
  const selectedOccurrences = monthOccurrences.filter((item) => item.date === selectedDate);
  const upcoming = useMemo(() => getBillOccurrences(bills, today, addDays(today, 90)), [bills, today]);
  const projection = useMemo(() => projectCashFlow(
    bills,
    today,
    startingBalance,
    projectionDays,
    (amount, currency) => convertAccountAmount(amount, currency, preferences),
  ), [bills, today, startingBalance, projectionDays, preferences]);
  const endBalance = projection.points.at(-1)?.balance ?? startingBalance;
  const lowestBalance = Math.min(...projection.points.map((point) => point.balance), startingBalance);
  const monthExpenses = monthOccurrences.filter((item) => item.bill.direction === "expense").reduce((sum, item) => {
    const amount = convertAccountAmount(item.bill.amount, item.bill.currency, preferences);
    return sum + (amount ?? 0);
  }, 0);

  const moveMonth = (offset: number) => {
    const date = new Date(`${monthStart}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const next = `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
    setVisibleMonth(next);
    setSelectedDate(`${next}-01`);
  };

  return (
    <section className="bills-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> PLAN BEYOND TODAY</div>
          <h1>Bills, due dates, and breathing room.</h1>
          <p className="page-subtitle">See recurring commitments on a real calendar, then project a simple running balance. Nothing is paid or posted automatically.</p>
        </div>
        <div className="heading-actions"><button className="button button-primary" onClick={() => setEditing("new")}><Plus size={15} /> Add recurring item</button></div>
      </div>

      <div className="bill-metrics">
        <div><span>DUE THIS MONTH</span><strong>{monthOccurrences.filter((item) => item.bill.direction === "expense").length.toLocaleString("en-NG")}</strong><small>{formatCurrency(monthExpenses, preferences.displayCurrency)} in known-rate expenses</small></div>
        <div><span>PROJECTED {projectionDays}-DAY OUTFLOW</span><strong>{formatCurrency(projection.totalExpenses, preferences.displayCurrency)}</strong><small>{formatCurrency(projection.totalIncome, preferences.displayCurrency)} expected in</small></div>
        <div><span>LOWEST PROJECTED BALANCE</span><strong className={lowestBalance < 0 ? "text-negative" : ""}>{formatCurrency(lowestBalance, preferences.displayCurrency)}</strong><small>Before any unscheduled activity</small></div>
      </div>

      <div className="bills-calendar-layout">
        <section className="panel bill-calendar-panel">
          <div className="bill-calendar-toolbar">
            <div><div className="panel-kicker">RECURRING CALENDAR</div><h2>{monthTitle}</h2></div>
            <div className="calendar-nav"><button className="button button-text" onClick={() => { setVisibleMonth(monthKey(new Date())); setSelectedDate(today); }}>Today</button><button className="icon-button" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button><button className="icon-button" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={17} /></button></div>
          </div>
          <div className="bill-calendar" role="grid" aria-label={`${monthTitle} recurring bills`}>
            {weekdayLabels.map((day) => <div className="bill-weekday" role="columnheader" key={day}>{day}</div>)}
            {calendarDays.map((date) => {
              const daily = monthOccurrences.filter((item) => item.date === date);
              const outside = date.slice(0, 7) !== visibleMonth;
              return (
                <button key={date} role="gridcell" aria-selected={selectedDate === date} className={`bill-day ${outside ? "outside" : ""} ${selectedDate === date ? "selected" : ""} ${date === today ? "today" : ""}`} onClick={() => setSelectedDate(date)}>
                  <span className="bill-day-number">{Number(date.slice(8, 10))}</span>
                  <span className="bill-day-events">
                    {daily.slice(0, 2).map((item) => <span key={item.key} className={`bill-event-dot ${item.bill.direction}`} title={`${item.bill.name}: ${formatCurrency(item.bill.amount, item.bill.currency)}`}><i />{item.bill.name}</span>)}
                    {daily.length > 2 && <span className="bill-event-more">+{daily.length - 2} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="bill-calendar-legend"><span><i className="expense" /> Bill due</span><span><i className="income" /> Expected income</span><span>Select a day to inspect it</span></div>
        </section>

        <aside className="panel bill-day-panel">
          <div className="panel-kicker">SELECTED DAY</div>
          <h2>{formatDate(selectedDate)}</h2>
          {selectedOccurrences.length ? <div className="selected-bill-list">{selectedOccurrences.map((item) => (
            <div className="selected-bill" key={item.key}>
              <span className={`bill-direction-icon ${item.bill.direction}`}>{item.bill.direction === "income" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span>
              <div><strong>{item.bill.name}</strong><span>{item.bill.account} · {item.bill.frequency}</span></div>
              <strong>{item.bill.direction === "income" ? "+" : "−"}{formatCurrency(item.bill.amount, item.bill.currency)}</strong>
            </div>
          ))}</div> : <div className="bill-day-empty"><CalendarDays size={24} /><strong>No recurring items due</strong><span>Your unscheduled activity is not included here.</span></div>}
          <button className="button button-secondary bill-day-add" onClick={() => setEditing("new")}><Plus size={14} /> Add on this date</button>
        </aside>
      </div>

      <section className="panel cash-projection-panel">
        <div className="panel-heading projection-heading">
          <div><div className="panel-kicker">SIMPLE CASH-FLOW PROJECTION</div><h2>{formatCurrency(endBalance, preferences.displayCurrency)} after {projectionDays} days</h2><p>Starting balance plus recurring income, minus recurring bills. Variable spending and one-off transactions are excluded.</p></div>
          <div className="projection-controls"><label>Opening balance ({preferences.displayCurrency})<input type="number" step="any" value={startingBalance} onChange={(event) => onStartingBalanceChange(Number(event.target.value) || 0)} /></label><div className="segmented">{[30, 60, 90].map((days) => <button key={days} className={projectionDays === days ? "active" : ""} onClick={() => setProjectionDays(days)}>{days} days</button>)}</div></div>
        </div>
        <ProjectionChart points={projection.points} currency={preferences.displayCurrency} />
        {projection.skipped.length > 0 && <p className="projection-warning">Add manual rates for {projection.skipped.map((bill) => bill.currency).filter((value, index, all) => all.indexOf(value) === index).join(", ")} on the Accounts page to include {projection.skipped.length} recurring item{projection.skipped.length === 1 ? "" : "s"}.</p>}
      </section>

      <section className="panel recurring-bills-panel">
        <div className="panel-heading"><div><div className="panel-kicker">NEXT 90 DAYS</div><h2>Recurring schedule <span className="heading-count">{bills.length}</span></h2></div><span className="heading-note"><ReceiptText size={14} /> Local planning only</span></div>
        {bills.length ? <div className="recurring-bill-list">{bills.map((bill) => {
          const next = upcoming.find((item) => item.bill.id === bill.id);
          return <article className={`recurring-bill-row ${bill.paused ? "paused" : ""}`} key={bill.id}>
            <div className="recurring-bill-name"><span className={`bill-direction-icon ${bill.direction}`}>{bill.direction === "income" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><div><strong>{bill.name}</strong><span>{bill.category} · {bill.account}</span></div></div>
            <div><span>Amount</span><strong>{bill.direction === "income" ? "+" : "−"}{formatCurrency(bill.amount, bill.currency)}</strong></div>
            <div><span>Frequency</span><strong>{bill.frequency}{bill.paused ? " · paused" : ""}</strong></div>
            <div><span>Next due</span><strong>{bill.paused ? "Not projected" : next ? formatDate(next.date) : formatDate(bill.nextDueDate)}</strong></div>
            <div className="recurring-bill-actions"><button className="icon-button" onClick={() => onTogglePause(bill.id)} aria-label={`${bill.paused ? "Resume" : "Pause"} ${bill.name}`} title={bill.paused ? "Resume" : "Pause"}>{bill.paused ? <CirclePlay size={16} /> : <CirclePause size={16} />}</button><button className="icon-button" onClick={() => setEditing(bill)} aria-label={`Edit ${bill.name}`}><Pencil size={15} /></button><button className="icon-button" onClick={() => onDelete(bill.id)} aria-label={`Delete ${bill.name}`}><Trash2 size={15} /></button></div>
          </article>;
        })}</div> : <div className="feature-empty"><ReceiptText size={25} /><strong>Build your recurring schedule</strong><span>Add rent, utilities, subscriptions, or regular income to start a projection.</span><button className="button button-primary" onClick={() => setEditing("new")}><Plus size={14} /> Add the first item</button></div>}
      </section>

      {editing && <BillModal bill={editing === "new" ? null : editing} initialDate={selectedDate} accounts={accounts} preferences={preferences} onClose={() => setEditing(null)} onSave={(bill) => { onSave(bill); setEditing(null); }} />}
    </section>
  );
}

function ProjectionChart({ points, currency }: { points: ReturnType<typeof projectCashFlow>["points"]; currency: string }) {
  if (!points.length) return null;
  const width = 760;
  const height = 190;
  const left = 58;
  const bottom = 28;
  const values = points.map((point) => point.balance);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const spread = Math.max(max - min, 1);
  const x = (index: number) => left + (index / Math.max(points.length - 1, 1)) * (width - left - 12);
  const y = (value: number) => 12 + ((max - value) / spread) * (height - 12 - bottom);
  const line = points.map((point, index) => `${x(index)},${y(point.balance)}`).join(" ");
  const area = `${left},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`;
  return <div className="projection-chart-wrap"><svg className="projection-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Projected balance from ${formatCurrency(points[0].balance, currency)} to ${formatCurrency(points.at(-1)!.balance, currency)}`}>
    <line x1={left} x2={width - 12} y1={y(0)} y2={y(0)} className="projection-zero" />
    <text x={left - 8} y={y(max) + 4} textAnchor="end" className="chart-axis-label">{formatCurrency(max, currency, true)}</text>
    <text x={left - 8} y={y(min) + 4} textAnchor="end" className="chart-axis-label">{formatCurrency(min, currency, true)}</text>
    <polygon points={area} className="projection-area" /><polyline points={line} className="projection-line" />
    {points.map((point, index) => point.occurrences.length > 0 && <g key={point.date}><circle cx={x(index)} cy={y(point.balance)} r="4" className={point.expenses > point.income ? "projection-point expense" : "projection-point income"}><title>{`${formatDate(point.date)}\n${point.occurrences.map((item) => `${item.bill.name}: ${formatCurrency(item.bill.amount, item.bill.currency)}`).join("\n")}\nBalance: ${formatCurrency(point.balance, currency)}`}</title></circle></g>)}
    <text x={left} y={height - 6} className="chart-axis-label">{formatDate(points[0].date)}</text><text x={width - 12} y={height - 6} textAnchor="end" className="chart-axis-label">{formatDate(points.at(-1)!.date)}</text>
  </svg></div>;
}

function BillModal({ bill, initialDate, accounts, preferences, onClose, onSave }: { bill: RecurringBill | null; initialDate: string; accounts: string[]; preferences: AccountPreferences; onClose: () => void; onSave: (bill: RecurringBill) => void }) {
  const [name, setName] = useState(bill?.name ?? "");
  const [amount, setAmount] = useState(bill?.amount.toString() ?? "");
  const [direction, setDirection] = useState<Direction>(bill?.direction ?? "expense");
  const [category, setCategory] = useState<Category>(bill?.category ?? "Bills & utilities");
  const [account, setAccount] = useState(bill?.account ?? accounts[0] ?? "Cash");
  const [currency, setCurrency] = useState(bill?.currency ?? accountCurrency(account, preferences));
  const [frequency, setFrequency] = useState<BillFrequency>(bill?.frequency ?? "monthly");
  const [nextDueDate, setNextDueDate] = useState(bill?.nextDueDate ?? initialDate);
  const [note, setNote] = useState(bill?.note ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(amount);
    if (!name.trim() || !Number.isFinite(value) || value <= 0 || !nextDueDate) { setError("Enter a name, a positive amount, and a valid due date."); return; }
    onSave({ id: bill?.id ?? newId("bill"), name: name.trim(), amount: value, direction, category, account: account.trim() || "Cash", currency, frequency, nextDueDate, paused: bill?.paused, note: note.trim() || undefined });
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="privacy-modal bill-modal" role="dialog" aria-modal="true" aria-labelledby="bill-modal-title">
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button><div className="privacy-modal-icon"><CalendarDays size={20} /></div><div className="panel-kicker">RECURRING SCHEDULE</div><h2 id="bill-modal-title">{bill ? "Edit recurring item" : "Add recurring item"}</h2><p>Project this item on the calendar and in cash flow. It will not create a transaction automatically.</p>
    <form className="savings-form form-two-col" onSubmit={submit}>
      <div className="segmented form-full"><button type="button" className={direction === "expense" ? "active" : ""} onClick={() => setDirection("expense")}>Bill / money out</button><button type="button" className={direction === "income" ? "active" : ""} onClick={() => setDirection("income")}>Expected income</button></div>
      <label className="form-full">Name<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Internet subscription" /></label>
      <label>Amount<input required type="number" min="0.01" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{supportedCurrencies.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as BillFrequency)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
      <label>Next due date<input required type="date" value={nextDueDate} onChange={(event) => setNextDueDate(event.target.value)} /></label>
      <label>Account<input list="bill-accounts" value={account} onChange={(event) => { setAccount(event.target.value); if (!bill) setCurrency(accountCurrency(event.target.value, preferences)); }} /></label>
      <datalist id="bill-accounts">{["Cash", ...accounts].map((item) => <option key={item}>{item}</option>)}</datalist>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categoryList.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="form-full">Note (optional)<input maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {error && <p className="form-error form-full" role="alert">{error}</p>}
      <button className="button button-primary modal-done form-full" type="submit"><Check size={15} /> Save to calendar</button>
    </form>
  </section></div>;
}
