import { ArrowDownLeft, ArrowUpRight, CalendarClock, Check, CircleHelp, RotateCcw, X } from "lucide-react";
import type { Category } from "./types";
import { formatCurrency, formatDate } from "./lib/format";
import type { ClassificationReviewCandidate, RecurringRecipient } from "./lib/transactionReview";

interface ClassificationReviewPageProps {
  candidates: ClassificationReviewCandidate[];
  recurringRecipients: RecurringRecipient[];
  currency: string;
  onAcceptSuggestion: (transactionId: string) => void;
  onRejectSuggestion: (transactionId: string) => void;
  onConfirmCurrent: (transactionId: string) => void;
  onOpenRecipient: (name: string) => void;
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}

function categoryClass(category: Category): string {
  return `category-${category.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

export default function ClassificationReviewPage({
  candidates,
  recurringRecipients,
  currency,
  onAcceptSuggestion,
  onRejectSuggestion,
  onConfirmCurrent,
  onOpenRecipient,
}: ClassificationReviewPageProps) {
  return (
    <section className="classification-review-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> KEEPING CATEGORIES ACCURATE</div>
          <h1>Classification review</h1>
          <p className="page-subtitle">Check uncertain categories, teach the app which suggestions to stop repeating, and spot regular transfers to the same recipient.</p>
        </div>
      </div>

      <section className="panel review-queue-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">SUGGESTIONS TO REVIEW</div><h2>Review queue <span className="heading-count">{candidates.length.toLocaleString("en-NG")}</span></h2></div>
          <span className="heading-note"><CircleHelp size={14} /> Your choices stay in this browser</span>
        </div>
        {candidates.length ? (
          <div className="review-queue-list">
            {candidates.map(({ transaction, classification }) => {
              const differs = classification.category !== transaction.category;
              const confidenceTone = classification.confidence >= 0.85 ? "high" : classification.confidence >= 0.6 ? "medium" : "low";
              const isIncome = transaction.direction === "income";
              return (
                <article className="review-queue-item" key={transaction.id}>
                  <div className="review-queue-item-main">
                    <div className={`transaction-icon ${isIncome ? "transaction-icon-income" : ""}`}>
                      {isIncome ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                    </div>
                    <div className="review-queue-item-copy">
                      <strong title={transaction.description}>{transaction.description}</strong>
                      <span>{formatDate(transaction.date)} · {transaction.source} · {formatCurrency(transaction.amount, currency)}</span>
                      <span className="review-queue-reason">{classification.reason}</span>
                    </div>
                  </div>
                  <div className="review-queue-category">
                    <span className={`category-pill ${categoryClass(transaction.category)}`}>Current · {transaction.category}</span>
                    <span className="review-queue-arrow" aria-hidden="true">→</span>
                    <span className={`category-pill ${categoryClass(classification.category)}`}>{differs ? "Suggest · " : "Check · "}{classification.category}</span>
                    <span className={`classification-confidence classification-confidence--${confidenceTone}`}>{confidenceLabel(classification.confidence)}</span>
                  </div>
                  <div className="review-queue-actions">
                    {differs ? (
                      <>
                        <button className="button button-secondary" onClick={() => onRejectSuggestion(transaction.id)}><X size={14} /> Reject suggestion</button>
                        <button className="button button-primary" onClick={() => onAcceptSuggestion(transaction.id)}><Check size={14} /> Accept suggestion</button>
                      </>
                    ) : (
                      <button className="button button-primary" onClick={() => onConfirmCurrent(transaction.id)}><Check size={14} /> Confirm {transaction.category}</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="review-queue-empty">
            <div className="review-queue-empty-icon"><Check size={18} /></div>
            <strong>Nothing needs a category decision.</strong>
            <span>New low-confidence or conflicting suggestions will appear here.</span>
          </div>
        )}
      </section>

      <section className="panel recurring-recipient-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">REPEATED TRANSFERS</div><h2>Recurring recipients <span className="heading-count">{recurringRecipients.length.toLocaleString("en-NG")}</span></h2></div>
          <span className="heading-note"><CalendarClock size={14} /> Detected from transaction dates</span>
        </div>
        <p className="panel-note">A recipient appears here after at least three transfers on a reasonably regular schedule. These are estimates from your local history, not scheduled payments.</p>
        {recurringRecipients.length ? (
          <div className="recurring-recipient-list">
            {recurringRecipients.map((recipient) => (
              <div className="recurring-recipient-row" key={recipient.key}>
                <div className="recurring-recipient-name">
                  <strong>{recipient.name}</strong>
                  <span>{recipient.frequencyLabel} · {recipient.count} transfers · {recipient.direction === "expense" ? "Money out" : "Money in"}</span>
                </div>
                <div><span>Average transfer</span><strong>{formatCurrency(recipient.averageAmount, currency)}</strong></div>
                <div><span>Last seen</span><strong>{formatDate(recipient.lastDate)}</strong></div>
                <div><span>Next expected</span><strong>{formatDate(recipient.nextExpectedDate)}</strong></div>
                <button className="button button-text recurring-recipient-open" onClick={() => onOpenRecipient(recipient.name)}><RotateCcw size={13} /> View history</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="counterparty-empty">No regular recipients found yet. Three or more transfers on a steady schedule are needed.</div>
        )}
      </section>
    </section>
  );
}
