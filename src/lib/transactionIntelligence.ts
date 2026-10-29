import type { Category, CategoryRule, RecipientProfile, Transaction } from "../types.ts";
import { applyCategoryRules, categorise, isWalletProductMovement, ruleMatches, similarityKey } from "./categorise.ts";
import { resolveTransactionParty } from "./recipientProfiles.ts";

export interface TransactionClassification {
  category: Category;
  /** An evidence-based score from 0 to 1, not a calibrated probability. */
  confidence: number;
  source: "manual" | "custom-rule" | "recipient-profile" | "merchant-history" | "conflicting-history" | "transfer" | "heuristic" | "fallback";
  reason: string;
}

export interface ClassificationHistoryEntry {
  votes: ReadonlyMap<Category, number>;
  rejectedCategories: ReadonlySet<Category>;
}

export type ClassificationHistory = ReadonlyMap<string, ClassificationHistoryEntry>;

interface PartyIdentity {
  prefix: string;
  kind: "merchant" | "recipient" | "sender";
  name: string;
}

interface PartySimilarityIndex {
  byPrefix: Map<string, Map<string, Set<string>>>;
  identities: Map<string, PartyIdentity>;
}

const historySimilarityIndexes = new WeakMap<ClassificationHistory, PartySimilarityIndex>();
const minimumPartySimilarity = 0.8;
const maximumSimilarityCandidates = 120;

function parsePartyIdentity(identity: string): PartyIdentity | null {
  const match = identity.match(/^(income|expense):(merchant|recipient|sender):(.+)$/);
  if (!match || match[3].startsWith("profile:")) return null;
  return {
    prefix: `${match[1]}:${match[2]}`,
    kind: match[2] as PartyIdentity["kind"],
    name: match[3],
  };
}

function characterBigrams(value: string): Set<string> {
  const compact = value.replace(/[^a-z0-9]/g, "");
  const grams = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(compact.slice(index, index + 2));
  }
  return grams;
}

function bigramSimilarity(left: string, right: string): number {
  const leftGrams = characterBigrams(left);
  const rightGrams = characterBigrams(right);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let shared = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) shared += 1;
  return (2 * shared) / (leftGrams.size + rightGrams.size);
}

/** Conservative name match: typo-tolerant for one-word merchants, token-aware for people. */
function partyNameSimilarity(left: string, right: string, kind: PartyIdentity["kind"]): number {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;

  const compactA = a.replace(/[^a-z0-9]/g, "");
  const compactB = b.replace(/[^a-z0-9]/g, "");
  if (compactA.length >= 6 && compactA === compactB) return 0.98;

  const tokensA = a.split(/\s+/).filter(Boolean);
  const tokensB = b.split(/\s+/).filter(Boolean);
  if (tokensA.length === 1 && tokensB.length === 1) {
    if (kind !== "merchant" || Math.min(compactA.length, compactB.length) < 6) return 0;
    return bigramSimilarity(compactA, compactB);
  }
  if (kind !== "merchant" && tokensA.length !== tokensB.length) return 0;

  const remaining = [...tokensB];
  let matches = 0;
  for (const token of tokensA) {
    const exactIndex = remaining.indexOf(token);
    if (exactIndex >= 0) {
      remaining.splice(exactIndex, 1);
      matches += 1;
      continue;
    }
    if (token.length < 4) continue;
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      if (remaining[index].length < 4) continue;
      const score = bigramSimilarity(token, remaining[index]);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    if (bestIndex >= 0 && bestScore >= minimumPartySimilarity) {
      remaining.splice(bestIndex, 1);
      matches += 1;
    }
  }

  const tokenScore = (2 * matches) / (tokensA.length + tokensB.length);
  return tokenScore >= minimumPartySimilarity ? tokenScore : 0;
}

