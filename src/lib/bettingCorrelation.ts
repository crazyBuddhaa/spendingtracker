import type { BetRecord, Transaction } from "../types.ts";
import { operatorFromText } from "./bettingOperators.ts";

/**
 * Correlates bet-ledger money with bank statement rows.
 *
 * Two directions are matched independently:
 * - "stake":  bank debits (money placed) ↔ bet.stake
 * - "return": bank credits (winnings credited back) ↔ bet.returnAmount
 *
 * Matches are suggestions only — nothing is linked silently. Every result
 * carries the rule that produced it so the page can explain why the money
 * looks connected.
 */

export type BetMatchSide = "stake" | "return";

export type BetMatchMethod =
  /** Same exact date, same operator, same amount. */
  | "exact"
  /** Same operator, same amount, dates within the posting window. */
  | "operator-window"
  /** Same date (stakes) or nearby date (returns), same amount, and at least one side has no operator name. */
  | "date-amount";

export interface BetPaymentMatch {
  id: string;
  betId: string;
  transactionId: string;
  side: BetMatchSide;
  method: BetMatchMethod;
  /** Bank date of the matched row. */
  bankDate: string;
  bankAmount: number;
  betDate: string;
  /** Stake or return on the bet side. */
  betAmount: number;
  /** Bank date minus bet date, in days. */
  dateDeltaDays: number;
  operator: string | null;
}

export interface BetPaymentMatchOptions {
  /** Days either side of the bet date a stake debit may post. Default 3. */
  stakeWindowDays?: number;
  /** Days either side of the bet date a winnings credit may post. Default 7. */
  returnWindowDays?: number;
}

const amountsEqual = (left: number, right: number) => Math.abs(left - right) < 0.01;

const validIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function daysBetween(isoFrom: string, isoTo: string): number {
  const from = Date.UTC(Number(isoFrom.slice(0, 4)), Number(isoFrom.slice(5, 7)) - 1, Number(isoFrom.slice(8, 10)));
  const to = Date.UTC(Number(isoTo.slice(0, 4)), Number(isoTo.slice(5, 7)) - 1, Number(isoTo.slice(8, 10)));
  return Math.round((to - from) / 86400000);
}

/** A bank row that looks like betting money: named operator, "betting", or the Betting category. */
function looksLikeBetting(transaction: Transaction): boolean {
  if (transaction.internalTransfer || transaction.ownAccountCandidate) return false;
  if (transaction.category === "Betting") return true;
  if (operatorFromText(transaction.description)) return true;
  return /\bbetting\b|\bwinnings?\b|\bstake\b/i.test(transaction.description);
}

function stakeCandidates(transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) =>
    transaction.direction === "expense"
    && looksLikeBetting(transaction)
    && validIsoDate(transaction.date));
}

function returnCandidates(transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) =>
    transaction.direction === "income"
    && looksLikeBetting(transaction)
    && validIsoDate(transaction.date));
}

function bankOperator(transaction: Transaction): string | null {
  return operatorFromText(transaction.description);
}

interface Pairing {
  betId: string;
  transactionId: string;
  side: BetMatchSide;
  method: BetMatchMethod;
  bankTransaction: Transaction;
  bankOperator: string | null;
  betOperator: string | null;
  bankDate: string;
  bankAmount: number;
  betDate: string;
  betAmount: number;
  dateDeltaDays: number;
}

