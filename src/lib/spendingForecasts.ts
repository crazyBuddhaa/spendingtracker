import type { Transaction } from "../types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRAINING_WINDOW_DAYS = 90;
const MIN_REGRESSION_DAYS = 28;
const MIN_ACTIVE_EXPENSE_DAYS = 10;
const WEEKDAY_FEATURE_COUNT = 6;
const FEATURE_COUNT = 2 + WEEKDAY_FEATURE_COUNT;

export type SpendingForecastMethod = "linear-regression" | "run-rate" | "insufficient-history";

export interface SpendingForecasts {
  asOfDate: string;
  monthToDateSpending: number;
  monthHistoryDays: number;
  daysInMonth: number;
  monthEndProjection: number | null;
  recentWindowStart: string;
  recentWindowDays: number;
  recentWindowSpending: number;
  next30DayProjection: number | null;
  method: SpendingForecastMethod;
  trainingDays: number;
  activeExpenseDays: number;
  /** Change in predicted daily spending per week of elapsed time. */
  trendPerWeek: number | null;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function featuresForDay(day: number, firstTrainingDay: number): number[] {
  const weekday = new Date(day * DAY_MS).getUTCDay();
  const features = [1, (day - firstTrainingDay) / 7];
  for (let dayOfWeek = 1; dayOfWeek <= WEEKDAY_FEATURE_COUNT; dayOfWeek += 1) {
    features.push(weekday === dayOfWeek ? 1 : 0);
  }
  return features;
}

/** Solve a small dense system with partial pivoting; returns null if singular. */
function solveLinearSystem(matrix: number[][], values: number[]): number[] | null {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    if (Math.abs(augmented[pivotRow][column]) < 1e-10) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];

    const pivot = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) augmented[column][entry] /= pivot;
    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }

  const coefficients = Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    coefficients[row] = augmented[row][size]
      - augmented[row].slice(row + 1, size).reduce((sum, value, offset) => sum + value * coefficients[row + 1 + offset], 0);
  }
  return coefficients.every(Number.isFinite) ? coefficients : null;
}

function fitDailySpendingModel(
  dailySpending: Map<number, number>,
  firstTrainingDay: number,
  trainingDays: number,
  activeExpenseDays: number,
): number[] | null {
  if (trainingDays < MIN_REGRESSION_DAYS || activeExpenseDays < MIN_ACTIVE_EXPENSE_DAYS) return null;

  const matrix = Array.from({ length: FEATURE_COUNT }, () => Array<number>(FEATURE_COUNT).fill(0));
  const values = Array<number>(FEATURE_COUNT).fill(0);
  for (let offset = 0; offset < trainingDays; offset += 1) {
    const day = firstTrainingDay + offset;
    const features = featuresForDay(day, firstTrainingDay);
    const target = dailySpending.get(day) ?? 0;
    for (let row = 0; row < FEATURE_COUNT; row += 1) {
      values[row] += features[row] * target;
      for (let column = 0; column < FEATURE_COUNT; column += 1) {
        matrix[row][column] += features[row] * features[column];
      }
    }
  }
  return solveLinearSystem(matrix, values);
}

function predictDailySpending(coefficients: number[], day: number, firstTrainingDay: number): number {
  const prediction = featuresForDay(day, firstTrainingDay)
    .reduce((sum, feature, index) => sum + feature * coefficients[index], 0);
  return Math.max(0, prediction);
}

/**
 * Fits daily net spending to a linear time trend and weekday indicators using
 * up to 90 calendar days. Short or sparse histories fall back to the original
 * run-rate estimate. Forecasts exclude internal transfers and include refunds.
 */
