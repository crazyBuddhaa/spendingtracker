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
  /**
   * True for records reconstructed by reconciliation. Inferred rows are never
   * presented as original imported data and stay flagged until the user verifies them.
   */
  inferred?: boolean;
}

/** A declared statement period entered or captured for one account, used to detect missing or unexplained money movements. */
export interface StatementSnapshot {
  id: string;
  /** Account label matching transaction.source. */
  account: string;
  periodStart: string;
  periodEnd: string;
  openingBalance?: number;
  closingBalance?: number;
  /** Money in as printed by the statement itself, when known. */
  declaredTotalIn?: number;
  /** Money out as printed by the statement itself, when known. */
  declaredTotalOut?: number;
  /** How this snapshot entered the browser. */
  recordedBy: "manual" | "import";
  createdAt: string;
  note?: string;
}

/** Where each local change came from, so corrections and matching decisions can be traced later. */
export type MutationKind =
  | "import"
  | "add"
  | "inferred-add"
  | "verify"
  | "update"
  | "delete"
  | "clear"
  | "restore";

export interface MutationEntry {
  id: string;
  /** ISO timestamp of when the change happened. */
  at: string;
  kind: MutationKind;
  /** Human-readable explanation of what changed and why. */
  detail: string;
  transactionIds?: string[];
  /** Optional supporting evidence, such as the affected file names or reclassification range. */
  evidence?: string;
}

/** A user-managed identity that joins statement-name variants for one payee or payer. */
export interface RecipientProfile {
  id: string;
  kind: TransactionPartyKind;
  name: string;
  aliases: string[];
  relationship?: string;
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

export type BillFrequency = "weekly" | "monthly" | "yearly";

/** A locally managed recurring commitment. Projections never create transactions automatically. */
export interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  direction: Direction;
  category: Category;
  account: string;
  currency: string;
  frequency: BillFrequency;
  nextDueDate: string;
  paused?: boolean;
  note?: string;
}

/** Per-account native currencies and optional manual rates to one display currency. */
export interface AccountPreferences {
  accountCurrencies: Record<string, string>;
  displayCurrency: string;
  showConverted: boolean;
  rates: Record<string, number>;
}

export const supportedCurrencies = ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR", "CAD"] as const;

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

/* ------------------------------------------------ investments (own model) */

export const investmentAssetTypes = [
  "Stocks",
  "ETFs & mutual funds",
  "Crypto",
  "Bonds & treasury bills",
  "Fixed savings",
  "Real estate",
  "Commodities",
  "Other",
] as const;

export type InvestmentAssetType = typeof investmentAssetTypes[number];

export const investmentActions = ["buy", "sell", "income", "fee"] as const;

export type InvestmentAction = typeof investmentActions[number];

export const investmentActionLabels: Record<InvestmentAction, string> = {
  buy: "Bought",
  sell: "Sold",
  income: "Interest / dividend",
  fee: "Fee",
};

/** One local ledger event for one holding. Amounts are magnitudes; the action says which way the cash moved. */
export interface InvestmentRecord {
  id: string;
  date: string;
  assetType: InvestmentAssetType;
  /** The holding itself, e.g. “GTB shares” or “NGN 91-day treasury bill”. */
  asset: string;
  action: InvestmentAction;
  /** Positive cash magnitude for the event. */
  amount: number;
  units?: number;
  pricePerUnit?: number;
  /** Platform or broker label. */
  broker: string;
  note?: string;
}

/** A manual mark of what a holding is worth today; the app never fetches live prices. */
export interface InvestmentValuation {
  id: string;
  asset: string;
  marketValue: number;
  asOf: string;
  note?: string;
}

export interface InvestmentStore {
  records: InvestmentRecord[];
  valuations: InvestmentValuation[];
}
