import type { BetMatchMethod, BetMatchSide } from "./bettingCorrelation.ts";

/**
 * User-confirmed bank-row ↔ bet-ledger links. Only rows the user confirmed live
 * here; suggested matches stay suggestions until then. Links never change any
 * transaction or bet — they are the bookkeeping that lets the correlation panel
 * report coverage.
 */
export interface BettingLink {
  id: string;
  betId: string;
  transactionId: string;
  side: BetMatchSide;
  method: BetMatchMethod;
  /** Ledger amount linked (stake or return). */
  amount: number;
  date: string;
  /** Canonical operator name when either side named one. */
  operator?: string;
  /** Local date (yyyy-mm-dd) when the user confirmed the link. */
  linkedOn: string;
}

const SIDES = new Set<string>(["stake", "return"]);
const METHODS = new Set<string>(["exact", "operator-window", "date-amount"]);
const ID_LIMIT = 240;

function text(value: unknown, limit = 120): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Reads saved links defensively; broken rows are dropped, never repaired. */
export function normaliseBettingLinks(value: unknown): BettingLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): BettingLink[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = text(record.id, 80);
    const betId = text(record.betId, ID_LIMIT);
    const transactionId = text(record.transactionId, ID_LIMIT);
    const side = typeof record.side === "string" && SIDES.has(record.side) ? record.side as BetMatchSide : undefined;
    const method = typeof record.method === "string" && METHODS.has(record.method) ? record.method as BetMatchMethod : undefined;
    const amount = nonNegativeNumber(record.amount);
    const date = typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date) ? record.date : undefined;
    const linkedOn = typeof record.linkedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.linkedOn) ? record.linkedOn : undefined;
    if (!id || !betId || !transactionId || !side || !method || amount === undefined || !date || !linkedOn) return [];
    const operator = text(record.operator, 40);
    return [{ id, betId, transactionId, side, method, amount, date, linkedOn, ...(operator ? { operator } : {}) }];
  });
}

/** Two sides of the same row pair are one link, so links dedupe on this key. */
export function linkKey(betId: string, transactionId: string): string {
  return `${betId}|${transactionId}`;
}
