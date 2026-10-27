import { categoryList, supportedCurrencies, type RecurringBill } from "../types.ts";

const validCategories = new Set<string>(categoryList);
const validCurrencies = new Set<string>(supportedCurrencies);

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dateFromDay(dayNumber(value) ?? Number.NaN) === value;
}

export function dayNumber(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : Number.NaN;
}

export function dateFromDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return dateFromDay(dayNumber(date) + days);
}

export function advanceDueDate(date: string, frequency: RecurringBill["frequency"]): string {
  if (frequency === "weekly") return addDays(date, 7);
  const [year, month, day] = date.split("-").map(Number);
  const monthStep = frequency === "monthly" ? 1 : 12;
  const targetMonthIndex = month - 1 + monthStep;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear.toString().padStart(4, "0")}-${(targetMonth + 1).toString().padStart(2, "0")}-${Math.min(day, lastDay).toString().padStart(2, "0")}`;
}

export function normaliseRecurringBills(value: unknown): RecurringBill[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RecurringBill[] => {
    if (!entry || typeof entry !== "object") return [];
    const bill = entry as Partial<RecurringBill>;
    if (typeof bill.id !== "string" || typeof bill.name !== "string" || !bill.name.trim()) return [];
    if (typeof bill.amount !== "number" || !Number.isFinite(bill.amount) || bill.amount <= 0) return [];
    if (!validDate(bill.nextDueDate)) return [];
    return [{
      id: bill.id,
      name: bill.name.trim().slice(0, 100),
      amount: Math.round(bill.amount * 100) / 100,
      direction: bill.direction === "income" ? "income" : "expense",
      category: typeof bill.category === "string" && validCategories.has(bill.category) ? bill.category : "Bills & utilities",
      account: typeof bill.account === "string" && bill.account.trim() ? bill.account.trim().slice(0, 50) : "Cash",
      currency: typeof bill.currency === "string" && validCurrencies.has(bill.currency) ? bill.currency : "NGN",
      frequency: bill.frequency === "weekly" || bill.frequency === "yearly" ? bill.frequency : "monthly",
      nextDueDate: bill.nextDueDate,
      paused: bill.paused === true || undefined,
      note: typeof bill.note === "string" && bill.note.trim() ? bill.note.trim().slice(0, 240) : undefined,
    }];
  });
}

export interface BillOccurrence {
  key: string;
  bill: RecurringBill;
  date: string;
}

/** All active occurrences in an inclusive date window, including several occurrences of one bill. */
export function getBillOccurrences(bills: RecurringBill[], start: string, end: string): BillOccurrence[] {
  if (!validDate(start) || !validDate(end) || start > end) return [];
  const occurrences: BillOccurrence[] = [];
  for (const bill of bills) {
    if (bill.paused || !validDate(bill.nextDueDate)) continue;
    let date = bill.nextDueDate;
    let guard = 0;
    // Move forward from the next user-confirmed due date; past dates stay out of projections.
    while (date <= end && guard < 500) {
      if (date >= start) occurrences.push({ key: `${bill.id}-${date}`, bill, date });
      date = advanceDueDate(date, bill.frequency);
      guard += 1;
    }
  }
  return occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.bill.name.localeCompare(b.bill.name));
}

export interface ProjectionPoint {
  date: string;
  balance: number;
  income: number;
  expenses: number;
  occurrences: BillOccurrence[];
}

export function projectCashFlow(
  bills: RecurringBill[],
  startDate: string,
  startingBalance: number,
  days: number,
  convert: (amount: number, currency: string) => number | null = (amount) => amount,
): { points: ProjectionPoint[]; totalIncome: number; totalExpenses: number; skipped: RecurringBill[] } {
  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  const end = addDays(startDate, safeDays - 1);
  const skipped = new Map<string, RecurringBill>();
  const occurrences = getBillOccurrences(bills, startDate, end).filter(({ bill }) => {
    if (convert(1, bill.currency) !== null) return true;
    skipped.set(bill.id, bill);
    return false;
  });
  let balance = startingBalance;
  let totalIncome = 0;
  let totalExpenses = 0;
  const points: ProjectionPoint[] = [];
  for (let index = 0; index < safeDays; index += 1) {
    const date = addDays(startDate, index);
    const daily = occurrences.filter((item) => item.date === date);
    let income = 0;
    let expenses = 0;
    for (const item of daily) {
      const amount = convert(item.bill.amount, item.bill.currency) ?? 0;
      if (item.bill.direction === "income") income += amount;
      else expenses += amount;
    }
    balance += income - expenses;
    totalIncome += income;
    totalExpenses += expenses;
    points.push({ date, balance, income, expenses, occurrences: daily });
  }
  return { points, totalIncome, totalExpenses, skipped: [...skipped.values()] };
}
