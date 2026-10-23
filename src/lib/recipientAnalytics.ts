import type { RecipientProfile, Transaction } from "../types.ts";
import { resolveTransactionParty } from "./recipientProfiles.ts";

export interface TypicalFareRange {
  key: string;
  name: string;
  count: number;
  medianAmount: number;
  lowerAmount: number;
  upperAmount: number;
  lastDate: string;
}

/** Returns an interpolated percentile for an already sorted, non-empty list. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Estimate ordinary Transport spend bands from observed payments. Route data is not
 * present in statements, so this intentionally reports a payee-level historical range.
 */
export function detectTypicalFareRanges(
  transactions: Transaction[],
  profiles: RecipientProfile[] = [],
): TypicalFareRange[] {
  const groups = new Map<string, { name: string; amounts: number[]; lastDate: string }>();
  for (const transaction of transactions) {
    if (transaction.direction !== "expense" || transaction.internalTransfer || transaction.ownAccountCandidate || transaction.category !== "Transport") continue;
    const party = resolveTransactionParty(transaction.description, profiles);
    if (!party || !Number.isFinite(transaction.amount) || transaction.amount <= 0) continue;
    const group = groups.get(party.key) ?? { name: party.name, amounts: [], lastDate: "" };
    group.amounts.push(transaction.amount);
    if (transaction.date > group.lastDate) group.lastDate = transaction.date;
    groups.set(party.key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.amounts.length >= 3)
    .map(([key, group]) => {
      const sorted = [...group.amounts].sort((a, b) => a - b);
      return {
        key,
        name: group.name,
        count: sorted.length,
        medianAmount: roundAmount(percentile(sorted, 0.5)),
        lowerAmount: roundAmount(percentile(sorted, 0.2)),
        upperAmount: roundAmount(percentile(sorted, 0.8)),
        lastDate: group.lastDate,
      };
    })
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}

