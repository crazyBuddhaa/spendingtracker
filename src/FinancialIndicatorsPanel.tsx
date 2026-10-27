import { Activity, AlertTriangle, Banknote, Lightbulb, Repeat, Target, TrendingDown, Wallet } from "lucide-react";
import type { Budget, RecipientProfile, Transaction } from "./types";
import type { DateRange } from "./lib/insights";
import { getFinancialIndicatorAnalysis, incomeSourceLabels } from "./lib/financialIndicators";
import { formatCurrency, formatDate, formatMonth } from "./lib/format";

interface FinancialIndicatorsPanelProps {
  transactions: Transaction[];
  range: DateRange;
  budgets: Budget[];
  recipientProfiles: RecipientProfile[];
  currency: string;
  onSearch: (query: string) => void;
}

function Metric({
  label,
  value,
  detail,
  tone = "",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className={`financial-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export default function FinancialIndicatorsPanel({
  transactions,
  range,
  budgets,
  recipientProfiles,
  currency,
  onSearch,
}: FinancialIndicatorsPanelProps) {
  const analysis = getFinancialIndicatorAnalysis(transactions, range, budgets, recipientProfiles);
  const { behavior, leaks, budget, incomeSources } = analysis;
  const spendingRatio = behavior.spendingToIncomePercent;
  const concernTone = spendingRatio !== null && spendingRatio >= 100 ? "metric-attention" : spendingRatio !== null && spendingRatio >= 80 ? "metric-watch" : "";

  return (
    <section className="panel financial-indicators-panel">
      <div className="panel-heading">
        <div>
          <div className="panel-kicker">FINANCIAL BEHAVIOUR INDICATORS</div>
          <h2>Patterns with their evidence</h2>
        </div>
        <Activity size={16} className="muted-icon" />
      </div>
      <p className="panel-note">
        Rule-based estimates from local transaction history for {formatMonth(analysis.month)}. They describe recorded activity; they do not verify a source, diagnose fraud, or change your transactions.
      </p>

      <div className="financial-metric-grid">
        <Metric
          label="SPENDING / INCOME"
          value={spendingRatio === null ? "No income recorded" : `${spendingRatio.toFixed(1)}%`}
          detail={spendingRatio === null
            ? `${formatCurrency(behavior.spending, currency, true)} spending after refunds`
            : `${formatCurrency(behavior.spending, currency, true)} spent · ${formatCurrency(behavior.income, currency, true)} income`}
          tone={concernTone}
        />
        <Metric
          label="NET CASHFLOW"
          value={behavior.income > 0 || behavior.spending > 0 ? formatCurrency(behavior.net, currency, true) : "No activity"}
          detail={`${behavior.transactionCount.toLocaleString("en-NG")} income and expense records in the selected period`}
          tone={behavior.net < 0 ? "metric-attention" : ""}
        />
        <Metric
          label="RECURRING OUTFLOW"
          value={leaks.recurringPayments.length ? formatCurrency(leaks.recurringMonthlyTotal, currency, true) : "None detected"}
          detail={`${leaks.recurringPayments.length} steady payment${leaks.recurringPayments.length === 1 ? "" : "s"} · estimated monthly equivalent`}
        />
        <Metric
          label="BUDGETS OFF PACE"
          value={`${budget.deviations.length} / ${budget.budgetsChecked}`}
          detail={budget.budgetsChecked ? `${formatMonth(budget.month)} actual or projected deviation` : "Add category budgets to track pace"}
          tone={budget.deviations.some((item) => item.status === "over") ? "metric-attention" : budget.deviations.length ? "metric-watch" : ""}
        />
      </div>

      <div className="financial-feature-grid">
        <article className="financial-feature-card">
          <div className="financial-card-heading">
            <div><div className="panel-kicker">FINANCIAL LEAK DETECTION</div><h3>Small, repeated outflows</h3></div>
            <TrendingDown size={15} className="muted-icon" />
          </div>
          {leaks.status === "ready" ? (
            <>
              <p className="financial-card-note">
                {leaks.smallPaymentCount} lower-value transactions total {formatCurrency(leaks.smallPaymentTotal, currency, true)}.
                {leaks.smallPaymentThreshold !== null && <> “Lower-value” means at or below {formatCurrency(leaks.smallPaymentThreshold, currency, true)}, the bottom quarter of {leaks.expenseCount} recorded expenses in this period.</>}
              </p>
              {leaks.repeatedPayees.length ? (
                <div className="financial-list">
                  {leaks.repeatedPayees.slice(0, 3).map((item) => (
                    <button key={item.key} className="financial-list-row" onClick={() => onSearch(item.name)} title="Show matching transactions">
                      <span><strong>{item.name}</strong><small>{item.count} lower-value payments · {item.categories.join(", ")}</small></span>
                      <strong>{formatCurrency(item.amount, currency, true)}</strong>
                    </button>
                  ))}
                </div>
              ) : <div className="financial-empty">No payee has 3 or more lower-value payments in this period.</div>}
            </>
          ) : (
            <div className="financial-empty">At least 8 dated expenses are needed to set a personal lower-value baseline.</div>
          )}
          {leaks.recurringPayments.length > 0 && (
            <>
              <div className="financial-subheading"><Repeat size={13} /> Steady payments · {formatCurrency(leaks.recurringMonthlyTotal, currency, true)} monthly equivalent</div>
              <div className="financial-list">
                {leaks.recurringPayments.slice(0, 3).map((item) => (
                  <button key={item.key} className="financial-list-row" onClick={() => onSearch(item.name)} title="Show matching transactions">
                    <span><strong>{item.name}</strong><small>{item.cadence} · {item.occurrences} payments · last {formatDate(item.lastDate)}</small></span>
                    <strong>{formatCurrency(item.monthlyCost, currency, true)}<small> / month</small></strong>
                  </button>
                ))}
              </div>
              <p className="financial-card-note">Recurring is a pattern match from timing and similar amounts, not confirmation of a subscription or an unwanted charge.</p>
            </>
          )}
        </article>

        <article className="financial-feature-card">
          <div className="financial-card-heading">
            <div><div className="panel-kicker">BUDGET DEVIATION DETECTION</div><h3>{formatMonth(budget.month)} budget pace</h3></div>
            <Target size={15} className="muted-icon" />
          </div>
          {budget.deviations.length ? (
            <div className="financial-list">
              {budget.deviations.slice(0, 5).map((item) => (
                <div key={item.category} className={`financial-list-row financial-budget-row ${item.status === "over" ? "financial-row-attention" : ""}`}>
                  <span>
                    <strong>{item.category}</strong>
                    <small>{item.explanation}</small>
                    <i className="financial-budget-track" aria-hidden="true"><i style={{ width: `${Math.min(item.progress, 1) * 100}%` }} /></i>
                  </span>
                  <strong>{formatCurrency(item.spent, currency, true)}<small> of {formatCurrency(item.limit, currency, true)}</small></strong>
                </div>
              ))}
            </div>
          ) : budget.budgetsChecked ? (
            <div className="financial-empty"><Wallet size={14} /> No budget is near its limit or projected to exceed it for this month.</div>
          ) : (
            <div className="financial-empty"><Target size={14} /> Add category budgets to see actual and projected deviations here.</div>
          )}
          <p className="financial-card-note">A pace warning is a simple month-to-date extrapolation; it is not a prediction of future bills.</p>
        </article>

        <article className="financial-feature-card">
          <div className="financial-card-heading">
            <div><div className="panel-kicker">EXPLAINABLE FINANCIAL INSIGHTS</div><h3>Why something was flagged</h3></div>
            <Lightbulb size={15} className="muted-icon" />
          </div>
          {analysis.insights.length ? (
            <div className="financial-insight-list">
              {analysis.insights.slice(0, 4).map((insight) => (
                <div key={insight.id} className={`financial-insight financial-insight-${insight.severity}`}>
                  <div><strong>{insight.title}</strong><p>{insight.summary}</p></div>
                  <ul>{insight.evidence.map((fact) => <li key={fact}>{fact}</li>)}</ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="financial-empty"><AlertTriangle size={14} /> No rule-based flags for this period. A missing flag does not mean every transaction has been verified.</div>
          )}
        </article>

        <article className="financial-feature-card">
          <div className="financial-card-heading">
            <div><div className="panel-kicker">INCOME SOURCE CLASSIFICATION</div><h3>Where recorded income came from</h3></div>
            <Banknote size={15} className="muted-icon" />
          </div>
          {incomeSources.groups.length ? (
            <>
              <p className="financial-card-note">
                {formatCurrency(incomeSources.total, currency, true)} across {incomeSources.count} income record{incomeSources.count === 1 ? "" : "s"}.
                Labels use statement wording and categories; they are estimates, not verified sources.
              </p>
              <div className="financial-type-chips">
                {incomeSources.byType.slice(0, 4).map((item) => (
                  <span key={item.type}>{incomeSourceLabels[item.type]} · {item.share.toFixed(1)}%</span>
                ))}
              </div>
              <div className="financial-list">
                {incomeSources.groups.slice(0, 5).map((item) => (
                  <button key={item.key} className="financial-list-row" onClick={() => onSearch(item.name)} title="Show matching transactions">
                    <span><strong>{item.name}</strong><small>{item.typeLabel} · {item.count} record{item.count === 1 ? "" : "s"} · {item.confidence} confidence</small></span>
                    <strong>{formatCurrency(item.amount, currency, true)}<small> · {item.share.toFixed(1)}%</small></strong>
                  </button>
                ))}
              </div>
              {incomeSources.excludedOwnAccountCandidates > 0 && (
                <p className="financial-card-note">{incomeSources.excludedOwnAccountCandidates} possible own-account transfer{incomeSources.excludedOwnAccountCandidates === 1 ? " was" : "s were"} left out of this source breakdown.</p>
              )}
            </>
          ) : (
            <div className="financial-empty"><Banknote size={14} /> No external income records are available in this period.</div>
          )}
        </article>
      </div>
    </section>
  );
}
