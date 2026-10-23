export type Direction = "income" | "expense";
export type TransactionPartyKind = "merchant" | "recipient" | "sender";

export const categoryList = [
  "Income",
  "Refunds",
  "Food & groceries",
  "Transport",
  "Bills & utilities",
  "Airtime & data",
  "Shopping",
  "Rent & housing",
  "Business",
  "Cash withdrawal",
  "Transfers",
  "Betting",
  "Bank fees",
  "Health",
  "Entertainment",
  "Education",
  "Other",
] as const;

export type Category = typeof categoryList[number];

export type CategoryRuleMatchType = "contains" | "startsWith" | "exact" | "merchant" | "counterparty";

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  direction: Direction;
  category: Category;
  source: string;
  internalTransfer?: boolean;
  ownAccountCandidate?: boolean;
  /** Time of day (HH:MM or HH:MM:SS) when the statement provides it. */
  time?: string;
  /** Free-text note added by the user. */
  note?: string;
  /** True for entries typed in by hand rather than imported. */
  manual?: boolean;
  /** True once the user has chosen the category; automatic rules no longer change it. */
  categoryLocked?: boolean;
  /** The category suggestion explicitly rejected by the user, retained for local learning. */
  rejectedSuggestion?: Category;
}

/** A user-managed identity that joins statement-name variants for one payee or payer. */
export interface RecipientProfile {
  id: string;
  kind: TransactionPartyKind;
  name: string;
  aliases: string[];
  category?: Category;
  note?: string;
}

export interface CategoryRule {
  id: string;
  /** Lower-case text that must appear in the transaction description. */
  pattern: string;
  category: Category;
  /** Restrict the rule to money in or money out. */
  direction?: Direction;
  /** How to compare the pattern with transaction descriptions or recognized parties. Omitted means legacy contains matching. */
  matchType?: CategoryRuleMatchType;
  /** Also exclude matching transactions from income/spending totals. */
  markInternal?: boolean;
  createdAt: string;
}

export interface Budget {
  category: Category;
  monthlyLimit: number;
}

export interface ImportResult {
  transactions: Transaction[];
  skipped: number;
  warnings: string[];
  diagnostics?: ImportDiagnostics;
}

export interface ImportDiagnostics {
  /** Non-empty data rows the parser attempted after locating a statement header. */
  scannedRows: number;
  validRows: number;
  invalidRows: number;
  missingDateRows: number;
  invalidDateRows: number;
  ambiguousDateRows: number;
  headerDetected: boolean;
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
