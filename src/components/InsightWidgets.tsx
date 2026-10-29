import type * as React from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import type { getTransferInsights } from "../lib/transactionPatterns";
import { formatCurrency } from "../lib/format";
import type { calculateTotals, getCategoryTotals } from "../lib/insights";
import type { Transaction } from "../types";

export function TransferReviewPanel({
  insights,
  currency,
  pendingCount,
  onReview,
  onConfirmAll,
}: {
  insights: ReturnType<typeof getTransferInsights>;
  currency: string;
  pendingCount: number;
  onReview: () => void;
  onConfirmAll: () => void;
}) {
  return (
    <section className="panel transfer-review-panel">
      <div className="panel-heading">
        <div><div className="panel-kicker">TRANSFER REVIEW</div><h2>Own-account and repeat transfers</h2></div>
        <span className="review-banner-actions">
          <button className="button button-secondary" onClick={onReview} disabled={pendingCount === 0}>Review one by one</button>
          <button className="button button-primary" onClick={onConfirmAll} disabled={pendingCount === 0}>Exclude all {pendingCount ? pendingCount.toLocaleString("en-NG") : ""}</button>
        </span>
      </div>
      <div className="transfer-review-summary">
        <div>
          <strong>{insights.ownAccountCandidateCount.toLocaleString("en-NG")}</strong>
          <span>unconfirmed own-account candidates in this period · {formatCurrency(insights.ownAccountSent, currency)} sent · {formatCurrency(insights.ownAccountReceived, currency)} received</span>
        </div>
        <div>
          <strong>{insights.confirmedInternalCount.toLocaleString("en-NG")}</strong>
          <span>entries excluded from totals (wallet ↔ savings pots and confirmed own transfers)</span>
        </div>
      </div>
      <p className="transfer-review-note">Candidates are transfers to or from your own name, your own account number, or your own bank card. They stay in your totals until you confirm them. Repeated counterparties below are grouped by name only.</p>
      {insights.repeatedCounterparties.length > 0 ? (
        <div className="counterparty-list">
          <div className="counterparty-list-heading"><span>REPEATED COUNTERPARTY</span><span>COUNT</span><span>SENT</span><span>RECEIVED</span></div>
          {insights.repeatedCounterparties.map((counterparty) => (
            <div className="counterparty-list-row" key={counterparty.name}>
              <strong title={counterparty.name}>{counterparty.name}</strong>
              <span>{counterparty.count}</span>
              <span>{formatCurrency(counterparty.sent, currency, true)}</span>
              <span>{formatCurrency(counterparty.received, currency, true)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="counterparty-empty">No transfer counterparty appears three or more times in this period.</div>
      )}
    </section>
  );
}

export function InsightsPanel({
  count,
  topCategory,
  biggest,
  fees,
  totals,
  currency,
  onOpen,
}: {
  count: number;
  topCategory: ReturnType<typeof getCategoryTotals>[number] | undefined;
  biggest: Transaction | undefined;
  fees: number;
  totals: ReturnType<typeof calculateTotals>;
  currency: string;
  onOpen: () => void;
}) {
  return (
    <section className="insights-panel">
      <div className="insight-title"><span className="insight-sparkle"><Sparkles size={16} /></span><div><div className="panel-kicker">A CLOSER LOOK</div><h2>Your key takeaways</h2></div></div>
      <div className="insight-highlight">
        <span className="insight-number">01</span><div><span className="takeaway-label">TOP SPENDING AREA</span><strong>{topCategory?.category ?? "Not enough data yet"}</strong><p>{topCategory ? `${formatCurrency(topCategory.amount, currency)} across ${topCategory.count.toLocaleString("en-NG")} transactions` : "Import transactions to see what stands out."}</p></div>
      </div>
      <div className="insight-highlight">
        <span className="insight-number">02</span><div><span className="takeaway-label">LARGEST SINGLE PAYMENT</span><strong>{biggest ? formatCurrency(biggest.amount, currency) : "No outgoing yet"}</strong><p>{biggest ? biggest.description : "Your largest payment will appear here."}</p></div>
      </div>
      <div className="insight-highlight">
        <span className="insight-number">03</span><div><span className="takeaway-label">FEES & CHARGES</span><strong>{formatCurrency(fees, currency)}</strong><p>{totals.income > 0 ? `Savings rate this period: ${Math.round(totals.savingsRate)}%` : "Bank charges, levies, and stamp duty paid"}</p></div>
      </div>
      <div className="insight-foot"><span>{count.toLocaleString("en-NG")} transaction{count === 1 ? "" : "s"} analysed</span><button className="subtle-link" onClick={onOpen}>Explore insights <ArrowUpRight size={14} /></button></div>
    </section>
  );
}

export function InsightDetail({ icon, title, value, detail, tone }: { icon: React.ReactNode; title: string; value: string; detail: string; tone: string }) {
  return <div className="insight-detail-card"><span className={`insight-detail-icon ${tone}`}>{icon}</span><div className="insight-detail-copy"><span>{title}</span><strong>{value}</strong><p>{detail}</p></div></div>;
}

export function summarySentence(
  totals: ReturnType<typeof calculateTotals>,
  topCategory: ReturnType<typeof getCategoryTotals>[number] | undefined,
  currency: string,
): string {
  if (totals.transactionCount === 0) return "No transactions in this period yet. Pick another period or import a statement.";
  if (totals.income === 0) return `You’ve recorded ${formatCurrency(totals.expenses, currency)} in outgoing payments. Add income transactions for a complete cash-flow picture.`;
  const rate = Math.round(totals.savingsRate);
  const start = rate >= 0
    ? `You kept ${rate}% of the ${formatCurrency(totals.income, currency)} that came in`
    : `You spent ${formatCurrency(totals.expenses - totals.income, currency)} more than came in`;
  return `${start}${topCategory ? `, and ${topCategory.category.toLowerCase()} was your largest spending area at ${formatCurrency(topCategory.amount, currency)}.` : "."}`;
}