function computePairings(
  bankRows: Transaction[],
  betEntries: BetRecord[],
  amountOf: (bet: BetRecord) => number,
  windowDays: number,
  stakeSide: boolean,
): Pairing[] {
  // 1. Collect every pair that satisfies amount, window, and operator agreement.
  const candidatePairs: Array<{ betId: string; transaction: Transaction; betAmount: number; rawDelta: number }> = [];
  for (const bet of betEntries) {
    const amount = amountOf(bet);
    if (!(amount > 0)) continue;
    for (const transaction of bankRows) {
      const rawDelta = daysBetween(bet.date, transaction.date);
      if (Math.abs(rawDelta) > windowDays) continue;
      if (!amountsEqual(transaction.amount, amount)) continue;
      const bankOp = bankOperator(transaction);
      const betOp = operatorFromText(bet.source);
      // When both sides name an operator they must agree; unknown names stay open to matching.
      if (bankOp && betOp && bankOp !== betOp) continue;
      candidatePairs.push({ betId: bet.id, transaction, betAmount: amount, rawDelta });
    }
  }

  // 2. Keep only pairs that are unique on both sides. A bank row that suits two
  //    bets equally — or a bet that suits two bank rows the same way — is left
  //    unmatched for the user to decide.
  const pairsPerBet = new Map<string, number>();
  const pairsPerTransaction = new Map<string, number>();
  for (const pair of candidatePairs) {
    pairsPerBet.set(pair.betId, (pairsPerBet.get(pair.betId) ?? 0) + 1);
    pairsPerTransaction.set(pair.transaction.id, (pairsPerTransaction.get(pair.transaction.id) ?? 0) + 1);
  }

  return candidatePairs
    .filter((pair) => pairsPerBet.get(pair.betId) === 1 && pairsPerTransaction.get(pair.transaction.id) === 1)
    .map((pair) => {
      const bankOp = bankOperator(pair.transaction);
      const betOp = operatorFromText(betEntries.find((bet) => bet.id === pair.betId)!.source);
      const delta = Math.abs(pair.rawDelta);
      const method: BetMatchMethod = bankOp && betOp
        ? delta === 0 ? "exact" : "operator-window"
        : "date-amount";
      const bet = betEntries.find((row) => row.id === pair.betId)!;
      return {
        betId: pair.betId,
        transactionId: pair.transaction.id,
        side: stakeSide ? "stake" : "return",
        method,
        bankTransaction: pair.transaction,
        bankOperator: bankOp,
        betOperator: betOp,
        bankDate: pair.transaction.date,
        bankAmount: pair.transaction.amount,
        betDate: bet.date,
        betAmount: pair.betAmount,
        dateDeltaDays: pair.rawDelta,
      };
    });
}

function buildMatches(pairings: Pairing[]): BetPaymentMatch[] {
  return pairings
    .map((pairing) => ({
      id: `${pairing.betId}|${pairing.transactionId}`,
      betId: pairing.betId,
      transactionId: pairing.transactionId,
      side: pairing.side,
      method: pairing.method,
      bankDate: pairing.bankDate,
      bankAmount: pairing.bankAmount,
      betDate: pairing.betDate,
      betAmount: pairing.betAmount,
      dateDeltaDays: pairing.dateDeltaDays,
      operator: pairing.bankOperator ?? pairing.betOperator,
    }))
    .sort((left, right) => right.bankDate.localeCompare(left.bankDate) || left.betId.localeCompare(right.betId));
}

/**
 * Suggest bank rows ↔ bet ledger entries. A pair is only suggested when the bank
 * row suits exactly one bet and the bet suits exactly one bank row; anything
 * ambiguous is left for the user to decide.
 */
export function findBetPaymentMatches(
  transactions: Transaction[],
  bets: BetRecord[],
  options: BetPaymentMatchOptions = {},
): BetPaymentMatch[] {
  const stakeWindow = Math.max(0, options.stakeWindowDays ?? 3);
  const returnWindow = Math.max(0, options.returnWindowDays ?? 7);
  const stakes = bets.filter((bet) => bet.stake > 0);
  const returns = bets.filter((bet) => bet.returnAmount > 0);
  const pairings = [
    ...computePairings(stakeCandidates(transactions), stakes, (bet) => bet.stake, stakeWindow, true),
    ...computePairings(returnCandidates(transactions), returns, (bet) => bet.returnAmount, returnWindow, false),
  ];
  return buildMatches(pairings);
}

export interface CorrelationFigures {
  count: number;
  total: number;
}

