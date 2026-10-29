import { ArrowDownLeft, ArrowLeftRight, FileText, Receipt, Trash2 } from "lucide-react";
import { classifyTransaction, type ClassificationHistory } from "../lib/transactionIntelligence";
import { resolveTransactionParty } from "../lib/recipientProfiles";
import { formatDate } from "../lib/format";
import { initialLetter } from "../app/constants";
import { categoryList, type Category, type CategoryRule, type RecipientProfile, type Transaction } from "../types";

export function TransactionTable({
  transactions,
  currency,
  showSource = false,
  onChangeCategory,
  onToggleInternal,
  onDelete,
  similarCounts,
  rules = [],
  classificationHistory,
  recipientProfiles = [],
  recurringTransactionIds,
  selectedTransactionIds,
  onToggleSelection,
  onSelectDisplayed,
}: {
  transactions: Transaction[];
  currency: string;
  showSource?: boolean;
  onChangeCategory?: (transactionId: string, category: Category) => void;
  onToggleInternal?: (transactionId: string) => void;
  onDelete?: (transactionId: string) => void;
  similarCounts?: ReadonlyMap<string, number>;
  rules?: CategoryRule[];
  classificationHistory?: ClassificationHistory;
  recipientProfiles?: RecipientProfile[];
  recurringTransactionIds?: ReadonlySet<string>;
  selectedTransactionIds?: ReadonlySet<string>;
  onToggleSelection?: (transactionId: string) => void;
  onSelectDisplayed?: (transactions: Transaction[], selected: boolean) => void;
}) {
  const editable = Boolean(onChangeCategory || onToggleInternal || onDelete);
  const selectable = Boolean(onToggleSelection && selectedTransactionIds && onSelectDisplayed);
  const selectedCount = selectable ? transactions.filter((transaction) => selectedTransactionIds!.has(transaction.id)).length : 0;
  const allSelected = transactions.length > 0 && selectedCount === transactions.length;
  const partiallySelected = selectedCount > 0 && !allSelected;
  return (
    <div className="transaction-table-wrap">
      <table className="transaction-table">
        <thead><tr>
          {selectable && <th className="transaction-select-heading"><input type="checkbox" checked={allSelected} ref={(element) => { if (element) element.indeterminate = partiallySelected; }} onChange={(event) => onSelectDisplayed?.(transactions, event.target.checked)} aria-label="Select all displayed transactions" /></th>}
          <th>TRANSACTION</th><th>DATE</th>{showSource && <th>ACCOUNT</th>}<th>CATEGORY</th><th className="amount-heading">AMOUNT</th>{editable && <th aria-label="Actions" />}
        </tr></thead>
        <tbody>
          {transactions.map((transaction) => {
            const isIncome = transaction.direction === "income";
            const party = resolveTransactionParty(transaction.description, recipientProfiles);
            const classification = classifyTransaction(transaction, rules, classificationHistory, recipientProfiles);
            const confidenceTone = classification.confidence >= 0.85 ? "high" : classification.confidence >= 0.6 ? "medium" : "low";
            const suggestsDifferentCategory = classification.category !== transaction.category && !transaction.categoryLocked && !transaction.manual;
            const similarCount = Math.max(0, (similarCounts?.get(transaction.id) ?? 0) - 1);
            return (
              <tr key={transaction.id} className={transaction.internalTransfer ? "row-internal" : undefined}>
                {selectable && <td className="transaction-select-cell"><input type="checkbox" checked={selectedTransactionIds!.has(transaction.id)} onChange={() => onToggleSelection?.(transaction.id)} aria-label={`Select ${transaction.description}`} /></td>}
                <td>
                  <div className="transaction-name-cell">
                    <div className={`transaction-icon ${isIncome ? "transaction-icon-income" : ""}`}>
                      {isIncome ? <ArrowDownLeft size={16} /> : transaction.category === "Transfers" ? <ArrowLeftRight size={15} /> : transaction.category === "Bank fees" ? <Receipt size={15} /> : <FileText size={15} />}
                    </div>
                    <div className="transaction-name-copy">
                      <strong title={transaction.description}>{transaction.description}</strong>
                      <span>{transaction.source}{transaction.manual ? " · added by you" : ""}{transaction.note ? ` · ${transaction.note}` : ""}</span>
                      {party && <span className="transaction-intelligence-label">{party.kind === "merchant" ? "Merchant" : party.kind === "recipient" ? "Recipient" : "Sender"} · {party.name}</span>}
                      {similarCount > 0 && <span className="transaction-intelligence-label">{similarCount} similar transaction{similarCount === 1 ? "" : "s"}</span>}
                      {suggestsDifferentCategory ? <span className={`classification-confidence classification-confidence--${confidenceTone}`} title={classification.reason} aria-label={"Suggested category " + classification.category + ", confidence " + Math.round(classification.confidence * 100) + " percent. " + classification.reason}>Suggest {classification.category} · {Math.round(classification.confidence * 100)}%</span> : <span className={`classification-confidence classification-confidence--${confidenceTone}`} title={classification.reason} aria-label={"Classification confidence " + Math.round(classification.confidence * 100) + " percent. " + classification.reason}>Confidence {Math.round(classification.confidence * 100)}%</span>}
                      {classification.confidence < 0.5 && <span className="transaction-review-label">Review category</span>}
                      {recurringTransactionIds?.has(transaction.id) && <span className="transaction-intelligence-label">Recurring recipient pattern</span>}
                      {transaction.internalTransfer && <span className="transaction-review-label">Own money moving · excluded from totals</span>}
                      {transaction.ownAccountCandidate && !transaction.internalTransfer && (
                        <span className="transaction-review-row">
                          <span className="transaction-review-label">Possible own-account transfer</span>
                          {onToggleInternal && <button className="transaction-confirm-button" onClick={() => onToggleInternal(transaction.id)}>Mark internal</button>}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="transaction-date">{formatDate(transaction.date)}{transaction.time && <small>{transaction.time.slice(0, 5)}</small>}</td>
                {showSource && <td><span className="account-pill"><span className="account-mini">{initialLetter(transaction.source)}</span>{transaction.source}</span></td>}
                <td>
                  {onChangeCategory ? (
                    <select
                      className={`category-select category-${transaction.category.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                      value={transaction.category}
                      onChange={(event) => onChangeCategory(transaction.id, event.target.value as Category)}
                      aria-label={`Category for ${transaction.description}`}
                    >
                      {categoryList.map((category) => <option key={category}>{category}</option>)}
                    </select>
                  ) : (
                    <span className={`category-pill category-${transaction.category.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{transaction.category}</span>
                  )}
                </td>
                <td className={`transaction-amount ${isIncome ? "amount-income" : ""}`}>{isIncome ? "+" : "−"}{new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: transaction.amount % 1 ? 2 : 0 }).format(transaction.amount)}</td>
                {editable && (
                  <td className="row-actions">
                    {onToggleInternal && (
                      <button className="icon-button" onClick={() => onToggleInternal(transaction.id)} title={transaction.internalTransfer ? "Count in totals again" : "Mark as my own money moving (exclude from totals)"} aria-label={transaction.internalTransfer ? "Include in totals" : "Exclude from totals"}>
                        <ArrowLeftRight size={14} />
                      </button>
                    )}
                    {onDelete && <button className="icon-button" onClick={() => onDelete(transaction.id)} title="Delete transaction" aria-label="Delete transaction"><Trash2 size={14} /></button>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}