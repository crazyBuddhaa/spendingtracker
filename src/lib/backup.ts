import { categoryList, type AccountPreferences, type BetRecord, type Budget, type Category, type CategoryRule, type MutationEntry, type RecipientProfile, type RecurringBill, type SavingsCircle, type SavingsGoal, type StatementSnapshot, type Transaction } from "../types.ts";
import { normaliseAccountPreferences } from "./accounts.ts";
import { normaliseRecurringBills } from "./recurringBills.ts";
import { normaliseBets } from "./sportyBetImport.ts";
import { normaliseSavingsCircles } from "./savingsCircles.ts";
import { normaliseSavingsGoals } from "./savings.ts";
import { parseStoredTransactions, serializeTransactions } from "./transactionStorage.ts";
import { normaliseRecipientProfiles } from "./recipientProfiles.ts";
import { normaliseIncomeSourceOverrides, type IncomeSourceOverrides } from "./financialIndicators.ts";
import { MUTATION_LOG_LIMIT, normaliseMutationLog, normaliseStatementSnapshots } from "./reconciliation.ts";
import { normaliseInvestments, type InvestmentStore } from "./investments.ts";
import { normaliseBettingLinks, type BettingLink } from "./bettingLinks.ts";

export const BACKUP_FORMAT = "spendwise.backup.v1";

export interface BackupData {
  transactions: Transaction[];
  savingsGoals: SavingsGoal[];
  savingsCircles: SavingsCircle[];
  bets: BetRecord[];
  rules: CategoryRule[];
  budgets: Budget[];
  recipientProfiles?: RecipientProfile[];
  recurringBills?: RecurringBill[];
  accountPreferences?: AccountPreferences;
  incomeSourceOverrides?: IncomeSourceOverrides;
  /** Starting balance used by the cash-flow projection on the Bills page. */
  projectionOpeningBalance?: number;
  /** Declared statement periods used by the reconciliation engine. */
  statementSnapshots?: StatementSnapshot[];
  /** Append-only local audit trail. */
  mutationLog?: MutationEntry[];
  /** Manual investment ledger and the value marks that go with it. */
  investments?: InvestmentStore;
  /** Confirmed bet-ledger ↔ bank-row links for the betting correlation panel. */
  bettingLinks?: BettingLink[];
}

const validCategories = new Set<string>(categoryList);

export function normaliseRules(value: unknown): CategoryRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): CategoryRule[] => {
    if (!entry || typeof entry !== "object") return [];
    const rule = entry as Partial<CategoryRule>;
    if (typeof rule.id !== "string" || typeof rule.pattern !== "string" || !rule.pattern.trim()) return [];
    if (typeof rule.category !== "string" || !validCategories.has(rule.category)) return [];
    return [{
      id: rule.id,
      pattern: rule.pattern.trim().toLowerCase().slice(0, 120),
      category: rule.category as Category,
      direction: rule.direction === "income" || rule.direction === "expense" ? rule.direction : undefined,
      markInternal: rule.markInternal === true || undefined,
      ...(rule.matchType === "contains" || rule.matchType === "startsWith" || rule.matchType === "exact" || rule.matchType === "merchant" || rule.matchType === "counterparty"
        ? { matchType: rule.matchType }
        : {}),
      createdAt: typeof rule.createdAt === "string" ? rule.createdAt : "",
    }];
  });
}

export function normaliseBudgets(value: unknown): Budget[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): Budget[] => {
    if (!entry || typeof entry !== "object") return [];
    const budget = entry as Partial<Budget>;
    if (typeof budget.category !== "string" || !validCategories.has(budget.category) || seen.has(budget.category)) return [];
    if (typeof budget.monthlyLimit !== "number" || !Number.isFinite(budget.monthlyLimit) || budget.monthlyLimit <= 0) return [];
    seen.add(budget.category);
    return [{ category: budget.category as Category, monthlyLimit: budget.monthlyLimit }];
  });
}

export function createBackup(data: BackupData, now = new Date()): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    transactions: JSON.parse(serializeTransactions(data.transactions)),
    savingsGoals: data.savingsGoals,
    savingsCircles: data.savingsCircles,
    bets: data.bets,
    rules: data.rules,
    budgets: data.budgets,
    recipientProfiles: normaliseRecipientProfiles(data.recipientProfiles),
    recurringBills: normaliseRecurringBills(data.recurringBills),
    accountPreferences: normaliseAccountPreferences(data.accountPreferences),
    incomeSourceOverrides: normaliseIncomeSourceOverrides(data.incomeSourceOverrides),
    projectionOpeningBalance: finiteOrZero(data.projectionOpeningBalance),
    statementSnapshots: normaliseStatementSnapshots(data.statementSnapshots),
    mutationLog: normaliseMutationLog(data.mutationLog).slice(-MUTATION_LOG_LIMIT),
    investments: normaliseInvestments(data.investments),
    bettingLinks: normaliseBettingLinks(data.bettingLinks),
  });
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Parses a backup file; returns null when the file is not a Spendwise backup. */
export function readBackup(text: string): BackupData | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || (value as { format?: unknown }).format !== BACKUP_FORMAT) return null;
  const backup = value as Record<string, unknown>;
  return {
    transactions: parseStoredTransactions(JSON.stringify(backup.transactions ?? [])),
    savingsGoals: normaliseSavingsGoals(backup.savingsGoals),
    savingsCircles: normaliseSavingsCircles(backup.savingsCircles),
    bets: normaliseBets(backup.bets),
    rules: normaliseRules(backup.rules),
    budgets: normaliseBudgets(backup.budgets),
    recipientProfiles: normaliseRecipientProfiles(backup.recipientProfiles),
    recurringBills: normaliseRecurringBills(backup.recurringBills),
    accountPreferences: normaliseAccountPreferences(backup.accountPreferences),
    incomeSourceOverrides: normaliseIncomeSourceOverrides(backup.incomeSourceOverrides),
    projectionOpeningBalance: finiteOrZero(backup.projectionOpeningBalance),
    statementSnapshots: normaliseStatementSnapshots(backup.statementSnapshots),
    mutationLog: normaliseMutationLog(backup.mutationLog),
    investments: normaliseInvestments(backup.investments),
    bettingLinks: normaliseBettingLinks(backup.bettingLinks),
  };
}
