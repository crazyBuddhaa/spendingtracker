export type Direction = "income" | "expense";

export type Category =
  | "Income"
  | "Food & groceries"
  | "Transport"
  | "Bills & utilities"
  | "Shopping"
  | "Transfers"
  | "Health"
  | "Entertainment"
  | "Education"
  | "Other";

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  direction: Direction;
  category: Category;
  source: string;
}

export interface ImportResult {
  transactions: Transaction[];
  skipped: number;
  warnings: string[];
}

export interface SavingsContribution {
  id: string;
  date: string;
  amount: number;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  createdAt: string;
  contributions: SavingsContribution[];
}

export interface CircleEntry {
  id: string;
  date: string;
  kind: "contribution" | "payout";
  amount: number;
  turn: number;
}

export interface SavingsCircle {
  id: string;
  name: string;
  contributionAmount: number;
  intervalDays: number;
  memberCount: number;
  myPosition: number;
  currentTurn: number;
  myPayoutReceived: boolean;
  currentTurnDate: string | null;
  entries: CircleEntry[];
}

export const betCategories = [
  "Unclassified",
  "Football",
  "Basketball",
  "Tennis",
  "Volleyball",
  "Rugby",
  "Cricket",
  "Esports",
  "Other",
] as const;

export type BetCategory = typeof betCategories[number];
export type BetStatus = "won" | "lost" | "open" | "void" | "cashed-out" | "other";

export interface BetRecord {
  id: string;
  date: string;
  category: BetCategory;
  betType: string;
  status: BetStatus;
  stake: number;
  returnAmount: number;
  events: string[];
  hiddenEvents: number;
  source: string;
}

export interface BetImportResult {
  bets: BetRecord[];
  warnings: string[];
}
