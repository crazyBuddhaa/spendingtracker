import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, Plus, Repeat, Target, Trash2, X } from "lucide-react";
import { categoryList, type Budget, type Category, type Transaction } from "./types";
import { findRecurringPayments, getBudgetStatus, suggestBudget } from "./lib/analytics";
import { formatCurrency, formatDate, formatMonth } from "./lib/format";

interface BudgetsPageProps {
  transactions: Transaction[];
  budgets: Budget[];
  currency: string;
  onSaveBudget: (budget: Budget) => void;
  onDeleteBudget: (category: Category) => void;
}

const budgetableCategories = categoryList.filter((category) => !["Income", "Refunds", "Transfers"].includes(category));

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function BudgetsPage({ transactions, budgets, currency, onSaveBudget, onDeleteBudget }: BudgetsPageProps) {
  const today = new Date();
  const months = useMemo(() => {
    const keys = new Set<string>([monthKey(today)]);
    for (const transaction of transactions) keys.add(transaction.date.slice(0, 7));
    return [...keys].sort().reverse().slice(0, 36);
  }, [transactions]);
  const [month, setMonth] = useState(() => months[0]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formCategory, setFormCategory] = useState<Category>(budgetableCategories.find((category) => !budgets.some((budget) => budget.category === category)) ?? "Food & groceries");
  const [formAmount, setFormAmount] = useState("");

  const status = useMemo(() => getBudgetStatus(transactions, budgets, month, today), [transactions, budgets, month]);
  const recurring = useMemo(() => findRecurringPayments(transactions), [transactions]);
  const totals = status.reduce((sum, item) => ({ limit: sum.limit + item.limit, spent: sum.spent + item.spent }), { limit: 0, spent: 0 });
  const suggestion = useMemo(() => {
    const latest = transactions.reduce((max, transaction) => (transaction.date > max ? transaction.date : max), "");
    const anchor = latest ? new Date(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)), 1) : today;
    return suggestBudget(transactions, formCategory, 3, anchor);
  }, [transactions, formCategory]);

  const openForm = (category?: Category) => {
    const existing = category ? budgets.find((budget) => budget.category === category) : undefined;
    if (category) setFormCategory(category);
    setFormAmount(existing ? String(existing.monthlyLimit) : "");
    setEditing(category ?? null);
    setShowForm(true);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(formAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    onSaveBudget({ category: formCategory, monthlyLimit: amount });
    setShowForm(false);
    setEditing(null);
  };

  return (
    <section className="budgets-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> SPENDING LIMITS</div>
          <h1>Budgets and regular payments.</h1>
          <p className="page-subtitle">Set a monthly limit per category and see how each month is tracking, including the pace for the month in progress.</p>
        </div>
        <div className="heading-actions">
          <label className="period-select">
            <select value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Budget month">
              {months.map((item) => <option key={item} value={item}>{formatMonth(item)}</option>)}
            </select>
          </label>
          <button className="button button-primary" onClick={() => openForm()}><Plus size={15} /> Add budget</button>
        </div>
      </div>

      {status.length > 0 && (
        <div className="budget-summary">
          <div><span>BUDGETED</span><strong>{formatCurrency(totals.limit, currency)}</strong></div>
          <div><span>SPENT IN {formatMonth(month).toUpperCase()}</span><strong>{formatCurrency(totals.spent, currency)}</strong></div>
          <div><span>{totals.limit - totals.spent >= 0 ? "LEFT" : "OVER"}</span><strong className={totals.limit - totals.spent < 0 ? "text-negative" : "text-positive"}>{formatCurrency(Math.abs(totals.limit - totals.spent), currency)}</strong></div>
        </div>
      )}

      <section className="panel budget-panel">
        <div className="panel-heading"><div><div className="panel-kicker">BY CATEGORY</div><h2>{formatMonth(month)}</h2></div></div>
        {status.length ? (
          <div className="budget-list">
            {status.map((item) => (
              <div className={`budget-row budget-${item.status}`} key={item.category}>
                <div className="budget-row-top">
                  <strong>{item.category}</strong>
                  <span>{formatCurrency(item.spent, currency)} <small>of {formatCurrency(item.limit, currency)}</small></span>
                </div>
                <div className="budget-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} aria-label={`${item.category} budget used`}>
                  <i style={{ width: `${Math.min(item.progress, 1) * 100}%` }} />
                </div>
                <div className="budget-row-bottom">
                  <span>
                    {item.status === "over" && <AlertTriangle size={12} />}
                    {item.remaining >= 0 ? `${formatCurrency(item.remaining, currency)} left` : `${formatCurrency(-item.remaining, currency)} over`}
                    {item.projected !== null && ` · on pace for ${formatCurrency(item.projected, currency)}`}
                  </span>
                  <span className="budget-actions">
                    <button className="button-link" onClick={() => openForm(item.category)}>Edit</button>
                    <button className="icon-button" onClick={() => window.confirm(`Remove the ${item.category} budget?`) && onDeleteBudget(item.category)} aria-label={`Remove ${item.category} budget`}><Trash2 size={14} /></button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="feature-empty">
            <Target size={20} />
            <strong>No budgets yet</strong>
            <span>Add a monthly limit for a category such as Betting, Airtime & data, or Food & groceries. A suggested amount based on your recent months is offered.</span>
            <button className="button button-primary" onClick={() => openForm()}><Plus size={14} /> Add your first budget</button>
          </div>
        )}
      </section>

      <section className="panel budget-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">DETECTED FROM YOUR HISTORY</div><h2>Regular payments</h2></div>
          <span className="heading-note"><Repeat size={13} /> {recurring.length} found</span>
        </div>
        <p className="panel-note">Payments to the same payee that repeat weekly or monthly with a similar amount — subscriptions, TV, rent, data plans, or staff you pay.</p>
        {recurring.length ? (
          <div className="simple-table-wrap">
            <table className="simple-table">
              <thead><tr><th>PAYEE</th><th>EVERY</th><th>TYPICAL</th><th>PER MONTH</th><th>LAST PAID</th><th>NEXT EXPECTED</th></tr></thead>
              <tbody>
                {recurring.map((item) => (
                  <tr key={item.key}>
                    <td><strong>{item.name}</strong><small>{item.category} · {item.occurrences} payments</small></td>
                    <td>{item.cadence === "weekly" ? "Week" : "Month"}</td>
                    <td>{formatCurrency(item.typicalAmount, currency)}</td>
                    <td>{formatCurrency(item.monthlyCost, currency)}</td>
                    <td>{formatDate(item.lastDate)}</td>
                    <td><span className="next-date"><CalendarClock size={12} /> {formatDate(item.nextExpected)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="counterparty-empty">No steady weekly or monthly payments were found yet. They appear once a payee has been paid at least three times on a regular rhythm.</div>
        )}
      </section>

      {showForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowForm(false)}>
          <section className="privacy-modal savings-modal" role="dialog" aria-modal="true" aria-labelledby="budget-heading">
            <button className="icon-button modal-close" onClick={() => setShowForm(false)} aria-label="Close"><X size={18} /></button>
            <div className="privacy-modal-icon"><Target size={20} /></div>
            <div className="panel-kicker">{editing ? "EDIT BUDGET" : "NEW BUDGET"}</div>
            <h2 id="budget-heading">Monthly spending limit</h2>
            <form className="savings-form" onSubmit={submit}>
              <label>Category
                <select value={formCategory} disabled={editing !== null} onChange={(event) => setFormCategory(event.target.value as Category)}>
                  {budgetableCategories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </label>
              <label>Limit per month ({currency})<input autoFocus required type="number" min="1" step="any" value={formAmount} onChange={(event) => setFormAmount(event.target.value)} placeholder={suggestion > 0 ? String(suggestion) : "50000"} /></label>
              {suggestion > 0 && (
                <button type="button" className="suggestion-chip" onClick={() => setFormAmount(String(suggestion))}>
                  Use {formatCurrency(suggestion, currency)} — your average over the last 3 full months
                </button>
              )}
              <button className="button button-primary modal-done" type="submit"><Check size={15} /> Save budget</button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
