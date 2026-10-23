import type { Category, CategoryRule, Transaction } from "../types.ts";
import { applyCategoryRules, categorise, isWalletProductMovement, recogniseTransactionParty, ruleMatches, similarityKey } from "./categorise.ts";

export interface TransactionClassification {
  category: Category;
  /** An evidence-based score from 0 to 1, not a calibrated probability. */
  confidence: number;
  source: "manual" | "custom-rule" | "merchant-history" | "conflicting-history" | "transfer" | "heuristic" | "fallback";
  reason: string;
}

export interface ClassificationHistoryEntry {
  votes: ReadonlyMap<Category, number>;
  rejectedCategories: ReadonlySet<Category>;
}

export type ClassificationHistory = ReadonlyMap<string, ClassificationHistoryEntry>;

function classificationIdentity(transaction: Pick<Transaction, "description" | "direction">): string | null {
  const party = recogniseTransactionParty(transaction.description);
  const identity = party ? party.kind + ":" + party.key : "description:" + similarityKey(transaction.description);
  return identity === "description:" ? null : transaction.direction + ":" + identity;
}

/** Build a local feedback index from categories the user deliberately chose. */
export function buildClassificationHistory(transactions: Transaction[]): Map<string, ClassificationHistoryEntry> {
  const history = new Map<string, { votes: Map<Category, number>; rejectedCategories: Set<Category> }>();
  for (const transaction of transactions) {
    const key = classificationIdentity(transaction);
    if (!key) continue;
    const entry = history.get(key) ?? { votes: new Map<Category, number>(), rejectedCategories: new Set<Category>() };
    if (transaction.categoryLocked || transaction.manual) {
      entry.votes.set(transaction.category, (entry.votes.get(transaction.category) ?? 0) + 1);
    }
    if (transaction.rejectedSuggestion) entry.rejectedCategories.add(transaction.rejectedSuggestion);
    if (entry.votes.size || entry.rejectedCategories.size) history.set(key, entry);
  }
  return history;
}

/** Score a category using user choices, custom rules, known patterns, and explicit uncertainty. */
export function classifyTransaction(
  transaction: Transaction,
  rules: CategoryRule[] = [],
  history?: ClassificationHistory,
): TransactionClassification {
  if (transaction.manual || transaction.categoryLocked) {
    return { category: transaction.category, confidence: 1, source: "manual", reason: "You selected this category; it is locked from automatic changes." };
  }
  const matchingRule = [...rules].reverse().find((rule) => ruleMatches(rule, transaction));
  if (matchingRule) {
    const type = matchingRule.matchType ?? "contains";
    return {
      category: matchingRule.category,
      confidence: 0.99,
      source: "custom-rule",
      reason: "Custom " + type + " rule matched “" + matchingRule.pattern + "”.",
    };
  }
  if (transaction.internalTransfer || transaction.ownAccountCandidate || isWalletProductMovement(transaction.description)) {
    return { category: "Transfers", confidence: 0.98, source: "transfer", reason: "The narration matches an internal or own-account transfer pattern." };
  }

  const historyEntry = history?.get(classificationIdentity(transaction) ?? "");
  const votes = historyEntry?.votes;
  if (historyEntry && votes?.size) {
    let total = 0;
    let winningCategory: Category | undefined;
    let winningCount = 0;
    for (const [category, count] of votes) {
      total += count;
      if (count > winningCount) {
        winningCategory = category;
        winningCount = count;
      }
    }
    if (winningCategory && historyEntry.rejectedCategories.size && !historyEntry.rejectedCategories.has(winningCategory) && winningCount / total >= 0.67) {
      const rejected = [...historyEntry.rejectedCategories].join(", ");
      return {
        category: winningCategory,
        confidence: Math.min(0.96, 0.84 + 0.12 * (winningCount / total)),
        source: "merchant-history",
        reason: `You kept ${winningCategory} and rejected ${rejected} for this payee; future matches use that correction.`,
      };
    }
    if (total >= 2 && winningCategory && !historyEntry.rejectedCategories.has(winningCategory)) {
      const agreement = winningCount / total;
      if (agreement >= 0.67) {
        const support = Math.min(1, Math.log2(total + 1) / 2);
        const confidence = Math.min(0.99, 0.7 + 0.29 * agreement * support);
        return {
          category: winningCategory,
          confidence,
          source: "merchant-history",
          reason: winningCount + " of " + total + " previous hand-categorized transactions for this payee agree.",
        };
      }
      const fallback = categorise(transaction.description, transaction.direction);
      return {
        category: historyEntry.rejectedCategories.has(fallback)
          ? winningNonRejectedCategory(historyEntry) ?? transaction.category
          : fallback,
        confidence: 0.52,
        source: "conflicting-history",
        reason: "Previous hand-categorized transactions for this payee disagree; review the category.",
      };
    }
  }

  const category = categorise(transaction.description, transaction.direction);
  if (historyEntry?.rejectedCategories.has(category)) {
    return {
      category: winningNonRejectedCategory(historyEntry) ?? transaction.category,
      confidence: 0.35,
      source: "conflicting-history",
      reason: `A previous suggestion of ${category} was rejected for this payee, so it will not be suggested again without stronger evidence.`,
    };
  }
  if (category === "Other") {
    return { category, confidence: 0.25, source: "fallback", reason: "No custom rule, reliable history, or specific category signal matched." };
  }
  if (category === "Income" || category === "Transfers") {
    return { category, confidence: 0.62, source: "fallback", reason: "The category is based on a broad direction or transfer fallback." };
  }
  return { category, confidence: 0.86, source: "heuristic", reason: "A built-in transaction keyword pattern matched." };
}

function winningNonRejectedCategory(entry: ClassificationHistoryEntry): Category | undefined {
  let best: Category | undefined;
  let count = 0;
  for (const [category, votes] of entry.votes) {
    if (!entry.rejectedCategories.has(category) && votes > count) {
      best = category;
      count = votes;
    }
  }
  return best;
}

/** Apply matching rules and high-agreement user feedback to imported, unlocked transactions. */
export function classifyTransactions(
  transactions: Transaction[],
  rules: CategoryRule[] = [],
  history?: ClassificationHistory,
): Transaction[] {
  return applyCategoryRules(transactions, rules).map((transaction) => {
    if (transaction.manual || transaction.categoryLocked) return transaction;
    const classification = classifyTransaction(transaction, rules, history);
    return classification.category === transaction.category ? transaction : { ...transaction, category: classification.category };
  });
}

/** Counts transactions with the same recognized party or normalized narration, without treating them as duplicates. */
export function getSimilarTransactionCounts(transactions: Transaction[]): Map<string, number> {
  const identityFor = (transaction: Transaction): string => {
    const party = recogniseTransactionParty(transaction.description);
    const identity = party ? party.kind + ":" + party.key : "description:" + similarityKey(transaction.description);
    return transaction.direction + ":" + identity;
  };
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    const identity = identityFor(transaction);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return new Map(transactions.map((transaction) => [transaction.id, counts.get(identityFor(transaction)) ?? 1]));
}