function createPartySimilarityIndex(identities: Iterable<string>): PartySimilarityIndex {
  const byPrefix = new Map<string, Map<string, Set<string>>>();
  const parsedIdentities = new Map<string, PartyIdentity>();
  for (const identity of identities) {
    const parsed = parsePartyIdentity(identity);
    if (!parsed || parsed.name.replace(/[^a-z0-9]/g, "").length < 6) continue;
    parsedIdentities.set(identity, parsed);
    const prefixIndex = byPrefix.get(parsed.prefix) ?? new Map<string, Set<string>>();
    for (const gram of characterBigrams(parsed.name)) {
      const posting = prefixIndex.get(gram) ?? new Set<string>();
      posting.add(identity);
      prefixIndex.set(gram, posting);
    }
    byPrefix.set(parsed.prefix, prefixIndex);
  }
  return { byPrefix, identities: parsedIdentities };
}

function findSimilarPartyIdentities(
  identity: string,
  index: PartySimilarityIndex,
): Array<{ identity: string; score: number }> {
  const parsed = parsePartyIdentity(identity);
  if (!parsed || parsed.name.replace(/[^a-z0-9]/g, "").length < 6) return [];
  const prefixIndex = index.byPrefix.get(parsed.prefix);
  if (!prefixIndex) return [];

  const candidates = new Set<string>();
  for (const gram of characterBigrams(parsed.name)) {
    const posting = prefixIndex.get(gram);
    if (!posting || posting.size > maximumSimilarityCandidates) continue;
    for (const candidate of posting) {
      if (candidate !== identity) candidates.add(candidate);
      if (candidates.size > maximumSimilarityCandidates) return [];
    }
  }

  return [...candidates]
    .map((candidate) => ({
      identity: candidate,
      score: partyNameSimilarity(parsed.name, index.identities.get(candidate)?.name ?? "", parsed.kind),
    }))
    .filter((candidate) => candidate.score >= minimumPartySimilarity)
    .sort((a, b) => b.score - a.score || a.identity.localeCompare(b.identity));
}

function findHistoryMatch(
  identity: string,
  history: ClassificationHistory,
): { entry: ClassificationHistoryEntry; similarity: number } | undefined {
  const exact = history.get(identity);
  if (exact) return { entry: exact, similarity: 1 };
  const index = historySimilarityIndexes.get(history);
  if (!index) return undefined;
  const matches = findSimilarPartyIdentities(identity, index);
  const best = matches[0];
  if (!best || (matches[1] && best.score - matches[1].score < 0.05)) return undefined;
  const entry = history.get(best.identity);
  return entry ? { entry, similarity: best.score } : undefined;
}

function classificationIdentity(transaction: Pick<Transaction, "description" | "direction">, profiles: RecipientProfile[] = []): string | null {
  const party = resolveTransactionParty(transaction.description, profiles);
  const identity = party ? party.kind + ":" + party.key : "description:" + similarityKey(transaction.description);
  return identity === "description:" ? null : transaction.direction + ":" + identity;
}

/** Build a local feedback index from categories the user deliberately chose. */
export function buildClassificationHistory(transactions: Transaction[], profiles: RecipientProfile[] = []): Map<string, ClassificationHistoryEntry> {
  const history = new Map<string, { votes: Map<Category, number>; rejectedCategories: Set<Category> }>();
  for (const transaction of transactions) {
    const key = classificationIdentity(transaction, profiles);
    if (!key) continue;
    const entry = history.get(key) ?? { votes: new Map<Category, number>(), rejectedCategories: new Set<Category>() };
    if (transaction.categoryLocked || transaction.manual) {
      entry.votes.set(transaction.category, (entry.votes.get(transaction.category) ?? 0) + 1);
    }
    if (transaction.rejectedSuggestion) entry.rejectedCategories.add(transaction.rejectedSuggestion);
    if (entry.votes.size || entry.rejectedCategories.size) history.set(key, entry);
  }
  historySimilarityIndexes.set(history, createPartySimilarityIndex(history.keys()));
  return history;
}

