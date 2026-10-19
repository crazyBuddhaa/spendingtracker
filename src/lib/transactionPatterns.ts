import type { Transaction } from "../types.ts";

export interface CounterpartySummary {
  name: string;
  count: number;
  sent: number;
  received: number;
}

export interface TransferInsights {
  ownAccountCandidateCount: number;
  ownAccountSent: number;
  ownAccountReceived: number;
  confirmedInternalCount: number;
  confirmedInternalAmount: number;
  repeatedCounterparties: CounterpartySummary[];
}

function counterpartyFromDescription(description: string): { direction: "sent" | "received"; name: string } | null {
  const match = description.match(/^transfer\s+(to|from)\s+([^|]+)/i);
  if (!match) return null;
  return {
    direction: match[1].toLowerCase() === "to" ? "sent" : "received",
    name: match[2].replace(/\s+/g, " ").trim(),
  };
}

function normaliseCounterparty(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function getTransferInsights(transactions: Transaction[]): TransferInsights {
  let ownAccountCandidateCount = 0;
  let ownAccountSent = 0;
  let ownAccountReceived = 0;
  let confirmedInternalCount = 0;
  let confirmedInternalAmount = 0;
  const groups = new Map<string, CounterpartySummary>();

  for (const transaction of transactions) {
    if (transaction.internalTransfer) {
      confirmedInternalCount += 1;
      confirmedInternalAmount += transaction.amount;
    }
    if (transaction.ownAccountCandidate) {
      ownAccountCandidateCount += 1;
      if (transaction.direction === "expense") ownAccountSent += transaction.amount;
      else ownAccountReceived += transaction.amount;
    }
    const counterparty = counterpartyFromDescription(transaction.description);
    if (!counterparty) continue;
    const key = normaliseCounterparty(counterparty.name);
    if (!key) continue;
    const summary = groups.get(key) ?? {
      name: counterparty.name,
      count: 0,
      sent: 0,
      received: 0,
    };
    summary.count += 1;
    if (counterparty.direction === "sent") summary.sent += transaction.amount;
    else summary.received += transaction.amount;
    groups.set(key, summary);
  }

  const repeatedCounterparties = [...groups.values()]
    .filter((summary) => summary.count >= 3)
    .map((summary) => ({
      ...summary,
      sent: Math.round(summary.sent * 100) / 100,
      received: Math.round(summary.received * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count || (b.sent + b.received) - (a.sent + a.received))
    .slice(0, 8);

  return {
    ownAccountCandidateCount,
    ownAccountSent: Math.round(ownAccountSent * 100) / 100,
    ownAccountReceived: Math.round(ownAccountReceived * 100) / 100,
    confirmedInternalCount,
    confirmedInternalAmount: Math.round(confirmedInternalAmount * 100) / 100,
    repeatedCounterparties,
  };
}
