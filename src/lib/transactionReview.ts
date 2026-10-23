import type { CategoryRule, Direction, RecipientProfile, Transaction } from "../types.ts";
import { applyCategoryRules, isWalletProductMovement } from "./categorise.ts";
import { classifyTransaction, type ClassificationHistory, type TransactionClassification } from "./transactionIntelligence.ts";
import { resolveTransactionParty } from "./recipientProfiles.ts";

export interface ClassificationReviewCandidate {
  transaction: Transaction;
  classification: TransactionClassification;
}

/** Items with a weak or materially different automatic suggestion, excluding user-locked rows. */
export function getClassificationReviewQueue(
  transactions: Transaction[],
  rules: CategoryRule[] = [],
  history?: ClassificationHistory,
  profiles: RecipientProfile[] = [],
): ClassificationReviewCandidate[] {
  return transactions.flatMap((transaction) => {
    if (transaction.manual || transaction.categoryLocked) return [];
    const classification = classifyTransaction(transaction, rules, history, profiles);
    const differs = classification.category !== transaction.category;
    const weak = classification.confidence < 0.6;
    if ((!differs && !weak) || classification.source === "custom-rule") return [];
    if (differs && classification.confidence >= 0.95) return [];
    return [{ transaction, classification }];
  }).sort((a, b) =>
    a.classification.confidence - b.classification.confidence ||
    b.transaction.date.localeCompare(a.transaction.date));
}

export interface HistoricalReclassificationResult {
  transactions: Transaction[];
  changed: number;
  eligible: number;
}

/** Reclassify unlocked history in an inclusive date window, leaving manual choices untouched. */
export function reclassifyHistoricalTransactions(
  transactions: Transaction[],
  rules: CategoryRule[],
  history: ClassificationHistory,
  range: { start?: string; end?: string } = {},
  profiles: RecipientProfile[] = [],
): HistoricalReclassificationResult {
  let changed = 0;
  let eligible = 0;
  const updated = transactions.map((transaction) => {
    if (transaction.manual || transaction.categoryLocked) return transaction;
    if (range.start && transaction.date < range.start) return transaction;
    if (range.end && transaction.date > range.end) return transaction;
    eligible += 1;

    const classification = classifyTransaction(transaction, rules, history, profiles);
    const ruleEffects = applyCategoryRules([transaction], rules)[0];
    const next: Transaction = {
      ...transaction,
      category: classification.category,
    };
    if (isWalletProductMovement(transaction.description)) {
      next.internalTransfer = true;
      next.ownAccountCandidate = false;
    } else if (ruleEffects.internalTransfer) {
      next.internalTransfer = true;
      next.ownAccountCandidate = false;
    }
    if (
      transaction.category !== next.category ||
      Boolean(transaction.internalTransfer) !== Boolean(next.internalTransfer) ||
      Boolean(transaction.ownAccountCandidate) !== Boolean(next.ownAccountCandidate)
    ) changed += 1;
    return next;
  });
  return { transactions: updated, changed, eligible };
}

export interface RecurringRecipient {
  key: string;
  name: string;
  direction: Direction;
  count: number;
  frequencyDays: number;
  frequencyLabel: string;
  averageAmount: number;
  lastDate: string;
  nextExpectedDate: string;
  transactionIds: string[];
}

function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  const day = Math.floor(timestamp / 86_400_000);
  return dateFromDayNumber(day) === date ? day : null;
}

function dateFromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function frequencyLabel(days: number): string {
  if (days >= 6 && days <= 8) return "Weekly";
  if (days >= 12 && days <= 16) return "Every 2 weeks";
  if (days >= 25 && days <= 35) return "Monthly";
  if (days >= 53 && days <= 68) return "Every 2 months";
  return `About every ${days} days`;
}

/** Detect a transfer recipient with at least three dates on a reasonably steady cadence. */
export function detectRecurringRecipients(transactions: Transaction[], profiles: RecipientProfile[] = []): RecurringRecipient[] {
  const groups = new Map<string, { name: string; direction: Direction; transactions: Transaction[] }>();
  for (const transaction of transactions) {
    if (transaction.internalTransfer || transaction.ownAccountCandidate) continue;
    const party = resolveTransactionParty(transaction.description, profiles);
    if (!party || party.kind !== "recipient") continue;
    const key = `${transaction.direction}:recipient:${party.key}`;
    const group = groups.get(key) ?? { name: party.name, direction: transaction.direction, transactions: [] };
    group.transactions.push(transaction);
    groups.set(key, group);
  }

  const recurring: RecurringRecipient[] = [];
  for (const [key, group] of groups) {
    const datedTransactions = group.transactions
      .map((transaction) => ({ transaction, day: dayNumber(transaction.date) }))
      .filter((item): item is { transaction: Transaction; day: number } => item.day !== null);
    const dates = [...new Map(datedTransactions.map((item) => [item.transaction.date, item.day])).entries()]
      .map(([date, day]) => ({ date, day }))
      .sort((a, b) => a.day - b.day);
    if (dates.length < 3) continue;

    const gaps = dates.slice(1).map((item, index) => item.day - dates[index].day);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const middle = Math.floor(sortedGaps.length / 2);
    const median = sortedGaps.length % 2
      ? sortedGaps[middle]
      : (sortedGaps[middle - 1] + sortedGaps[middle]) / 2;
    if (median < 6 || median > 95) continue;
    const tolerance = Math.max(3, Math.ceil(median * 0.25));
    const regularGaps = gaps.filter((gap) => Math.abs(gap - median) <= tolerance).length;
    if (regularGaps / gaps.length < 0.75) continue;

    const validTransactions = datedTransactions.map((item) => item.transaction);
    const transactionIds = validTransactions.map((transaction) => transaction.id);
    const last = dates.at(-1)!;
    recurring.push({
      key,
      name: group.name,
      direction: group.direction,
      count: validTransactions.length,
      frequencyDays: Math.round(median),
      frequencyLabel: frequencyLabel(Math.round(median)),
      averageAmount: validTransactions.reduce((sum, transaction) => sum + transaction.amount, 0) / validTransactions.length,
      lastDate: last.date,
      nextExpectedDate: dateFromDayNumber(last.day + Math.round(median)),
      transactionIds,
    });
  }
  return recurring.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
