import type { SavingsContribution, SavingsGoal } from "../types.ts";

export interface SavingsSummary {
  saved: number;
  target: number;
  remaining: number;
  progress: number;
}

export function normaliseSavingsGoals(value: unknown): SavingsGoal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SavingsGoal[] => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.targetAmount !== "number" ||
      !Number.isFinite(entry.targetAmount) ||
      entry.targetAmount <= 0 ||
      typeof entry.createdAt !== "string" ||
      !Array.isArray(entry.contributions)
    ) {
      return [];
    }

    const contributions = entry.contributions.filter(
      (item: unknown): item is SavingsContribution =>
        !!item &&
        typeof item === "object" &&
        "id" in item &&
        typeof item.id === "string" &&
        "date" in item &&
        typeof item.date === "string" &&
        "amount" in item &&
        typeof item.amount === "number" &&
        Number.isFinite(item.amount) &&
        item.amount > 0,
    );

    return [{
      id: entry.id,
      name: entry.name.trim().slice(0, 60) || "Savings goal",
      targetAmount: entry.targetAmount,
      createdAt: entry.createdAt,
      contributions,
    }];
  });
}

export function savedForGoal(goal: SavingsGoal): number {
  return goal.contributions.reduce((total, contribution) => total + contribution.amount, 0);
}

export function savingsSummary(goals: SavingsGoal[]): SavingsSummary {
  const saved = goals.reduce((total, goal) => total + savedForGoal(goal), 0);
  const target = goals.reduce((total, goal) => total + goal.targetAmount, 0);
  return {
    saved,
    target,
    remaining: Math.max(target - saved, 0),
    progress: target > 0 ? Math.min(saved / target, 1) : 0,
  };
}
