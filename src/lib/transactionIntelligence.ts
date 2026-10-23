import type { Category, CategoryRule, Transaction } from "../types.ts";
import { categorise, isWalletProductMovement, recogniseTransactionParty, ruleMatches, similarityKey } from "./categorise.ts";

export interface TransactionClassification {
  category: Category;
  confidence: number;
  source: "manual" | "personal-rule" | "transfer" | "heuristic" | "fallback";
}

/** Classifies locally and reports when a bank narration needs a human category check. */
export function classifyTransaction(transaction: Transaction, rules: CategoryRule[] = []): TransactionClassification {
  if (transaction.manual || transaction.categoryLocked) {
    return { category: transaction.category, confidence: 1, source: "manual" };
  }
  const matchingRule = [...rules].reverse().find((rule) => ruleMatches(rule, transaction));
  if (matchingRule) return { category: matchingRule.category, confidence: 0.98, source: "personal-rule" };
  if (transaction.internalTransfer || transaction.ownAccountCandidate || isWalletProductMovement(transaction.description)) {
    return { category: "Transfers", confidence: 0.98, source: "transfer" };
  }
  const category = categorise(transaction.description, transaction.direction);
  if (category === "Other") return { category, confidence: 0.25, source: "fallback" };
  if (category === "Income" || category === "Transfers") return { category, confidence: 0.62, source: "fallback" };
  return { category, confidence: 0.86, source: "heuristic" };
}

/** Counts transactions with the same recognised party or normalized narration, without treating them as duplicates. */
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
