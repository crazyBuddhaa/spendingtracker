import type { Budget, Category, RecipientProfile, Transaction } from "../types.ts";
import { counterpartyName, findRecurringPayments, getBudgetStatus, recurringCadenceLabel, type BudgetStatus } from "./analytics.ts";
import { getSmallExpenseAccumulation } from "./spendingBehaviorAnalytics.ts";
import { resolveTransactionParty } from "./recipientProfiles.ts";
import type { DateRange } from "./insights.ts";

export type IncomeSourceType =
  | "employment"
  | "business"
  | "investment"
  | "benefits"
  | "betting"
  | "personal-transfer"
  | "other";

export type ClassificationConfidence = "high" | "medium" | "low";
export type IncomeSourceOverrides = Record<string, IncomeSourceType>;

export const incomeSourceLabels: Record<IncomeSourceType, string> = {
  employment: "Employment",
  business: "Business / freelance",
  investment: "Investment returns",
  benefits: "Benefits / pension",
  betting: "Betting returns",
  "personal-transfer": "Personal transfer",
  other: "Other / unclear",
};

const incomeSourceTypes = new Set<IncomeSourceType>(Object.keys(incomeSourceLabels) as IncomeSourceType[]);

export function incomeSourceIdentity(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 160);
}

export function normaliseIncomeSourceOverrides(value: unknown): IncomeSourceOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: IncomeSourceOverrides = {};
  for (const [source, type] of Object.entries(value)) {
    const key = incomeSourceIdentity(source);
    if (key && key !== "unidentified source" && !["__proto__", "constructor", "prototype"].includes(key)
      && typeof type === "string" && incomeSourceTypes.has(type as IncomeSourceType)) {
      result[key] = type as IncomeSourceType;
    }
  }
  return result;
}

export interface IncomeSourceGroup {
  key: string;
  name: string;
  type: IncomeSourceType;
  typeLabel: string;
  amount: number;
  count: number;
  lastDate: string;
  share: number;
  confidence: ClassificationConfidence;
  manuallySet: boolean;
  canOverride: boolean;
  reason: string;
}

export interface IncomeSourceTypeTotal {
  type: IncomeSourceType;
  label: string;
  amount: number;
  count: number;
  share: number;
}

export interface IncomeSourceBreakdown {
  total: number;
  count: number;
  excludedOwnAccountCandidates: number;
  groups: IncomeSourceGroup[];
  byType: IncomeSourceTypeTotal[];
}

export interface FinancialBehaviorIndicators {
  income: number;
  /** Genuine spending: expenses excluding transfers, after refunds. */
  spending: number;
  /** Money out: spending plus transfers to other people/accounts. */
  moneyOut: number;
  /** Transfers to other people/accounts included in money out. */
  transfersOut: number;
  net: number;
  savingsRate: number | null;
  spendingToIncomePercent: number | null;
  transactionCount: number;
}

export interface RepeatedSmallPaymentGroup {
  key: string;
  name: string;
  amount: number;
  count: number;
  categories: Category[];
}

export interface FinancialLeakAnalysis {
  status: "ready" | "insufficient";
  expenseCount: number;
  smallPaymentThreshold: number | null;
  smallPaymentCount: number;
  smallPaymentTotal: number;
  repeatedSmallPaymentTotal: number;
  repeatedSmallPaymentShare: number;
  repeatedPayees: RepeatedSmallPaymentGroup[];
  recurringPayments: Array<{
    key: string;
    name: string;
    category: Category;
    cadence: string;
    occurrences: number;
    typicalAmount: number;
    monthlyCost: number;
    lastDate: string;
  }>;
  recurringMonthlyTotal: number;
}

export interface BudgetDeviation {
  category: Category;
  spent: number;
  limit: number;
  remaining: number;
  progress: number;
  projected: number | null;
  projectedDifference: number | null;
  status: "warning" | "over";
  explanation: string;
}

export interface BudgetDeviationAnalysis {
  month: string;
  budgetsChecked: number;
  deviations: BudgetDeviation[];
}

export interface ExplainableFinancialInsight {
  id: string;
  severity: "info" | "watch" | "attention";
  title: string;
  summary: string;
  evidence: string[];
}

