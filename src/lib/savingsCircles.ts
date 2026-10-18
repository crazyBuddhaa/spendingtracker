import type { CircleEntry, SavingsCircle } from "../types.ts";

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normaliseEntry(value: unknown, memberCount: number): CircleEntry | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("date" in value) ||
    typeof value.date !== "string" ||
    !validDate(value.date) ||
    !("kind" in value) ||
    (value.kind !== "contribution" && value.kind !== "payout") ||
    !("amount" in value) ||
    typeof value.amount !== "number" ||
    !Number.isFinite(value.amount) ||
    value.amount <= 0 ||
    !("turn" in value) ||
    typeof value.turn !== "number" ||
    !Number.isInteger(value.turn) ||
    value.turn < 1 ||
    value.turn > memberCount
  ) return null;

  return { id: value.id, date: value.date, kind: value.kind, amount: value.amount, turn: value.turn };
}

export function normaliseSavingsCircles(value: unknown): SavingsCircle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SavingsCircle[] => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.contributionAmount !== "number" ||
      !Number.isFinite(entry.contributionAmount) ||
      entry.contributionAmount <= 0 ||
      typeof entry.intervalDays !== "number" ||
      !Number.isInteger(entry.intervalDays) ||
      entry.intervalDays < 1 ||
      typeof entry.memberCount !== "number" ||
      !Number.isInteger(entry.memberCount) ||
      entry.memberCount < 2 ||
      typeof entry.myPosition !== "number" ||
      !Number.isInteger(entry.myPosition) ||
      entry.myPosition < 1 ||
      entry.myPosition > entry.memberCount ||
      typeof entry.currentTurn !== "number" ||
      !Number.isInteger(entry.currentTurn) ||
      entry.currentTurn < 1 ||
      entry.currentTurn > entry.memberCount ||
      typeof entry.myPayoutReceived !== "boolean" ||
      !Array.isArray(entry.entries)
    ) return [];

    const currentTurnDate = typeof entry.currentTurnDate === "string" && validDate(entry.currentTurnDate)
      ? entry.currentTurnDate
      : null;
    return [{
      id: entry.id,
      name: entry.name.trim().slice(0, 60) || "Savings circle",
      contributionAmount: entry.contributionAmount,
      intervalDays: entry.intervalDays,
      memberCount: entry.memberCount,
      myPosition: entry.myPosition,
      currentTurn: entry.currentTurn,
      myPayoutReceived: entry.myPayoutReceived,
      currentTurnDate,
      entries: entry.entries.flatMap((item: unknown) => {
        const normalised = normaliseEntry(item, entry.memberCount);
        return normalised ? [normalised] : [];
      }),
    }];
  });
}

export interface SavingsCircleSummary {
  payoutAmount: number;
  cycleDays: number;
  turnsUntilNextPayout: number;
  daysUntilNextPayout: number;
  expectedPayoutDate: string | null;
  totalContributed: number;
  totalCollected: number;
  netRecorded: number;
  contributionCount: number;
  payoutCount: number;
}

export function savingsCircleSummary(circle: SavingsCircle): SavingsCircleSummary {
  let turnsUntilNextPayout = (circle.myPosition - circle.currentTurn + circle.memberCount) % circle.memberCount;
  if (turnsUntilNextPayout === 0 && circle.myPayoutReceived) {
    turnsUntilNextPayout = circle.memberCount;
  }
  const daysUntilNextPayout = turnsUntilNextPayout * circle.intervalDays;
  let expectedPayoutDate: string | null = null;
  if (circle.currentTurnDate) {
    const date = new Date(`${circle.currentTurnDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + daysUntilNextPayout);
    expectedPayoutDate = date.toISOString().slice(0, 10);
  }

  const contributions = circle.entries.filter((entry) => entry.kind === "contribution");
  const payouts = circle.entries.filter((entry) => entry.kind === "payout");
  const totalContributed = contributions.reduce((total, entry) => total + entry.amount, 0);
  const totalCollected = payouts.reduce((total, entry) => total + entry.amount, 0);
  return {
    payoutAmount: circle.contributionAmount * circle.memberCount,
    cycleDays: circle.intervalDays * circle.memberCount,
    turnsUntilNextPayout,
    daysUntilNextPayout,
    expectedPayoutDate,
    totalContributed,
    totalCollected,
    netRecorded: totalCollected - totalContributed,
    contributionCount: contributions.length,
    payoutCount: payouts.length,
  };
}
