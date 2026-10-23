import { categoryList, type Category, type RecipientProfile, type Transaction, type TransactionPartyKind } from "../types.ts";
import { normalisePartyKey, recogniseTransactionParty } from "./categorise.ts";

export interface RecipientSummary {
  id: string;
  kind: TransactionPartyKind;
  key: string;
  name: string;
  aliases: string[];
  relationship?: string;
  category?: Category;
  note?: string;
  transactions: number;
  sent: number;
  received: number;
  lastDate: string;
}

const validCategories = new Set<string>(categoryList);
const partyKinds = new Set<TransactionPartyKind>(["merchant", "recipient", "sender"]);
const cleanText = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

export function normaliseRecipientProfiles(value: unknown): RecipientProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: RecipientProfile[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const profile = item as Partial<RecipientProfile>;
    const id = cleanText(profile.id, 180);
    const name = cleanText(profile.name, 100);
    if (!id || !name || !partyKinds.has(profile.kind as TransactionPartyKind) || seenIds.has(id)) continue;
    seenIds.add(id);
    const canonicalKey = normalisePartyKey(name);
    const aliasKeys = new Set<string>([canonicalKey]);
    const aliases = Array.isArray(profile.aliases)
      ? profile.aliases.flatMap((value) => {
        const alias = cleanText(value, 100);
        const key = normalisePartyKey(alias);
        if (!alias || !key || aliasKeys.has(key)) return [];
        aliasKeys.add(key);
        return [alias];
      }).slice(0, 30)
      : [];
    const category = typeof profile.category === "string" && validCategories.has(profile.category)
      ? profile.category as Category
      : undefined;
    const relationship = cleanText(profile.relationship, 60);
    const note = cleanText(profile.note, 280);
    profiles.push({
      id,
      kind: profile.kind as TransactionPartyKind,
      name,
      aliases,
      ...(relationship ? { relationship } : {}),
      ...(category ? { category } : {}),
      ...(note ? { note } : {}),
    });
  }
  return profiles;
}

function profileMatches(profile: RecipientProfile, kind: TransactionPartyKind, partyKey: string): boolean {
  if (profile.kind !== kind) return false;
  return [profile.name, ...profile.aliases].some((value) => normalisePartyKey(value) === partyKey);
}

/** Resolve statement variants to a managed profile while preserving the party kind. */
export function resolveTransactionParty(
  description: string,
  profiles: RecipientProfile[] = [],
): { kind: TransactionPartyKind; name: string; key: string; profile?: RecipientProfile } | null {
  const party = recogniseTransactionParty(description);
  if (!party) return null;
  const profile = profiles.find((item) => profileMatches(item, party.kind, party.key));
  return profile
    ? { kind: party.kind, name: profile.name, key: `profile:${profile.id}`, profile }
    : party;
}

/** Build a directory from recognized payees/payers plus saved profiles with no activity yet. */
export function getRecipientDirectory(transactions: Transaction[], profiles: RecipientProfile[] = []): RecipientSummary[] {
  const byId = new Map<string, RecipientSummary>();
  const categoryVotes = new Map<string, Map<Category, number>>();
  for (const profile of profiles) {
    byId.set(profile.id, {
      id: profile.id,
      kind: profile.kind,
      key: `profile:${profile.id}`,
      name: profile.name,
      aliases: [...profile.aliases],
      ...(profile.relationship ? { relationship: profile.relationship } : {}),
      ...(profile.category ? { category: profile.category } : {}),
      ...(profile.note ? { note: profile.note } : {}),
      transactions: 0,
      sent: 0,
      received: 0,
      lastDate: "",
    });
  }
  for (const transaction of transactions) {
    if (transaction.internalTransfer || transaction.ownAccountCandidate) continue;
    const party = resolveTransactionParty(transaction.description, profiles);
    if (!party) continue;
    const profile = party.profile;
    const id = profile?.id ?? `${party.kind}:${party.key}`;
    const summary = byId.get(id) ?? {
      id,
      kind: party.kind,
      key: party.key,
      name: party.name,
      aliases: [],
      transactions: 0,
      sent: 0,
      received: 0,
      lastDate: "",
    };
    summary.transactions += 1;
    if (transaction.direction === "expense") summary.sent += transaction.amount;
    else summary.received += transaction.amount;
    if (transaction.date > summary.lastDate) summary.lastDate = transaction.date;
    const votes = categoryVotes.get(id) ?? new Map<Category, number>();
    votes.set(transaction.category, (votes.get(transaction.category) ?? 0) + 1);
    categoryVotes.set(id, votes);
    byId.set(id, summary);
  }
  return [...byId.values()]
    .map((summary) => ({
      ...summary,
      category: profiles.find((profile) => profile.id === summary.id)?.category ??
        [...(categoryVotes.get(summary.id) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ??
        summary.category,
      sent: Math.round(summary.sent * 100) / 100,
      received: Math.round(summary.received * 100) / 100,
    }))
    .sort((a, b) => b.transactions - a.transactions || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}

export function getRecipientProfile(
  party: { kind: TransactionPartyKind; key: string },
  profiles: RecipientProfile[] = [],
): RecipientProfile | undefined {
  return profiles.find((profile) => profileMatches(profile, party.kind, party.key));
}