export function getSpendingForecasts(transactions: Transaction[], asOf = new Date()): SpendingForecasts {
  const asOfDate = isoDate(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const year = asOf.getFullYear();
  const monthIndex = asOf.getMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthStart = isoDate(year, monthIndex, 1);
  const asOfDay = dayNumber(asOfDate);
  const recentWindowStart = new Date(dayNumber(asOfDate) * DAY_MS - 29 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const datedRows = transactions.filter((transaction) =>
    validDate(transaction.date) && transaction.date <= asOfDate,
  );
  const earliestDate = datedRows.reduce<string | null>(
    (earliest, transaction) => !earliest || transaction.date < earliest ? transaction.date : earliest,
    null,
  );
  const recentWindowDays = earliestDate
    ? Math.min(30, dayNumber(asOfDate) - dayNumber(earliestDate < recentWindowStart ? recentWindowStart : earliestDate) + 1)
    : 0;
  const monthHistoryStart = earliestDate && earliestDate > monthStart ? earliestDate : monthStart;
  const monthHistoryDays = earliestDate && monthHistoryStart <= asOfDate
    ? dayNumber(asOfDate) - dayNumber(monthHistoryStart) + 1
    : 0;
  const firstAvailableDay = earliestDate ? dayNumber(earliestDate) : asOfDay;
  const firstTrainingDay = Math.max(firstAvailableDay, asOfDay - TRAINING_WINDOW_DAYS + 1);
  const trainingDays = earliestDate ? asOfDay - firstTrainingDay + 1 : 0;

  let monthNet = 0;
  let recentNet = 0;
  let monthHasActivity = false;
  let recentHasActivity = false;
  const dailySpending = new Map<number, number>();
  const dailyGrossExpenses = new Map<number, number>();
  for (const transaction of datedRows) {
    if (transaction.internalTransfer || !Number.isFinite(transaction.amount) || transaction.amount <= 0) continue;
    const isExpense = transaction.direction === "expense";
    const isRefund = transaction.direction === "income" && transaction.category === "Refunds";
    if (!isExpense && !isRefund) continue;
    const signedAmount = isExpense ? transaction.amount : -transaction.amount;
    const day = dayNumber(transaction.date);
    dailySpending.set(day, (dailySpending.get(day) ?? 0) + signedAmount);
    if (isExpense) dailyGrossExpenses.set(day, (dailyGrossExpenses.get(day) ?? 0) + transaction.amount);
    if (transaction.date >= monthStart) {
      monthNet += signedAmount;
      monthHasActivity = true;
    }
    if (transaction.date >= recentWindowStart) {
      recentNet += signedAmount;
      recentHasActivity = true;
    }
  }

  const monthToDateSpending = round(Math.max(0, monthNet));
  const recentWindowSpending = round(Math.max(0, recentNet));
  const activeExpenseDays = [...dailyGrossExpenses.entries()]
    .filter(([day, amount]) => day >= firstTrainingDay && day <= asOfDay && amount > 0)
    .length;
  const coefficients = fitDailySpendingModel(dailySpending, firstTrainingDay, trainingDays, activeExpenseDays);
  const trendPerWeek = coefficients ? round(coefficients[1]) : null;
  let monthEndProjection: number | null = null;
  let next30DayProjection: number | null = null;
  let method: SpendingForecastMethod = "insufficient-history";

  if (coefficients) {
    let remainderOfMonth = 0;
    for (let day = asOfDay + 1; day <= dayNumber(isoDate(year, monthIndex, daysInMonth)); day += 1) {
      remainderOfMonth += predictDailySpending(coefficients, day, firstTrainingDay);
    }
    let next30Days = 0;
    for (let offset = 1; offset <= 30; offset += 1) {
      next30Days += predictDailySpending(coefficients, asOfDay + offset, firstTrainingDay);
    }
    monthEndProjection = round(monthToDateSpending + remainderOfMonth);
    next30DayProjection = round(next30Days);
    method = "linear-regression";
  } else {
    monthEndProjection = monthHistoryDays >= 7 && monthHasActivity
      ? round((monthToDateSpending / monthHistoryDays) * daysInMonth)
      : null;
    next30DayProjection = recentWindowDays >= 14 && recentHasActivity
      ? round((recentWindowSpending / recentWindowDays) * 30)
      : null;
    if (monthEndProjection !== null || next30DayProjection !== null) method = "run-rate";
  }

  return {
    asOfDate,
    monthToDateSpending,
    monthHistoryDays,
    daysInMonth,
    monthEndProjection,
    recentWindowStart,
    recentWindowDays,
    recentWindowSpending,
    next30DayProjection,
    method,
    trainingDays,
    activeExpenseDays,
    trendPerWeek,
  };
}
