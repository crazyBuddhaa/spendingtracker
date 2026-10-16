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
