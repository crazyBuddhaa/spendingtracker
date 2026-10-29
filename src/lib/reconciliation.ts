import { similarityKey } from "./categorise.ts";
import type {
  Category,
  Direction,
  MutationEntry,
  MutationKind,
  StatementSnapshot,
  Transaction,
} from "../types.ts";

/**
 * The transparency engine: every figure and suggestion here is derived from
 * recorded transactions or from declared statement values the user entered, and
 * each result carries the evidence behind it. Inferred (reconstructed) records
 * are produced as suggestions only — they never replace or rewrite original rows.
 */

/* ------------------------------------------------------------ normalisers */

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function periodText(snapshot: Partial<StatementSnapshot>): string | undefined {
  const start = typeof snapshot.periodStart === "string" ? snapshot.periodStart : "";
  const end = typeof snapshot.periodEnd === "string" ? snapshot.periodEnd : "";
  return isoDatePattern.test(start) && isoDatePattern.test(end) && start <= end ? start : undefined;
}

/** Reads saved statement snapshots defensively; unreadable entries are dropped, never repaired. */
export function normaliseStatementSnapshots(value: unknown): StatementSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): StatementSnapshot[] => {
    if (!entry || typeof entry !== "object") return [];
    const snapshot = entry as Partial<StatementSnapshot>;
    if (
      typeof snapshot.id !== "string" ||
      typeof snapshot.account !== "string" ||
      !snapshot.account.trim() ||
      typeof periodText(snapshot) !== "string" ||
      snapshot.periodStart! > snapshot.periodEnd! ||
      (snapshot.recordedBy !== "manual" && snapshot.recordedBy !== "import")
    ) {
      return [];
    }
    return [{
      id: snapshot.id,
      account: snapshot.account.slice(0, 60),
      periodStart: snapshot.periodStart!,
      periodEnd: snapshot.periodEnd!,
      openingBalance: finite(snapshot.openingBalance),
      closingBalance: finite(snapshot.closingBalance),
      declaredTotalIn: finite(snapshot.declaredTotalIn),
      declaredTotalOut: finite(snapshot.declaredTotalOut),
      recordedBy: snapshot.recordedBy,
      createdAt: typeof snapshot.createdAt === "string" ? snapshot.createdAt.slice(0, 40) : "",
      ...(typeof snapshot.note === "string" && snapshot.note.trim() ? { note: snapshot.note.slice(0, 280) } : {}),
    }];
  });
}

const mutationKinds: readonly MutationKind[] = ["import", "add", "inferred-add", "verify", "update", "delete", "clear", "restore"];

/** Reads the mutation audit trail; the log is append-only storytelling, so partial reads are allowed. */
export function normaliseMutationLog(value: unknown): MutationEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MutationEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<MutationEntry>;
    if (typeof item.id !== "string" || typeof item.at !== "string") return [];
    if (!item.kind || !mutationKinds.includes(item.kind)) return [];
    if (typeof item.detail !== "string" || !item.detail.trim()) return [];
    return [{
      id: item.id,
      at: item.at.slice(0, 40),
      kind: item.kind,
      detail: item.detail.slice(0, 300),
      ...(Array.isArray(item.transactionIds)
        ? { transactionIds: item.transactionIds.filter((id): id is string => typeof id === "string").slice(0, 500) }
        : {}),
      ...(typeof item.evidence === "string" && item.evidence.trim() ? { evidence: item.evidence.slice(0, 300) } : {}),
    }];
  });
}

export const MUTATION_LOG_LIMIT = 1000;

/** Keeps the newest entries when the log grows beyond its cap; entries are never rewritten. */
export function appendMutationEntry(log: MutationEntry[], entry: MutationEntry): MutationEntry[] {
  return [...log, entry].slice(-MUTATION_LOG_LIMIT);
}

/* ------------------------------------------------------- ledger integrity */

export type LedgerIssueKind = "exact-duplicate" | "near-duplicate" | "period-gap";

export interface LedgerIssue {
  kind: LedgerIssueKind;
  transactionIds: string[];
  /** What the engine observed, in money terms. */
  message: string;
}

interface LedgerKey {
  date: string;
  amount: number;
  direction: Direction;
  key: string;
}

function ledgerKeyFor(transaction: Transaction): LedgerKey {
  return {
    date: transaction.date,
    amount: transaction.amount,
    direction: transaction.direction,
    key: similarityKey(transaction.description),
  };
}

/**
 * Audits the ledger itself: repeated rows and suspicious near-matches are shown,
 * never removed silently. Every issue lists the exact transactions behind it.
 */