/** Score a category using user choices, custom rules, known patterns, and explicit uncertainty. */
export function classifyTransaction(
  transaction: Transaction,
  rules: CategoryRule[] = [],
  history?: ClassificationHistory,
  profiles: RecipientProfile[] = [],
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

  const party = resolveTransactionParty(transaction.description, profiles);
  if (party?.profile?.category) {
    return {
      category: party.profile.category,
      confidence: 0.98,
      source: "recipient-profile",
      reason: `${party.name} has a saved recipient profile category: ${party.profile.category}.`,
    };
  }

  const identity = classificationIdentity(transaction, profiles);
  const historyMatch = history && identity ? findHistoryMatch(identity, history) : undefined;
  const historyEntry = historyMatch?.entry;
  const similarityNote = historyMatch && historyMatch.similarity < 1
    ? ` Similar-name match used history at ${Math.round(historyMatch.similarity * 100)}% name similarity.`
    : "";
  const historyConfidence = (confidence: number): number =>
    historyMatch ? Math.round(confidence * historyMatch.similarity * 100) / 100 : confidence;
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
        confidence: historyConfidence(Math.min(0.96, 0.84 + 0.12 * (winningCount / total))),
        source: "merchant-history",
        reason: `You kept ${winningCategory} and rejected ${rejected} for this payee; future matches use that correction.${similarityNote}`,
      };
    }
    if (total >= 2 && winningCategory && !historyEntry.rejectedCategories.has(winningCategory)) {
      const agreement = winningCount / total;
      if (agreement >= 0.67) {
        const support = Math.min(1, Math.log2(total + 1) / 2);
        const confidence = Math.min(0.99, 0.7 + 0.29 * agreement * support);
        return {
          category: winningCategory,
          confidence: historyConfidence(confidence),
          source: "merchant-history",
          reason: winningCount + " of " + total + " previous hand-categorized transactions for this payee agree." + similarityNote,
        };
      }
      const fallback = categorise(transaction.description, transaction.direction);
      return {
        category: historyEntry.rejectedCategories.has(fallback)
          ? winningNonRejectedCategory(historyEntry) ?? transaction.category
          : fallback,
        confidence: historyConfidence(0.52),
        source: "conflicting-history",
        reason: "Previous hand-categorized transactions for this payee disagree; review the category." + similarityNote,
      };
    }
  }

  const category = categorise(transaction.description, transaction.direction);
  if (historyEntry?.rejectedCategories.has(category)) {
    return {
      category: winningNonRejectedCategory(historyEntry) ?? transaction.category,
      confidence: historyConfidence(0.35),
      source: "conflicting-history",
      reason: `A previous suggestion of ${category} was rejected for this payee, so it will not be suggested again without stronger evidence.${similarityNote}`,
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
  profiles: RecipientProfile[] = [],
): Transaction[] {
  return applyCategoryRules(transactions, rules).map((transaction) => {
    if (transaction.manual || transaction.categoryLocked) return transaction;
    const classification = classifyTransaction(transaction, rules, history, profiles);
    return classification.category === transaction.category ? transaction : { ...transaction, category: classification.category };
  });
}

/** Counts exact and high-confidence similar recognized parties without treating transactions as duplicates. */
export function getSimilarTransactionCounts(transactions: Transaction[], profiles: RecipientProfile[] = []): Map<string, number> {
  const identityFor = (transaction: Transaction): string => {
    const party = resolveTransactionParty(transaction.description, profiles);
    const identity = party ? party.kind + ":" + party.key : "description:" + similarityKey(transaction.description);
    return transaction.direction + ":" + identity;
  };
  const identityByTransaction = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    const identity = identityFor(transaction);
    identityByTransaction.set(transaction.id, identity);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const similarCounts = new Map(counts);
  const index = createPartySimilarityIndex(counts.keys());
  for (const identity of counts.keys()) {
    for (const match of findSimilarPartyIdentities(identity, index)) {
      if (identity.localeCompare(match.identity) >= 0) continue;
      similarCounts.set(identity, (similarCounts.get(identity) ?? 0) + (counts.get(match.identity) ?? 0));
      similarCounts.set(match.identity, (similarCounts.get(match.identity) ?? 0) + (counts.get(identity) ?? 0));
    }
  }
  return new Map(transactions.map((transaction) => [
    transaction.id,
    similarCounts.get(identityByTransaction.get(transaction.id) ?? "") ?? 1,
  ]));
}
