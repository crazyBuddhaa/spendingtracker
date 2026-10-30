import type { BetRecord, Transaction } from "../types.ts";
import { operatorFromText } from "./bettingOperators.ts";

export interface BetMatchCandidate {
  transactionId: string;
  betId: string;
  date: string;
  operator: string;
  amount: number;
}

function matchKey(date: string, amount: number, operator: string): string {
  return `${date}|${amount.toFixed(2)}|${operator.toLowerCase()}`;
}

export function findBetMatchCandidates(
  transactions: Transaction[],
  bets: BetRecord[],
): BetMatchCandidate[] {
  const transactionGroups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (transaction.direction !== "expense" || transaction.category !== "Betting") continue;
    const operator = operatorFromText(transaction.description);
    if (!operator) continue;
    const key = matchKey(transaction.date, transaction.amount, operator);
    const group = transactionGroups.get(key) ?? [];
    group.push(transaction);
    transactionGroups.set(key, group);
  }

  const betGroups = new Map<string, BetRecord[]>();
  for (const bet of bets) {
    const operator = operatorFromText(bet.source);
    if (!operator || bet.stake <= 0) continue;
    const key = matchKey(bet.date, bet.stake, operator);
    const group = betGroups.get(key) ?? [];
    group.push(bet);
    betGroups.set(key, group);
  }

  const matches: BetMatchCandidate[] = [];
  for (const [key, transactionGroup] of transactionGroups) {
    const betGroup = betGroups.get(key);
    // Only suggest one-to-one matches; repeated equal stakes are ambiguous.
    if (transactionGroup?.length !== 1 || betGroup?.length !== 1) continue;
    const transaction = transactionGroup[0];
    const bet = betGroup[0];
    const operator = operatorFromText(transaction.description);
    if (!operator) continue;
    matches.push({
      transactionId: transaction.id,
      betId: bet.id,
      date: transaction.date,
      operator,
      amount: transaction.amount,
    });
  }
  return matches.sort((a, b) => b.date.localeCompare(a.date) || a.operator.localeCompare(b.operator));
}