export function auditLedger(transactions: Transaction[]): LedgerIssue[] {
  const issues: LedgerIssue[] = [];

  // Exact duplicates: same day, same amount, same direction, same normalised description.
  const exact = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const { date, amount, direction, key } = ledgerKeyFor(transaction);
    const id = `${direction}|${date}|${amount.toFixed(2)}|${key}`;
    const bucket = exact.get(id);
    if (bucket) bucket.push(transaction);
    else exact.set(id, [transaction]);
  }
  for (const bucket of exact.values()) {
    if (bucket.length < 2) continue;
    issues.push({
      kind: "exact-duplicate",
      transactionIds: bucket.map((transaction) => transaction.id),
      message: `${bucket.length} identical rows on ${bucket[0].date}: ${bucket[0].description} · ${bucket[0].source}. Record history may have been imported twice.`,
    });
  }

  // Near-duplicates: same day and amount but a different account can still be two
  // true records (a payment funded by both wallets), so these stay review prompts.
  const near = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (transaction.internalTransfer) continue;
    const { date, amount, direction, key } = ledgerKeyFor(transaction);
    if (!key) continue;
    const id = `${direction}|${date}|${amount.toFixed(2)}|${key}`;
    const bucket = near.get(id);
    if (bucket) bucket.push(transaction);
    else near.set(id, [transaction]);
  }
  for (const [id, bucket] of near.entries()) {
    if (bucket.length < 2) continue;
    const accounts = [...new Set(bucket.map((transaction) => transaction.source))];
    if (accounts.length < 2) continue; // identical rows were already reported above
    void id;
    issues.push({
      kind: "near-duplicate",
      transactionIds: bucket.map((transaction) => transaction.id),
      message: `${bucket.length} same-day rows share ${bucket[0].description} of the same amount across ${accounts.join(" and ")}. Confirm they are separate records, not one payment seen twice.`,
    });
  }

  // Period gaps: account months with no rows between its first and last record.
  const byAccount = new Map<string, Set<string>>();
  for (const transaction of transactions) {
    if (!isoDatePattern.test(transaction.date)) continue;
    const months = byAccount.get(transaction.source) ?? new Set<string>();
    months.add(transaction.date.slice(0, 7));
    byAccount.set(transaction.source, months);
  }
  for (const [account, months] of byAccount.entries()) {
    if (months.size < 2) continue;
    const ordered = [...months].sort();
    const missing: string[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      // String arithmetic keeps month boundaries in the statement's own calendar.
      let [year, month] = ordered[index - 1].split("-").map(Number);
      month += 1;
      while (`${year}-${String(month).padStart(2, "0")}` < ordered[index]) {
        missing.push(`${year}-${String(month).padStart(2, "0")}`);
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }
    if (!missing.length) continue;
    issues.push({
      kind: "period-gap",
      transactionIds: [],
      message: `${account} has no recorded transactions in ${[missing.slice(0, 3).join(", "), missing.length > 3 ? `and ${missing.length - 3} more month${missing.length - 3 === 1 ? "" : "s"}` : null].filter(Boolean).join(" ")}. A statement covering those months may not have been imported.`,
    });
  }

  return issues;
}

/* ------------------------------------------------------- transfer matching */

export interface TransferLink {
  /** Deterministic id built from both leg ids, so links are stable across reloads. */
  id: string;
  outId: string;
  inId: string;
  date: string;
  amount: number;
  confidence: number;
  /** Why these two rows are considered one movement. */
  reason: string;
}

export interface UnmatchedMovement {
  transaction: Transaction;
  role: "sent" | "received";
  reason: string;
}

export interface TransferIntelligence {
  links: TransferLink[];
  unmatched: UnmatchedMovement[];
}

/** How many days apart a departure and an equal arrival may still be one movement. */
export const transferMatchWindowDays = 3;

/**
 * Links related rows across accounts, wallets, and savings: money that left one
 * recorded account and arrived in another within a few days. Each row participates
 * in at most one link; left-over external movements are reported as unmatched with
 * their evidence, not hidden.
 */