export interface FinancialIndicatorAnalysis {
  month: string;
  behavior: FinancialBehaviorIndicators;
  leaks: FinancialLeakAnalysis;
  budget: BudgetDeviationAnalysis;
  incomeSources: IncomeSourceBreakdown;
  insights: ExplainableFinancialInsight[];
}

const round = (value: number): number => Math.round(value * 100) / 100;

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isInRange(date: string, range: DateRange): boolean {
  return isValidIsoDate(date)
    && (!range.start || date >= range.start)
    && (!range.end || date <= range.end);
}

function isExternalExpense(transaction: Transaction): boolean {
  return transaction.direction === "expense"
    && !transaction.internalTransfer
    && Number.isFinite(transaction.amount)
    && transaction.amount > 0
    && isValidIsoDate(transaction.date);
}

function sourceNameFor(transaction: Transaction, profiles: RecipientProfile[]): string {
  const party = resolveTransactionParty(transaction.description, profiles);
  return party?.name || counterpartyName(transaction.description) || "Unidentified source";
}

function classifyIncomeSource(transaction: Transaction): {
  type: IncomeSourceType;
  confidence: ClassificationConfidence;
  reason: string;
} {
  const description = transaction.description.toLowerCase();
  if (transaction.category === "Betting" || /\b(?:sportybet|bet9ja|betking|betway|1xbet|betting winnings?|stake return|winnings?)\b/i.test(description)) {
    return {
      type: "betting",
      confidence: transaction.category === "Betting" ? "high" : "medium",
      reason: transaction.category === "Betting"
        ? "The transaction is categorized as Betting."
        : "The statement description contains a betting or winnings keyword.",
    };
  }
  if (/\b(?:salary|salaries|payroll|wages|pay day|monthly pay|employer|staff pay|remuneration)\b/i.test(description)) {
    return { type: "employment", confidence: "high", reason: "The statement description contains an employment-pay keyword." };
  }
  if (/\b(?:pension|social security|government benefit|benefit payment|grant|stipend|relief payment)\b/i.test(description)) {
    return { type: "benefits", confidence: "high", reason: "The statement description contains a benefits or pension keyword." };
  }
  if (/\b(?:dividend|interest earned|investment return|mutual fund|treasury bill|bond coupon|capital gain|owealth interest)\b/i.test(description)) {
    return { type: "investment", confidence: "high", reason: "The statement description contains an investment-return keyword." };
  }
  if (transaction.category === "Business") {
    return { type: "business", confidence: "medium", reason: "The transaction is categorized as Business." };
  }
  if (/\b(?:invoice|client payment|freelance|business income|merchant settlement|sales proceeds|pos settlement|commission)\b/i.test(description)) {
    return { type: "business", confidence: "high", reason: "The statement description contains a business-income keyword." };
  }
  if (transaction.category === "Transfers" || /^transfer\s+from\b/i.test(description)) {
    return { type: "personal-transfer", confidence: "medium", reason: "The transaction is marked as a transfer; confirm it came from another person." };
  }
  return {
    type: "other",
    confidence: "low",
    reason: "No source keyword matched; this label is a low-confidence fallback, not a verified income type.",
  };
}

function confidenceRank(confidence: ClassificationConfidence): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

function lowerConfidence(a: ClassificationConfidence, b: ClassificationConfidence): ClassificationConfidence {
  return confidenceRank(a) <= confidenceRank(b) ? a : b;
}

