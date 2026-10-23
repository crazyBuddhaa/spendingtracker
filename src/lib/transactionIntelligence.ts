import type { Category, CategoryRule, Transaction } from "../types.ts";
import { applyCategoryRules, categorise, isWalletProductMovement, recogniseTransactionParty, ruleMatches, similarityKey } from "./categorise.ts";

export interface TransactionClassification {
  category: Category;
  /** An evidence-based score from 0 to 1, not a calibrated probability. */
  confidence: number;
  source: "manual" | "custom-rule" | "merchant-history" | "conflicting-history" | "transfer" | "heuristic" | "fallback";
  reason: string;
}

export type ClassificationHistory = ReadonlyMap<string, ReadonlyMap<Category, number>>;

function classificationIdentity(transaction: Pick<Transaction, "description" | "direction">): string | null {
  const party = recogniseTransactionParty(transaction.description);
  const identity = party ? party.kind + ":" + party.key : "description:" + similarityKey(transaction.description);
  return identity === "description:" ? null : transaction.direction + ":" + identity;
}

/** Build a local feedback index from categories the user deliberately chose. */
export function buildClassificationHistory(transactions: Transaction[]): Map<string, Map<Category, number>> {
  const history = new Map<string, Map<Category, number>>();
  for (const transaction of transactions) {
    if (!transaction.categoryLocked && !transaction.manual) continue;
    const key = classificationIdentity(transaction);
    if (!key) continue;
    const votes = history.get(key) ?? new Map<Category, number>();
    votes.set(transaction.category, (votes.get(transaction.category) ?? 0) + 1);
    history.set(key, votes);
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

  const votes = history?.get(classificationIdentity(transaction) ?? "");
  if (votes) {
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
    if (total >= 2 && winningCategory) {
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
      return {
        category: categorise(transaction.description, transaction.direction),
        confidence: 0.52,
        source: "conflicting-history",
        reason: "Previous hand-categorized transactions for this payee disagree; review the category.",
      };
    }
  }

  const category = categorise(transaction.description, transaction.direction);
  if (category === "Other") {
    return { category, confidence: 0.25, source: "fallback", reason: "No custom rule, reliable history, or specific category signal matched." };
  }
  if (category === "Income" || category === "Transfers") {
    return { category, confidence: 0.62, source: "fallback", reason: "The category is based on a broad direction or transfer fallback." };
  }
  return { category, confidence: 0.86, source: "heuristic", reason: "A built-in transaction keyword pattern matched." };
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