export function matchTransfers(transactions: Transaction[], windowDays = transferMatchWindowDays): TransferIntelligence {
  const usable = transactions.filter((transaction) => !transaction.internalTransfer && transaction.amount > 0);
  const outLedger = usable.filter((transaction) => transaction.direction === "expense");
  // Buckets key arrival candidates by amount and date so each departure checks a
  // handful of rows instead of the whole ledger.
  const arrivalBuckets = new Map<string, Transaction[]>();
  for (const transaction of usable) {
    if (transaction.direction !== "income") continue;
    const key = `${transaction.amount.toFixed(2)}|${transaction.date}`;
    const bucket = arrivalBuckets.get(key);
    if (bucket) bucket.push(transaction);
    else arrivalBuckets.set(key, [transaction]);
  }
  const linkedOut = new Set<string>();
  const linkedIn = new Set<string>();
  const candidates: Array<{ out: Transaction; in: Transaction; confidence: number; reason: string }> = [];

  const isoDay = (date: string, offsetDays: number) => {
    if (!isoDatePattern.test(date)) return null;
    const shifted = new Date(`${date}T00:00:00Z`);
    shifted.setUTCMonth(shifted.getUTCMonth(), shifted.getUTCDate() + offsetDays);
    const shiftedIso = shifted.toISOString().slice(0, 10);
    return shiftedIso;
  };

  for (const out of outLedger) {
    for (let offset = 0; offset <= windowDays; offset += 1) {
      const arrivalDate = isoDay(out.date, offset);
      if (!arrivalDate) break;
      const bucket = arrivalBuckets.get(`${out.amount.toFixed(2)}|${arrivalDate}`);
      if (!bucket) continue;
      for (const incoming of bucket) {
        if (out.id === incoming.id) continue;
        if (out.source === incoming.source) continue;
        const candidateBoost = out.ownAccountCandidate || incoming.ownAccountCandidate ? 0.15 : 0;
        const sameDescription = similarityKey(out.description) === similarityKey(incoming.description) && similarityKey(out.description).length > 0 ? 0.1 : 0;
        const confidence = Math.min(0.98, 0.7 + candidateBoost + sameDescription);
        candidates.push({
          out,
          in: incoming,
          confidence,
          reason: `Identical amounts (${out.amount.toFixed(2)}) left ${out.source} on ${out.date} and arrived in ${incoming.source} ${offset === 0 ? "the same day" : `${offset} day${offset === 1 ? "" : "s"} later`}${out.ownAccountCandidate || incoming.ownAccountCandidate ? ", and at least one leg already reads like your own account" : ""}.`,
        });
      }
    }
  }

  candidates.sort((first, second) => second.confidence - first.confidence || second.out.date.localeCompare(first.out.date));
  const links: TransferLink[] = [];
  for (const candidate of candidates) {
    if (linkedOut.has(candidate.out.id) || linkedIn.has(candidate.in.id)) continue;
    linkedOut.add(candidate.out.id);
    linkedIn.add(candidate.in.id);
    links.push({
      id: `${candidate.out.id}__${candidate.in.id}`,
      outId: candidate.out.id,
      inId: candidate.in.id,
      date: candidate.in.date,
      amount: candidate.out.amount,
      confidence: candidate.confidence,
      reason: candidate.reason,
    });
  }

  const counterpartCategory = (category: Category) => category === "Transfers" || category === "Cash withdrawal";
  const unmatched: UnmatchedMovement[] = usable
    .filter((transaction) => !linkedOut.has(transaction.id) && !linkedIn.has(transaction.id))
    .flatMap((transaction): UnmatchedMovement[] => {
      if (transaction.direction === "expense" && counterpartCategory(transaction.category)) {
        return [{
          transaction,
          role: "sent",
          reason: `Recorded as leaving ${transaction.source}${transaction.inferred ? " and marked inferred" : ""}, but no matching arrival appears in any other recorded account within ${windowDays} day${windowDays === 1 ? "" : "s"}.`,
        }];
      }
      if (transaction.direction === "income" && (counterpartCategory(transaction.category) || transaction.ownAccountCandidate)) {
        return [{
          transaction,
          role: "received",
          reason: `Recorded as arriving in ${transaction.source}, but no matching departure appears in any other recorded account within ${windowDays} day${windowDays === 1 ? "" : "s"}.`,
        }];
      }
      return [];
    })
    .sort((first, second) => second.transaction.date.localeCompare(first.transaction.date));

  return { links, unmatched };
}

/* ------------------------------------------------- statement reconciliation */