export interface BettingCorrelationSummary {
  /** Bank rows that look like betting stakes: count and total debited. */
  bankStakes: CorrelationFigures;
  /** Bank rows that look like credited winnings: count and total credited. */
  bankReturns: CorrelationFigures;
  /** Stake/return money recorded in the bet ledger. */
  ledgerStakes: CorrelationFigures;
  ledgerReturns: CorrelationFigures;
  /** Confirmed links so far (per side). */
  linkedStakes: CorrelationFigures;
  linkedReturns: CorrelationFigures;
  /** Linked stake total ÷ bank stake total, as a percentage; null with none on either side. */
  bankStakeCoverage: number | null;
  /** Linked stake total ÷ ledger stake total. */
  ledgerStakeCoverage: number | null;
  bankReturnCoverage: number | null;
  ledgerReturnCoverage: number | null;
  /** Money still unexplained on each side. */
  unmatchedBankStakeTotal: number;
  unmatchedBankReturnTotal: number;
  unmatchedLedgerStakeTotal: number;
  unmatchedLedgerReturnTotal: number;
}

const figures = (rows: { amount: number }[]): CorrelationFigures => ({
  count: rows.length,
  total: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)),
});

const moneySum = (rows: Array<{ amount: number }>): number =>
  rows.reduce((sum, row) => sum + row.amount, 0);

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const percent = (part: number, total: number): number | null =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : null;

/**
 * Figures for how much betting money on the bank statement is explained by
 * confirmed links. Suggestions never inflate these numbers — only user-confirmed
 * links count, and everything else stays "unmatched" while work continues.
 */
export function summariseBettingCorrelation(
  transactions: Transaction[],
  bets: BetRecord[],
  links: Array<{ betId: string; transactionId: string; side: BetMatchSide; amount: number }>,
): BettingCorrelationSummary {
  const bankStakeRows = stakeCandidates(transactions);
  const bankReturnRows = returnCandidates(transactions);
  const bankStakes = figures(bankStakeRows);
  const bankReturns = figures(bankReturnRows);
  const ledgerStakeRows = bets.filter((bet) => bet.stake > 0);
  const ledgerReturnRows = bets.filter((bet) => bet.returnAmount > 0);
  const ledgerStakes = { count: ledgerStakeRows.length, total: roundMoney(ledgerStakeRows.reduce((sum, bet) => sum + bet.stake, 0)) };
  const ledgerReturns = { count: ledgerReturnRows.length, total: roundMoney(ledgerReturnRows.reduce((sum, bet) => sum + bet.returnAmount, 0)) };

  const linkedStakes = figures(links.filter((link) => link.side === "stake"));
  const linkedReturns = figures(links.filter((link) => link.side === "return"));

  // Coverage counts the ledger money (bet stake/return) linked to bank rows.
  const linkedStakeTotal = moneySum(links.filter((link) => link.side === "stake"));
  const linkedReturnTotal = moneySum(links.filter((link) => link.side === "return"));

  const round = (value: number) => roundMoney(value);
  const unmatchedBankStakeTotal = round(Math.max(0, bankStakes.total - linkedStakeTotal));
  const unmatchedBankReturnTotal = round(Math.max(0, bankReturns.total - linkedReturnTotal));
  const unmatchedLedgerStakeTotal = round(Math.max(0, ledgerStakes.total - linkedStakeTotal));
  const unmatchedLedgerReturnTotal = round(Math.max(0, ledgerReturns.total - linkedReturnTotal));

  return {
    bankStakes,
    bankReturns,
    ledgerStakes,
    ledgerReturns,
    linkedStakes,
    linkedReturns,
    bankStakeCoverage: percent(linkedStakeTotal, bankStakes.total),
    ledgerStakeCoverage: percent(linkedStakeTotal, ledgerStakes.total),
    bankReturnCoverage: percent(linkedReturnTotal, bankReturns.total),
    ledgerReturnCoverage: percent(linkedReturnTotal, ledgerReturns.total),
    unmatchedBankStakeTotal,
    unmatchedBankReturnTotal,
    unmatchedLedgerStakeTotal,
    unmatchedLedgerReturnTotal,
  };
}