/** Classifies external income with deterministic narration/category rules; it never edits a transaction. */
export function getIncomeSourceBreakdown(
  transactions: Transaction[],
  profiles: RecipientProfile[] = [],
  overrides: IncomeSourceOverrides = {},
): IncomeSourceBreakdown {
  const safeOverrides = normaliseIncomeSourceOverrides(overrides);
  const groups = new Map<string, IncomeSourceGroup>();
  const typeTotals = new Map<IncomeSourceType, { amount: number; count: number }>();
  let total = 0;
  let count = 0;
  let excludedOwnAccountCandidates = 0;

  for (const transaction of transactions) {
    if (transaction.direction !== "income" || transaction.category === "Refunds" || transaction.internalTransfer
      || !Number.isFinite(transaction.amount) || transaction.amount <= 0 || !isValidIsoDate(transaction.date)) continue;
    if (transaction.ownAccountCandidate) {
      excludedOwnAccountCandidates += 1;
      continue;
    }

    const name = sourceNameFor(transaction, profiles);
    const identity = incomeSourceIdentity(name);
    const canOverride = identity !== "unidentified source";
    const override = canOverride ? safeOverrides[identity] : undefined;
    const classification = override
      ? {
          type: override,
          confidence: "high" as const,
          manuallySet: true,
          reason: "You set this source label manually.",
        }
      : { ...classifyIncomeSource(transaction), manuallySet: false };
    const key = identity;
    const current = groups.get(key) ?? {
      key,
      name,
      type: classification.type,
      typeLabel: incomeSourceLabels[classification.type],
      amount: 0,
      count: 0,
      lastDate: transaction.date,
      share: 0,
      confidence: classification.confidence,
      manuallySet: classification.manuallySet,
      canOverride,
      reason: classification.reason,
    };
    current.amount += transaction.amount;
    current.count += 1;
    current.lastDate = current.lastDate > transaction.date ? current.lastDate : transaction.date;
    current.confidence = lowerConfidence(current.confidence, classification.confidence);
    current.manuallySet = current.manuallySet || classification.manuallySet;
    groups.set(key, current);

    const typeTotal = typeTotals.get(classification.type) ?? { amount: 0, count: 0 };
    typeTotal.amount += transaction.amount;
    typeTotal.count += 1;
    typeTotals.set(classification.type, typeTotal);
    total += transaction.amount;
    count += 1;
  }

  const roundedTotal = round(total);
  return {
    total: roundedTotal,
    count,
    excludedOwnAccountCandidates,
    groups: [...groups.values()]
      .map((group) => ({ ...group, amount: round(group.amount), share: total > 0 ? round((group.amount / total) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
    byType: [...typeTotals.entries()]
      .map(([type, value]) => ({
        type,
        label: incomeSourceLabels[type],
        amount: round(value.amount),
        count: value.count,
        share: total > 0 ? round((value.amount / total) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** Descriptive selected-period cashflow ratios; refunds reduce spending, not income. */
export function getFinancialBehaviorIndicators(transactions: Transaction[]): FinancialBehaviorIndicators {
  let income = 0;
  let grossSpending = 0;
  let transfersOut = 0;
  let refunds = 0;
  let transactionCount = 0;

  for (const transaction of transactions) {
    if (transaction.internalTransfer || !Number.isFinite(transaction.amount) || transaction.amount <= 0
      || !isValidIsoDate(transaction.date)) continue;
    if (transaction.direction === "expense") {
      if (transaction.category === "Transfers") transfersOut += transaction.amount;
      else grossSpending += transaction.amount;
      transactionCount += 1;
    } else if (transaction.category === "Refunds") {
      refunds += transaction.amount;
    } else {
      income += transaction.amount;
      transactionCount += 1;
    }
  }

  const spending = round(Math.max(0, grossSpending - refunds));
  const moneyOut = round(spending + transfersOut);
  const roundedIncome = round(income);
  const net = round(roundedIncome - moneyOut);
  return {
    income: roundedIncome,
    spending,
    moneyOut,
    transfersOut: round(transfersOut),
    net,
    savingsRate: roundedIncome > 0 ? round((net / roundedIncome) * 100) : null,
    spendingToIncomePercent: roundedIncome > 0 ? round((spending / roundedIncome) * 100) : null,
    transactionCount,
  };
}

/** Finds repeat low-value outflows and separately surfaces steady recurring payments. */
export function getFinancialLeakAnalysis(
  transactions: Transaction[],
  range: DateRange = { start: null, end: null },
  profiles: RecipientProfile[] = [],
): FinancialLeakAnalysis {
  const expenses = transactions.filter((transaction) => isExternalExpense(transaction) && isInRange(transaction.date, range));
  const small = getSmallExpenseAccumulation(expenses);
  const lowValueExpenses = small.threshold === null
    ? []
    : expenses.filter((transaction) => transaction.amount <= small.threshold!);
  const groups = new Map<string, RepeatedSmallPaymentGroup>();
  for (const transaction of lowValueExpenses) {
    const party = resolveTransactionParty(transaction.description, profiles);
    const name = party?.name || counterpartyName(transaction.description) || transaction.category;
    const key = name.toLocaleLowerCase();
    const current = groups.get(key) ?? { key, name, amount: 0, count: 0, categories: [] };
    current.amount += transaction.amount;
    current.count += 1;
    if (!current.categories.includes(transaction.category)) current.categories.push(transaction.category);
    groups.set(key, current);
  }

  const repeatedPayees = [...groups.values()]
    .filter((group) => group.count >= 3)
    .map((group) => ({ ...group, amount: round(group.amount), categories: [...group.categories].sort() }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count)
    .slice(0, 5);
  const repeatedSmallPaymentTotal = round(repeatedPayees.reduce((sum, group) => sum + group.amount, 0));

  const recurringPayments = findRecurringPayments(transactions, profiles)
    .filter((payment) => isInRange(payment.lastDate, range))
    .map((payment) => ({
      key: payment.key,
      name: payment.name,
      category: payment.category,
      cadence: recurringCadenceLabel(payment.cadence),
      occurrences: payment.occurrences,
      typicalAmount: payment.typicalAmount,
      monthlyCost: payment.monthlyCost,
      lastDate: payment.lastDate,
    }))
    .sort((a, b) => b.monthlyCost - a.monthlyCost);

  return {
    status: expenses.length >= 8 ? "ready" : "insufficient",
    expenseCount: expenses.length,
    smallPaymentThreshold: small.threshold,
    smallPaymentCount: small.smallTransactionCount,
    smallPaymentTotal: small.smallSpend,
    repeatedSmallPaymentTotal,
    repeatedSmallPaymentShare: small.totalSpend > 0 ? round((repeatedSmallPaymentTotal / small.totalSpend) * 100) : 0,
    repeatedPayees,
    recurringPayments,
    recurringMonthlyTotal: round(recurringPayments.reduce((sum, payment) => sum + payment.monthlyCost, 0)),
  };
}

export function getBudgetDeviationAnalysis(
  transactions: Transaction[],
  budgets: Budget[],
  month: string,
  today = new Date(),
): BudgetDeviationAnalysis {
  const statuses = getBudgetStatus(transactions, budgets, month, today);
  const deviations = statuses.filter(
    (status): status is BudgetStatus & { status: "warning" | "over" } => status.status !== "ok",
  );
  return {
    month,
    budgetsChecked: statuses.length,
    deviations: deviations.map((status) => {
        const projectedDifference = status.projected === null ? null : round(status.projected - status.limit);
        const explanation = status.status === "over"
          ? `Recorded spending is ${round(status.spent - status.limit).toLocaleString("en-NG")} above the monthly limit.`
          : projectedDifference !== null && projectedDifference > 0
            ? `At the current daily pace, spending is projected to finish ${projectedDifference.toLocaleString("en-NG")} above the limit.`
            : `Recorded spending has used ${Math.round(status.progress * 100)}% of the monthly limit.`;
        return {
          category: status.category,
          spent: status.spent,
          limit: status.limit,
          remaining: status.remaining,
          progress: status.progress,
          projected: status.projected,
          projectedDifference,
          status: status.status,
          explanation,
        };
      }),
  };
}

function buildExplainableInsights(
  behavior: FinancialBehaviorIndicators,
  leaks: FinancialLeakAnalysis,
  budget: BudgetDeviationAnalysis,
  incomeSources: IncomeSourceBreakdown,
): ExplainableFinancialInsight[] {
  const insights: ExplainableFinancialInsight[] = [];
  if (behavior.income > 0 && behavior.spending > behavior.income) {
    insights.push({
      id: "spending-above-income",
      severity: "attention",
      title: "Recorded spending exceeded recorded income",
      summary: "The recorded outflow is larger than the recorded inflow for the selected dates.",
      evidence: [
        `Income recorded: ${behavior.income}.`,
        `Spending after refunds: ${behavior.spending}.`,
        `Difference: ${behavior.spending - behavior.income} more spent than recorded as income.`,
        ...(behavior.transfersOut > 0 ? [`Transfers to other accounts: ${behavior.transfersOut}; money out: ${behavior.moneyOut}.`] : []),
      ],
    });
  } else if (behavior.income > 0 && behavior.moneyOut > behavior.income && behavior.transfersOut > 0) {
    insights.push({
      id: "money-out-above-income",
      severity: "watch",
      title: "Recorded money out exceeded recorded income",
      summary: "Transfers to other people or accounts account for the difference; genuine spending stayed within income.",
      evidence: [
        `Income recorded: ${behavior.income}.`,
        `Spending after refunds: ${behavior.spending}.`,
        `Transfers to other accounts: ${behavior.transfersOut}.`,
        `Money out: ${behavior.moneyOut}.`,
      ],
    });
  } else if (behavior.spendingToIncomePercent !== null && behavior.spendingToIncomePercent >= 80) {
    insights.push({
      id: "high-spend-share",
      severity: "watch",
      title: "Most recorded income went to spending",
      summary: "This is a ratio of the imported transactions, not a complete measure of savings or financial health.",
      evidence: [
        `${behavior.spendingToIncomePercent}% of recorded income is matched by spending after refunds.`,
        `Income: ${behavior.income}; spending: ${behavior.spending}.`,
      ],
    });
  }

  if (budget.deviations.length) {
    const over = budget.deviations.filter((item) => item.status === "over").length;
    const projectedOver = budget.deviations.filter((item) => item.status === "warning" && item.projectedDifference !== null && item.projectedDifference > 0).length;
    insights.push({
      id: "budget-deviation",
      severity: over ? "attention" : "watch",
      title: over
        ? `${over} budget${over === 1 ? "" : "s"} already over limit`
        : `${budget.deviations.length} budget${budget.deviations.length === 1 ? "" : "s"} need attention`,
      summary: projectedOver
        ? `${projectedOver} ${projectedOver === 1 ? "is" : "are"} also projected to exceed the limit if the current pace continues.`
        : "The category-by-category figures show whether the flag is actual spending or a current-pace projection.",
      evidence: budget.deviations.slice(0, 3).map((item) =>
        `${item.category}: ${item.explanation} (${Math.round(item.progress * 100)}% used).`),
    });
  }

  if (leaks.repeatedPayees.length) {
    const top = leaks.repeatedPayees[0];
    insights.push({
      id: "repeat-small-payments",
      severity: "info",
      title: "Repeated small payments add up",
      summary: "Payees are flagged only when at least three payments fall within this period's lowest-value quarter.",
      evidence: [
        `${top.name}: ${top.count} lower-value payments totaling ${top.amount}.`,
        `${leaks.repeatedSmallPaymentTotal} across the repeated-payee groups shown.`,
        leaks.smallPaymentThreshold === null
          ? "No low-payment threshold could be estimated."
          : `The period's lower-quartile cutoff is ${leaks.smallPaymentThreshold}.`,
      ],
    });
  }

  const largestSource = incomeSources.groups[0];
  if (largestSource && incomeSources.groups.length > 1 && largestSource.share >= 70) {
    insights.push({
      id: "income-source-concentration",
      severity: "info",
      title: "Recorded income is concentrated in one source",
      summary: "The source mix is based on transaction descriptions and categories; the labels are estimates.",
      evidence: [
        `${largestSource.name} is ${largestSource.share}% of classified income.`,
        `${incomeSources.groups.length} source entries were identified.`,
        `The leading label is ${largestSource.typeLabel} (${largestSource.confidence} confidence): ${largestSource.reason}`,
      ],
    });
  }

  return insights;
}

/** Builds the full local-only view for Insights, anchored to the selected period's latest month. */
export function getFinancialIndicatorAnalysis(
  transactions: Transaction[],
  range: DateRange,
  budgets: Budget[],
  profiles: RecipientProfile[] = [],
  today = new Date(),
  incomeSourceOverrides: IncomeSourceOverrides = {},
): FinancialIndicatorAnalysis {
  const selected = transactions.filter((transaction) => isInRange(transaction.date, range));
  const latestDate = selected.map((transaction) => transaction.date).filter(isValidIsoDate).sort().at(-1);
  const month = range.end?.slice(0, 7) ?? latestDate?.slice(0, 7)
    ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const behavior = getFinancialBehaviorIndicators(selected);
  const leaks = getFinancialLeakAnalysis(transactions, range, profiles);
  const budget = getBudgetDeviationAnalysis(transactions, budgets, month, today);
  const incomeSources = getIncomeSourceBreakdown(selected, profiles, incomeSourceOverrides);
  return {
    month,
    behavior,
    leaks,
    budget,
    incomeSources,
    insights: buildExplainableInsights(behavior, leaks, budget, incomeSources),
  };
}