export interface ReconciliationResult {
  snapshotId: string;
  account: string;
  periodStart: string;
  periodEnd: string;
  /** Recorded rows inside the declared period for this account. */
  recordedCount: number;
  recordedIn: number;
  recordedOut: number;
  /** closing - opening when both balances are declared. */
  declaredDelta: number | null;
  /** How far declared movement is from recorded movement; a positive figure usually means rows are missing. */
  deltaDifference: number | null;
  declaredIn: number | null;
  declaredOut: number | null;
  /** declaredTotalIn - recordedIn when the statement declared its own totals. */
  inDifference: number | null;
  /** declaredTotalOut - recordedOut when the statement declared its own totals. */
  outDifference: number | null;
  /** Where the unexplained movement shows up, in words. */
  reason: string;
}

/**
 * Compares declared statement numbers with what the ledger explains. Differences
 * are reported with their arithmetic so the user can trace every naira.
 */
export function reconcileStatement(transactions: Transaction[], snapshot: StatementSnapshot): ReconciliationResult {
  const rows = transactions.filter((transaction) =>
    transaction.source === snapshot.account &&
    transaction.date >= snapshot.periodStart &&
    transaction.date <= snapshot.periodEnd &&
    !transaction.internalTransfer);
  const recordedIn = rows.filter((transaction) => transaction.direction === "income").reduce((sum, transaction) => sum + transaction.amount, 0);
  const recordedOut = rows.filter((transaction) => transaction.direction === "expense").reduce((sum, transaction) => sum + transaction.amount, 0);
  const declaredDelta = snapshot.openingBalance !== undefined && snapshot.closingBalance !== undefined
    ? Math.round((snapshot.closingBalance - snapshot.openingBalance) * 100) / 100
    : null;
  const recordedNet = Math.round((recordedIn - recordedOut) * 100) / 100;
  const deltaDifference = declaredDelta === null ? null : Math.round((declaredDelta - recordedNet) * 100) / 100;
  const declaredIn = snapshot.declaredTotalIn ?? null;
  const declaredOut = snapshot.declaredTotalOut ?? null;
  const inDifference = declaredIn === null ? null : Math.round((declaredIn - recordedIn) * 100) / 100;
  const outDifference = declaredOut === null ? null : Math.round((declaredOut - recordedOut) * 100) / 100;

  const parts: string[] = [];
  if (deltaDifference !== null && Math.abs(deltaDifference) >= 0.01) {
    parts.push(`balances moved ${declaredDelta! >= 0 ? "up" : "down"} by ${Math.abs(declaredDelta!).toFixed(2)} versus a recorded net of ${recordedNet.toFixed(2)}`);
  }
  if (inDifference !== null && Math.abs(inDifference) >= 0.01) parts.push(`declared money in exceeds recorded credits by ${inDifference.toFixed(2)}`);
  if (outDifference !== null && Math.abs(outDifference) >= 0.01) parts.push(`declared money out exceeds recorded debits by ${outDifference.toFixed(2)}`);
  const reason = parts.length
    ? `Recorded history does not fully explain this statement: ${parts.join("; ")}.`
    : `Recorded history matches the declared figures (${rows.length.toLocaleString("en-NG")} rows used).`;

  return {
    snapshotId: snapshot.id,
    account: snapshot.account,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    recordedCount: rows.length,
    recordedIn: Math.round(recordedIn * 100) / 100,
    recordedOut: Math.round(recordedOut * 100) / 100,
    declaredDelta,
    deltaDifference,
    declaredIn,
    declaredOut,
    inDifference,
    outDifference,
    reason,
  };
}

/* ------------------------------------------------------- inferred records */

export interface InferredSuggestion {
  /** Deterministic id derived from the discrepancy, so the same gap never produces twice. */
  id: string;
  account: string;
  date: string;
  description: string;
  amount: number;
  direction: Direction;
  /** The traceable arithmetic that produced this suggestion. */
  basis: string;
}

function lastRowDateIn(rows: Transaction[], fallback: string): string {
  const dates = rows.map((row) => row.date).filter((date) => isoDatePattern.test(date)).sort();
  return dates.at(-1) ?? fallback;
}

/**
 * Suggests concrete reconstructed rows for unexplained gaps. Suggestions stay
 * suggestions: they are added to the ledger only after the user accepts them,
 * and always carry the inferred marker.
 */
export function suggestInferredRecords(transactions: Transaction[], snapshot: StatementSnapshot, result: ReconciliationResult): InferredSuggestion[] {
  const rows = transactions.filter((transaction) =>
    transaction.source === snapshot.account &&
    transaction.date >= snapshot.periodStart &&
    transaction.date <= snapshot.periodEnd);
  const anchor = lastRowDateIn(rows, snapshot.periodEnd) || snapshot.periodEnd;
  const suggestions: InferredSuggestion[] = [];
  const push = (direction: Direction, amount: number, label: string, basis: string) => {
    if (Math.abs(amount) < 0.01) return;
    suggestions.push({
      id: `${snapshot.id}:${direction}:${label}`,
      account: snapshot.account,
      date: anchor,
      description: label,
      amount: Math.round(amount * 100) / 100,
      direction,
      basis,
    });
  };

  if (result.inDifference !== null && Math.abs(result.inDifference) >= 0.01) {
    push("income", result.inDifference, "Unrecorded money in (inferred)",
      `Statement declared money in of ${result.declaredIn!.toFixed(2)} but recorded credits for ${snapshot.account} in this period sum to ${result.recordedIn.toFixed(2)}.`);
  }
  if (result.outDifference !== null && Math.abs(result.outDifference) >= 0.01) {
    push("expense", result.outDifference, "Unrecorded money out (inferred)",
      `Statement declared money out of ${result.declaredOut!.toFixed(2)} but recorded debits for ${snapshot.account} in this period sum to ${result.recordedOut.toFixed(2)}.`);
  }
  if (suggestions.length === 0 && result.deltaDifference !== null && Math.abs(result.deltaDifference) >= 0.01) {
    push(result.deltaDifference > 0 ? "income" : "expense", Math.abs(result.deltaDifference), "Unexplained balance move (inferred)",
      `Balances moved ${result.deltaDifference > 0 ? "up" : "down"} by ${Math.abs(result.deltaDifference).toFixed(2)} across ${snapshot.periodStart}–${snapshot.periodEnd}, while recorded rows for ${snapshot.account} net ${result.recordedIn.toFixed(2)} in / ${result.recordedOut.toFixed(2)} out.`);
  }
  return suggestions;
}

/* -------------------------------------------------------- accurate reports */

export interface MoneyMovementReport {
  /** Consumption only: expenses that are not transfers between own accounts. */
  actualSpending: number;
  /** Money sent to other people or external accounts. */
  transfersOut: number;
  transfersIn: number;
  /** Moves between your own wallet, savings pots, and accounts — excluded from every total. */
  internalMoves: number;
  bankFees: number;
  refunds: number;
  /** Unmatched external movements still awaiting explanation. */
  unresolvedOut: number;
  unresolvedIn: number;
  /** Inferred rows in the ledger that the user has not yet verified. */
  inferredPending: number;
  transactionCount: number;
}

/** Separates every kind of movement in the period so no figure is a mixture. */
export function buildMovementReport(transactions: Transaction[], unmatched: UnmatchedMovement[], ignoreOwnAccountCandidates: boolean): MoneyMovementReport {
  const sum = (rows: Transaction[]) => rows.reduce((total, transaction) => total + transaction.amount, 0);
  const expenses = transactions.filter((transaction) => transaction.direction === "expense" && !transaction.internalTransfer);
  const incomes = transactions.filter((transaction) => transaction.direction === "income" && !transaction.internalTransfer);
  const unresolvedOutIds = new Set(unmatched.filter((move) => move.role === "sent").map((move) => move.transaction.id));
  const unresolvedInIds = new Set(unmatched.filter((move) => move.role === "received").map((move) => move.transaction.id));
  return {
    actualSpending: Math.round(sum(expenses.filter((transaction) => transaction.category !== "Transfers" && transaction.category !== "Bank fees")) * 100) / 100,
    transfersOut: Math.round(sum(expenses.filter((transaction) => transaction.category === "Transfers")) * 100) / 100,
    transfersIn: Math.round(sum(incomes.filter((transaction) => transaction.category === "Transfers")) * 100) / 100,
    internalMoves: Math.round(sum(transactions.filter((transaction) => transaction.internalTransfer && transaction.direction === "expense")) * 100) / 100,
    bankFees: Math.round(sum(expenses.filter((transaction) => transaction.category === "Bank fees")) * 100) / 100,
    refunds: Math.round(sum(incomes.filter((transaction) => transaction.category === "Refunds")) * 100) / 100,
    unresolvedOut: Math.round(sum(expenses.filter((transaction) => unresolvedOutIds.has(transaction.id))) * 100) / 100,
    unresolvedIn: ignoreOwnAccountCandidates ? 0 : Math.round(sum(incomes.filter((transaction) => unresolvedInIds.has(transaction.id))) * 100) / 100,
    inferredPending: Math.round(sum(transactions.filter((transaction) => transaction.inferred)) * 100) / 100,
    transactionCount: transactions.length,
  };
}
