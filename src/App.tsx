import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  DatabaseBackup,
  Download,
  FileText,
  Filter,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  Menu,
  PiggyBank,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Ticket,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { transactionsToCsv } from "./lib/csv";
import { parseStatementFile } from "./lib/statementImport";
import { parseStoredTransactions, serializeTransactions, TRANSACTIONS_STORAGE_KEY } from "./lib/transactionStorage";
import { findNewTransactions } from "./lib/transactionDeduplication";
import { buildImportPreview, type ImportDateRange, type ImportMode, type ImportPreview } from "./lib/importPreview";
import { getTransferInsights } from "./lib/transactionPatterns";
import { readValue, writeValue } from "./lib/persistentStore";
import { applyCategoryRules, categorise, recogniseTransactionParty, refreshCategories, ruleMatches, similarityKey } from "./lib/categorise";
import { classifyTransaction, getSimilarTransactionCounts } from "./lib/transactionIntelligence";
import { createBackup, normaliseBudgets, normaliseRules, readBackup } from "./lib/backup";
import { getFeeSummary } from "./lib/analytics";
import { downloadFile, formatCurrency, formatDate, localIsoDate, newId } from "./lib/format";
import SavingsPage from "./SavingsPage";
import BettingPage from "./BettingPage";
import BudgetsPage from "./BudgetsPage";
import DataPage from "./DataPage";
import InsightsExtras from "./InsightsExtras";
import { useAccessAuth, type AccessStatus } from "./useAccessAuth";
import { normaliseSavingsGoals } from "./lib/savings";
import { normaliseSavingsCircles } from "./lib/savingsCircles";
import { normaliseBets } from "./lib/sportyBetImport";
import { parseBettingFile } from "./lib/bettingFileImport";
import {
  calculateTotals,
  filterByRange,
  getCategoryTotals,
  getMonthlySeries,
  previousRange,
  resolvePeriod,
  type DateRange,
  type MonthTotal,
  type Period,
} from "./lib/insights";
import {
  categoryList,
  type BetCategory,
  type BetRecord,
  type Budget,
  type Category,
  type CategoryRule,
  type Direction,
  type ImportDiagnostics,
  type SavingsCircle,
  type SavingsContribution,
  type SavingsGoal,
  type Transaction,
} from "./types";

const SAVINGS_STORAGE_KEY = "spendwise.savings-goals.v1";
const CIRCLES_STORAGE_KEY = "spendwise.savings-circles.v1";
const BETS_STORAGE_KEY = "spendwise.bets.v1";
const RULES_STORAGE_KEY = "spendwise.rules.v1";
const BUDGETS_STORAGE_KEY = "spendwise.budgets.v1";
const PERIOD_STORAGE_KEY = "spendwise.period.v1";
const currency = "NGN";

type Page = "overview" | "transactions" | "insights" | "budgets" | "savings" | "betting" | "data";

interface PendingStatementImport {
  transactions: Transaction[];
  skipped: number;
  diagnostics: ImportDiagnostics;
  diagnosticsAvailable: boolean;
  warnings: string[];
  files: File[];
}

const pageTitles: Record<Page, string> = {
  overview: "Overview",
  transactions: "Transactions",
  insights: "Insights",
  budgets: "Budgets",
  savings: "Savings",
  betting: "Betting",
  data: "Data & rules",
};

const periodOptions: { value: Period; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "12m", label: "Last 12 months" },
  { value: "this-year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom dates…" },
];

const categoryColors: Record<Category, string> = {
  Income: "#317a60",
  Refunds: "#58a37f",
  "Food & groceries": "#e5aa51",
  Transport: "#8d7bd1",
  "Bills & utilities": "#5da1a0",
  "Airtime & data": "#4f9bd0",
  Shopping: "#e17e73",
  "Rent & housing": "#a7745a",
  Business: "#3f6f8f",
  "Cash withdrawal": "#c9a227",
  Transfers: "#7b8c93",
  Betting: "#d47f57",
  "Bank fees": "#9a8b7a",
  Health: "#c56f91",
  Entertainment: "#5286b6",
  Education: "#b99557",
  Other: "#a6aaa4",
};

function readJson<T>(key: string, normalise: (value: unknown) => T, fallback: T): T {
  try {
    return normalise(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readStoredPeriod(): { period: Period; custom: DateRange } {
  return readJson(PERIOD_STORAGE_KEY, (value) => {
    const stored = value as { period?: unknown; custom?: { start?: unknown; end?: unknown } } | null;
    const period = periodOptions.some((option) => option.value === stored?.period) ? stored!.period as Period : "30d";
    const start = typeof stored?.custom?.start === "string" ? stored.custom.start : null;
    const end = typeof stored?.custom?.end === "string" ? stored.custom.end : null;
    return { period, custom: { start, end } };
  }, { period: "30d" as Period, custom: { start: null, end: null } });
}

function initialLetter(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || "B";
}

interface Change {
  text: string;
  direction: "up" | "down" | null;
}

function relativeChange(current: number, previous: number): Change {
  if (previous === 0) return { text: current === 0 ? "No change" : "Nothing in the previous period", direction: null };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { text: "About the same as previous", direction: null };
  return { text: `${change > 0 ? "+" : ""}${Math.round(change)}% vs previous period`, direction: change > 0 ? "up" : "down" };
}

function sortNewestFirst(a: Transaction, b: Transaction): number {
  return b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? "");
}

function createDemoTransactions(): Transaction[] {
  const now = new Date();
  const rows: Omit<Transaction, "id">[] = [];
  const demo = [
    ["Salary — Example Co.", 0.72, "income", "Income"],
    ["Market groceries", 0.12, "expense", "Food & groceries"],
    ["Bolt ride", 0.055, "expense", "Transport"],
    ["Electricity bill", 0.048, "expense", "Bills & utilities"],
    ["Mobile Data | MTN", 0.02, "expense", "Airtime & data"],
    ["Streaming subscription", 0.018, "expense", "Entertainment"],
    ["Pharmacy", 0.026, "expense", "Health"],
    ["Clothing store", 0.045, "expense", "Shopping"],
    ["Transfer to savings", 0.085, "expense", "Transfers"],
  ] as const;

  for (let monthOffset = 4; monthOffset >= 0; monthOffset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    for (let index = 0; index < demo.length; index += 1) {
      const [description, ratio, direction, category] = demo[index];
      const day = index === 0 ? 25 : 2 + ((index * 4 + monthOffset) % 25);
      const when = new Date(date.getFullYear(), date.getMonth(), day);
      if (when > now) continue;
      rows.push({
        date: localIsoDate(when),
        description,
        amount: Math.round((2_450_000 * ratio) / 100) * 100,
        direction,
        category,
        source: "Demo bank",
      });
    }
  }

  return rows.map((row, index) => ({ ...row, id: `demo-${index}` }));
}

interface PendingRule {
  pattern: string;
  category: Category;
  direction: Direction;
  count: number;
}

function App() {
  const storedPeriod = useMemo(readStoredPeriod, []);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>(() => readJson(SAVINGS_STORAGE_KEY, normaliseSavingsGoals, []));
  const [savingsCircles, setSavingsCircles] = useState<SavingsCircle[]>(() => readJson(CIRCLES_STORAGE_KEY, normaliseSavingsCircles, []));
  const [bets, setBets] = useState<BetRecord[]>(() => readJson(BETS_STORAGE_KEY, normaliseBets, []));
  const [rules, setRules] = useState<CategoryRule[]>(() => readJson(RULES_STORAGE_KEY, normaliseRules, []));
  const [budgets, setBudgets] = useState<Budget[]>(() => readJson(BUDGETS_STORAGE_KEY, normaliseBudgets, []));
  const [period, setPeriod] = useState<Period>(storedPeriod.period);
  const [customRange, setCustomRange] = useState<DateRange>(storedPeriod.custom);
  const [activePage, setActivePage] = useState<Page>("overview");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [directionFilter, setDirectionFilter] = useState("All types");
  const [sourceFilter, setSourceFilter] = useState("All accounts");
  const [ownTransferFilter, setOwnTransferFilter] = useState(false);
  const [hideInternal, setHideInternal] = useState(false);
  const [toast, setToast] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingStatementImport | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("full-history");
  const [importMonth, setImportMonth] = useState("");
  const [importCustomRange, setImportCustomRange] = useState<ImportDateRange>({ start: null, end: null });
  const [transactionLimit, setTransactionLimit] = useState(100);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [pendingRule, setPendingRule] = useState<PendingRule | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const betFileInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const skipNextSave = useRef(true);

  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 4200);
  }, []);

  // Transactions live in IndexedDB (statements with tens of thousands of rows outgrow localStorage).
  useEffect(() => {
    let cancelled = false;
    void readValue(TRANSACTIONS_STORAGE_KEY).then((value) => {
      if (cancelled) return;
      setTransactions(parseStoredTransactions(value ?? "[]"));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void writeValue(TRANSACTIONS_STORAGE_KEY, serializeTransactions(transactions)).then((ok) => {
        if (!ok) notify("Could not save to this browser. Download a backup from Data & rules before closing this tab.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [transactions, loaded, notify]);

  useEffect(() => {
    saveJson(PERIOD_STORAGE_KEY, { period, custom: customRange });
  }, [period, customRange]);

  useEffect(() => {
    setTransactionLimit(100);
  }, [query, categoryFilter, directionFilter, sourceFilter, ownTransferFilter, hideInternal, period, customRange]);

  const range = useMemo(() => resolvePeriod(period, new Date(), customRange), [period, customRange]);
  const withinPeriod = useMemo(() => filterByRange(transactions, range), [transactions, range]);
  const totals = useMemo(() => calculateTotals(withinPeriod), [withinPeriod]);
  const categories = useMemo(() => getCategoryTotals(withinPeriod), [withinPeriod]);
  const transferInsights = useMemo(() => getTransferInsights(withinPeriod), [withinPeriod]);
  const allOwnCandidates = useMemo(() => transactions.filter((transaction) => transaction.ownAccountCandidate && !transaction.internalTransfer).length, [transactions]);
  const fees = useMemo(() => getFeeSummary(withinPeriod), [withinPeriod]);
  const dataBounds = useMemo(() => {
    let first = "";
    let last = "";
    for (const transaction of transactions) {
      if (!first || transaction.date < first) first = transaction.date;
      if (!last || transaction.date > last) last = transaction.date;
    }
    return { first, last };
  }, [transactions]);
  const chartRange = useMemo<DateRange>(() => {
    const end = range.end && dataBounds.last && dataBounds.last < range.end ? dataBounds.last : range.end ?? dataBounds.last;
    if (!end) return range;
    const startLimit = range.start ?? dataBounds.first;
    const days = startLimit ? (new Date(`${end}T00:00:00`).getTime() - new Date(`${startLimit}T00:00:00`).getTime()) / 86_400_000 : 0;
    if (days >= 150) return { start: startLimit, end };
    // Short periods still get a six-month trend for context.
    const sixMonthsBack = new Date(`${end}T00:00:00`);
    sixMonthsBack.setMonth(sixMonthsBack.getMonth() - 5, 1);
    return { start: localIsoDate(sixMonthsBack), end };
  }, [range, dataBounds]);
  const monthly = useMemo(() => getMonthlySeries(transactions, chartRange), [transactions, chartRange]);
  const sources = useMemo(() => [...new Set(transactions.map((transaction) => transaction.source))].sort(), [transactions]);
  const previousTotals = useMemo(() => {
    const previous = previousRange(period, range);
    return previous ? calculateTotals(filterByRange(transactions, previous)) : null;
  }, [transactions, period, range]);
  const similarTransactionCounts = useMemo(() => getSimilarTransactionCounts(transactions), [transactions]);

  const visibleTransactions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
    return withinPeriod
      .filter((transaction) => categoryFilter === "All categories" || transaction.category === categoryFilter)
      .filter((transaction) => directionFilter === "All types" || transaction.direction === directionFilter)
      .filter((transaction) => sourceFilter === "All accounts" || transaction.source === sourceFilter)
      .filter((transaction) => !ownTransferFilter || (transaction.ownAccountCandidate === true && !transaction.internalTransfer))
      .filter((transaction) => !hideInternal || !transaction.internalTransfer)
      .filter((transaction) =>
        !normalizedQuery ||
        `${transaction.description} ${transaction.category} ${transaction.source} ${transaction.note ?? ""} ${transaction.amount}`.toLowerCase().replace(/\s+/g, " ").includes(normalizedQuery))
      .sort(sortNewestFirst);
  }, [withinPeriod, query, categoryFilter, directionFilter, sourceFilter, ownTransferFilter, hideInternal]);
  const displayedTransactions = useMemo(() => visibleTransactions.slice(0, transactionLimit), [visibleTransactions, transactionLimit]);
  const visibleTotals = useMemo(() => calculateTotals(visibleTransactions), [visibleTransactions]);

  const access = useAccessAuth();

  const updateSavingsGoals = (next: SavingsGoal[]) => {
    setSavingsGoals(next);
    if (!saveJson(SAVINGS_STORAGE_KEY, next)) notify("Could not save your goals in this browser. Download a backup before closing this tab.");
  };

  const updateSavingsCircles = (next: SavingsCircle[]) => {
    setSavingsCircles(next);
    if (!saveJson(CIRCLES_STORAGE_KEY, next)) notify("Could not save contribution circles in this browser. Download a backup before closing this tab.");
  };

  const updateBets = (next: BetRecord[]) => {
    setBets(next);
    if (!saveJson(BETS_STORAGE_KEY, next)) notify("Could not save betting records in this browser. Download a backup before closing this tab.");
  };

  const updateRules = (next: CategoryRule[]) => {
    setRules(next);
    if (!saveJson(RULES_STORAGE_KEY, next)) notify("Could not save your rules in this browser.");
  };

  const updateBudgets = (next: Budget[]) => {
    setBudgets(next);
    if (!saveJson(BUDGETS_STORAGE_KEY, next)) notify("Could not save your budgets in this browser.");
  };

  const importFiles = async (files: FileList | File[]) => {
    if (!loaded) return;
    const statementFiles = Array.from(files).filter((file) => /\.(csv|xls|xlsx|pdf)$/i.test(file.name));
    if (statementFiles.length === 0) {
      notify("Choose a CSV, Excel (.xls/.xlsx), or text-based PDF statement.");
      return;
    }
    setImporting(true);
    setImportWarnings([]);
    const imported: Transaction[] = [];
    let skipped = 0;
    const messages: string[] = [];
    let diagnosticsAvailable = true;
    const diagnostics: ImportDiagnostics = {
      scannedRows: 0,
      validRows: 0,
      invalidRows: 0,
      missingDateRows: 0,
      invalidDateRows: 0,
      ambiguousDateRows: 0,
      headerDetected: false,
    };

    try {
      for (const file of statementFiles) {
        try {
          const result = await parseStatementFile(file);
          imported.push(...result.transactions);
          skipped += result.skipped;
          if (!result.diagnostics) {
            diagnosticsAvailable = false;
          } else {
            diagnostics.scannedRows += result.diagnostics.scannedRows;
            diagnostics.validRows += result.diagnostics.validRows;
            diagnostics.invalidRows += result.diagnostics.invalidRows;
            diagnostics.missingDateRows += result.diagnostics.missingDateRows;
            diagnostics.invalidDateRows += result.diagnostics.invalidDateRows;
            diagnostics.ambiguousDateRows += result.diagnostics.ambiguousDateRows;
            diagnostics.headerDetected ||= result.diagnostics.headerDetected;
          }
          messages.push(...result.warnings.map((warning) => `${file.name}: ${warning}`));
        } catch {
          diagnosticsAvailable = false;
          messages.push(`${file.name} could not be read. Scanned or password-protected PDFs may need to be exported as CSV or Excel.`);
        }
      }

      const dates = imported.map((transaction) => transaction.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
      setImportMode("full-history");
      setImportMonth(dates[0]?.slice(0, 7) ?? "");
      setImportCustomRange({ start: dates[0] ?? null, end: dates.at(-1) ?? null });
      setPendingImport({
        transactions: imported,
        skipped,
        diagnostics,
        diagnosticsAvailable,
        warnings: messages,
        files: statementFiles,
      });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const comparisonAvailable = loaded;
  const importPreview: ImportPreview | null = useMemo(() => pendingImport
    ? buildImportPreview({
      imported: applyCategoryRules(pendingImport.transactions, rules),
      existing: transactions,
      diagnostics: pendingImport.diagnosticsAvailable ? pendingImport.diagnostics : undefined,
      skipped: pendingImport.skipped,
      mode: importMode,
      month: importMonth,
      customRange: importCustomRange,
      comparisonAvailable,
    })
    : null, [pendingImport, transactions, rules, importMode, importMonth, importCustomRange, comparisonAvailable]);

  const confirmImport = () => {
    if (!pendingImport || !importPreview?.rangeValid) return;
    const imported = importPreview.transactionsInRange;
    const newTransactions = findNewTransactions(transactions, applyCategoryRules(importPreview.transactionsForConfirmation, rules));
    const duplicates = imported.length - newTransactions.length;
    const messages = [...pendingImport.warnings];
    if (importPreview.transactionsOutsideRange > 0) {
      messages.push(
        `${importPreview.transactionsOutsideRange.toLocaleString("en-NG")} valid transaction row${importPreview.transactionsOutsideRange === 1 ? "" : "s"} outside the selected period were not imported.`,
      );
    }
    if (duplicates > 0 && newTransactions.length) messages.push(`${duplicates.toLocaleString("en-NG")} rows were already in your history and were skipped.`);
    setImportWarnings(messages);

    if (newTransactions.length) {
      setTransactions((current) => [...current, ...newTransactions]);
      if (!newTransactions.some((transaction) => filterByRange([transaction], range).length)) setPeriod("all");
      notify(`${newTransactions.length.toLocaleString("en-NG")} transaction${newTransactions.length === 1 ? "" : "s"} imported${pendingImport.skipped ? ` · ${pendingImport.skipped} skipped` : ""}${messages.length ? " · see the import notes" : ""}.`);
      setActivePage("overview");
    } else if (imported.length) {
      notify("Those transactions are already in your history.");
    } else {
      notify(messages[0] ?? "No transactions could be imported. Check the statement columns and try again.");
    }
    setPendingImport(null);
  };

  const importBetPage = async (files: FileList | File[]) => {
    const file = Array.from(files).find((item) => /\.(mhtml|mht|html|htm|csv|xls|xlsx|pdf)$/i.test(item.name));
    if (!file) {
      notify("Choose an HTML/MHTML page, CSV, Excel (.xls/.xlsx), or text-based PDF betting history file.");
      return;
    }
    setActivePage("betting");
    setImporting(true);
    setImportWarnings([]);
    try {
      const result = await parseBettingFile(file);
      setImportWarnings(result.warnings.map((warning) => `${file.name}: ${warning}`));
      const existingIds = new Set(bets.map((bet) => bet.id));
      const newBets = result.bets.filter((bet) => {
        if (existingIds.has(bet.id)) return false;
        existingIds.add(bet.id);
        return true;
      });
      if (newBets.length) {
        updateBets([...bets, ...newBets]);
        notify(`${newBets.length} bet${newBets.length === 1 ? "" : "s"} imported${result.warnings.length ? " · see the import notes" : ""}.`);
      } else if (result.bets.length) {
        notify("Those betting records are already in your ledger.");
      } else {
        notify(result.warnings[0] ?? "No bet records could be extracted from this page.");
      }
    } catch {
      notify("This betting file could not be read. PDFs must contain selectable text; for scanned PDFs, export the history as CSV or Excel.");
    } finally {
      setImporting(false);
      if (betFileInput.current) betFileInput.current.value = "";
    }
  };

  /* ------------------------------------------------ transaction editing */

  const changeCategory = (transactionId: string, category: Category) => {
    const target = transactions.find((transaction) => transaction.id === transactionId);
    if (!target) return;
    setTransactions((current) => current.map((transaction) =>
      transaction.id === transactionId ? { ...transaction, category, categoryLocked: true } : transaction));
    const pattern = similarityKey(target.description);
    if (pattern.length < 3) return;
    const probe = { id: "", pattern, category, direction: target.direction, createdAt: "" };
    const similar = transactions.filter((transaction) =>
      transaction.id !== transactionId && !transaction.categoryLocked && !transaction.manual &&
      transaction.category !== category && ruleMatches(probe, transaction)).length;
    setPendingRule({ pattern, category, direction: target.direction, count: similar });
  };

  const addRule = (rule: Omit<CategoryRule, "id" | "createdAt">) => {
    const created: CategoryRule = { ...rule, id: newId("rule"), createdAt: localIsoDate() };
    updateRules([...rules, created]);
    const next = applyCategoryRules(transactions, [created]);
    const changed = next.filter((transaction, index) => transaction !== transactions[index]).length;
    setTransactions(next);
    notify(`Rule saved · ${changed.toLocaleString("en-NG")} transaction${changed === 1 ? "" : "s"} updated.`);
  };

  const acceptPendingRule = () => {
    if (!pendingRule) return;
    addRule({ pattern: pendingRule.pattern, category: pendingRule.category, direction: pendingRule.direction });
    setPendingRule(null);
  };

  const toggleInternal = (transactionId: string) => {
    setTransactions((current) => current.map((transaction) => {
      if (transaction.id !== transactionId) return transaction;
      if (transaction.internalTransfer) {
        return {
          ...transaction,
          internalTransfer: false,
          category: transaction.categoryLocked ? transaction.category : categorise(transaction.description, transaction.direction),
        };
      }
      return { ...transaction, internalTransfer: true, ownAccountCandidate: false, category: "Transfers" };
    }));
  };

  const confirmAllOwnTransfers = () => {
    if (!allOwnCandidates) return;
    if (!window.confirm(`Mark all ${allOwnCandidates.toLocaleString("en-NG")} possible own-account transfers as internal? They will be excluded from income and spending totals. You can undo any one of them from the Transactions page.`)) return;
    setTransactions((current) => current.map((transaction) =>
      transaction.ownAccountCandidate && !transaction.internalTransfer
        ? { ...transaction, internalTransfer: true, ownAccountCandidate: false, category: "Transfers" }
        : transaction));
    notify(`${allOwnCandidates.toLocaleString("en-NG")} transfers between your own accounts are now excluded from totals.`);
  };

  const deleteTransaction = (transactionId: string) => {
    if (!window.confirm("Delete this transaction from your history?")) return;
    setTransactions((current) => current.filter((transaction) => transaction.id !== transactionId));
    notify("Transaction deleted.");
  };

  const addManualTransaction = (transaction: Omit<Transaction, "id">) => {
    setTransactions((current) => [...current, { ...transaction, id: newId("manual"), manual: true, categoryLocked: true }]);
    setShowAddTransaction(false);
    if (!filterByRange([{ ...transaction, id: "" }], range).length) setPeriod("all");
    notify("Transaction added.");
  };

  const refreshAllCategories = () => {
    if (!window.confirm("Re-run automatic categorisation and your rules over your imported history? Categories you set by hand are kept.")) return;
    const result = refreshCategories(transactions, rules);
    setTransactions(result.transactions);
    notify(`${result.changed.toLocaleString("en-NG")} transaction${result.changed === 1 ? "" : "s"} re-categorised.`);
  };

  /* ---------------------------------------------- savings and betting */

  const createBetRecord = (bet: Omit<BetRecord, "id">) => {
    updateBets([...bets, { ...bet, id: newId("bet") }]);
    notify("Bet record added.");
  };

  const updateBetCategory = (betId: string, category: BetCategory) => {
    updateBets(bets.map((bet) => bet.id === betId ? { ...bet, category } : bet));
  };

  const deleteBetRecord = (betId: string) => {
    updateBets(bets.filter((bet) => bet.id !== betId));
    notify("Bet record deleted.");
  };

  const createSavingsGoal = (name: string, targetAmount: number, startingAmount: number) => {
    const id = newId("goal");
    const date = localIsoDate();
    const contributions: SavingsContribution[] = startingAmount > 0 ? [{ id: `${id}-starting`, date, amount: startingAmount }] : [];
    updateSavingsGoals([...savingsGoals, { id, name, targetAmount, createdAt: date, contributions }]);
    notify(`“${name}” savings goal created.`);
  };

  const addSavingsContribution = (goalId: string, amount: number) => {
    const contribution = { id: newId("contribution"), date: localIsoDate(), amount };
    updateSavingsGoals(savingsGoals.map((goal) => goal.id === goalId ? { ...goal, contributions: [...goal.contributions, contribution] } : goal));
    notify("Savings contribution recorded.");
  };

  const deleteSavingsGoal = (goalId: string) => {
    updateSavingsGoals(savingsGoals.filter((goal) => goal.id !== goalId));
    notify("Savings goal deleted.");
  };

  const createSavingsCircle = (circle: Omit<SavingsCircle, "id">) => {
    updateSavingsCircles([...savingsCircles, { ...circle, id: newId("circle") }]);
    notify(`“${circle.name}” circle saved in this browser.`);
  };

  const updateSavingsCircle = (circle: SavingsCircle) => {
    updateSavingsCircles(savingsCircles.map((item) => item.id === circle.id ? circle : item));
  };

  const deleteSavingsCircle = (circleId: string) => {
    updateSavingsCircles(savingsCircles.filter((circle) => circle.id !== circleId));
    notify("Contribution circle and its local history deleted.");
  };

  /* ------------------------------------------------------ data & files */

  const exportCsv = (rows: Transaction[]) => {
    if (rows.length === 0) {
      notify("There are no transactions to export.");
      return;
    }
    downloadFile(transactionsToCsv([...rows].sort(sortNewestFirst)), "spendwise-transactions.csv", "text/csv;charset=utf-8");
    notify(`${rows.length.toLocaleString("en-NG")} transactions exported.`);
  };

  const exportBackup = () => {
    downloadFile(
      createBackup({ transactions, savingsGoals, savingsCircles, bets, rules, budgets }),
      `spendwise-backup-${localIsoDate()}.json`,
      "application/json",
    );
    notify("Backup downloaded. Keep it somewhere safe — it contains your full history.");
  };

  const restoreBackup = async (file: File) => {
    const backup = readBackup(await file.text());
    if (!backup) {
      notify("That file is not a Spendwise backup.");
      return;
    }
    if (!window.confirm(`Replace everything in this browser with the backup (${backup.transactions.length.toLocaleString("en-NG")} transactions, ${backup.savingsGoals.length} goals, ${backup.bets.length} bets, ${backup.rules.length} rules, ${backup.budgets.length} budgets)?`)) return;
    setTransactions(backup.transactions);
    updateSavingsGoals(backup.savingsGoals);
    updateSavingsCircles(backup.savingsCircles);
    updateBets(backup.bets);
    updateRules(backup.rules);
    updateBudgets(backup.budgets);
    setPeriod("all");
    notify("Backup restored.");
  };

  const loadDemo = () => {
    if (transactions.length && !window.confirm("Replace your current transactions with fictional demo data?")) return;
    setTransactions(createDemoTransactions());
    setPeriod("90d");
    notify("Fictional demo data loaded. Import your own statement when ready.");
  };

  const clearTransactions = () => {
    if (!transactions.length) return;
    if (!window.confirm("Delete all locally saved transactions? This cannot be undone.")) return;
    setTransactions([]);
    notify("Transaction history cleared from this browser.");
  };

  const goTo = (page: Page) => {
    setActivePage(page);
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  };

  const searchTransactions = (text: string) => {
    setQuery(text);
    setCategoryFilter("All categories");
    setDirectionFilter("All types");
    setSourceFilter("All accounts");
    setOwnTransferFilter(false);
    goTo("transactions");
  };

  const activeCategories = categories.filter((item) => item.category !== "Transfers");
  const topCategory = activeCategories[0];
  const biggest = useMemo(() => withinPeriod
    .filter((transaction) => transaction.direction === "expense" && !transaction.internalTransfer && transaction.category !== "Transfers")
    .reduce<Transaction | undefined>((max, transaction) => (!max || transaction.amount > max.amount ? transaction : max), undefined), [withinPeriod]);
  const comparisonsAvailable = previousTotals !== null;
  const periodHint = loaded && transactions.length > 0 && withinPeriod.length === 0;

  const periodControls = (
    <PeriodSelect
      value={period}
      custom={customRange}
      bounds={dataBounds}
      onChange={setPeriod}
      onCustomChange={setCustomRange}
    />
  );

  const emptyPeriodNotice = periodHint ? (
    <section className="period-hint" role="status">
      <span>No transactions in this period. Your history runs from <strong>{formatDate(dataBounds.first)}</strong> to <strong>{formatDate(dataBounds.last)}</strong>.</span>
      <span className="period-hint-actions">
        <button className="button button-secondary" onClick={() => {
          setCustomRange({ start: `${dataBounds.last.slice(0, 7)}-01`, end: dataBounds.last });
          setPeriod("custom");
        }}>Show latest month</button>
        <button className="button button-primary" onClick={() => setPeriod("all")}>Show all time</button>
      </span>
    </section>
  ) : null;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Wallet size={19} strokeWidth={2.2} /></div>
          <span>spendwise</span>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-avatar"><Landmark size={16} /></div>
          <div className="workspace-copy"><strong>My finances</strong><span>{dataBounds.first ? `${formatDate(dataBounds.first)} – ${formatDate(dataBounds.last)}` : "Personal workspace"}</span></div>
        </div>
        <div className="nav-label">MENU</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <NavButton page="overview" active={activePage} onClick={goTo} icon={<LayoutDashboard size={18} />} />
          <NavButton page="transactions" active={activePage} onClick={goTo} icon={<ArrowLeftRight size={18} />} count={transactions.length} />
          <NavButton page="insights" active={activePage} onClick={goTo} icon={<BarChart3 size={18} />} />
          <NavButton page="budgets" active={activePage} onClick={goTo} icon={<Target size={18} />} count={budgets.length || undefined} />
          <NavButton page="savings" active={activePage} onClick={goTo} icon={<PiggyBank size={18} />} count={savingsGoals.length + savingsCircles.length || undefined} />
          <NavButton page="betting" active={activePage} onClick={goTo} icon={<Ticket size={18} />} count={bets.length || undefined} />
          <NavButton page="data" active={activePage} onClick={goTo} icon={<DatabaseBackup size={18} />} count={rules.length || undefined} />
        </nav>
        <div className="sidebar-bottom">
          <AccessCard status={access.status} onSignIn={access.signIn} onDetails={() => setShowPrivacy(true)} />
        </div>
      </aside>
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button menu-toggle" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumbs"><span>My finances</span><span className="crumb-slash">/</span><strong>{pageTitles[activePage]}</strong></div>
          <div className="topbar-actions">
            <span className="currency-badge">{currency}</span>
            {activePage === "betting" ? (
              <button className="button button-primary top-import" onClick={() => betFileInput.current?.click()}><Plus size={16} /> Import bets</button>
            ) : (
              <button className="button button-primary top-import" disabled={!loaded} onClick={() => fileInput.current?.click()}><Plus size={16} /> Import statement</button>
            )}
            <input ref={fileInput} className="visually-hidden" type="file" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple onChange={(event) => event.target.files && void importFiles(event.target.files)} />
            <input ref={betFileInput} className="visually-hidden" type="file" accept=".mhtml,.mht,.html,.htm,.csv,.xls,.xlsx,.pdf,application/x-mimearchive,text/html,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files && void importBetPage(event.target.files)} />
          </div>
        </header>

        <div className="page-content">
          {importWarnings.length > 0 && (
            <section className="import-notice" role="status">
              <div className="import-notice-copy">
                <strong>Import review</strong>
                {importWarnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}
              </div>
              <button className="icon-button" onClick={() => setImportWarnings([])} aria-label="Dismiss import notes"><X size={16} /></button>
            </section>
          )}

          {!loaded && (activePage === "overview" || activePage === "transactions" || activePage === "insights") && (
            <div className="loading-state"><LoaderCircle className="spin" size={20} /> Loading your history…</div>
          )}

          {loaded && activePage === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> YOUR MONEY AT A GLANCE</div>
                  <h1>Good money habits start with clarity.</h1>
                  <p className="page-subtitle">A calm, clear picture of where your money comes from and where it goes.</p>
                </div>
                <div className="heading-actions">
                  {periodControls}
                  <button className="button button-secondary" onClick={() => exportCsv(withinPeriod)}><Download size={15} /> Export</button>
                </div>
              </div>

              {transactions.length === 0 ? (
                <EmptyState onImport={() => fileInput.current?.click()} onDemo={loadDemo} />
              ) : (
                <>
                  {emptyPeriodNotice}
                  <div className="metric-grid">
                    <MetricCard
                      label="Money in"
                      amount={formatCurrency(totals.income, currency)}
                      change={comparisonsAvailable ? relativeChange(totals.income, previousTotals!.income) : { text: "Across the whole period", direction: null }}
                      goodWhenUp
                      icon={<ArrowDownLeft size={18} />}
                      tint="mint"
                    />
                    <MetricCard
                      label="Money out"
                      amount={formatCurrency(totals.expenses, currency)}
                      change={comparisonsAvailable ? relativeChange(totals.expenses, previousTotals!.expenses) : { text: totals.refunds ? `After ${formatCurrency(totals.refunds, currency)} in refunds` : "Across the whole period", direction: null }}
                      goodWhenUp={false}
                      icon={<ArrowUpRight size={18} />}
                      tint="peach"
                    />
                    <MetricCard
                      label="Net cash flow"
                      amount={formatCurrency(totals.net, currency)}
                      change={{ text: "Money in minus money out", direction: null }}
                      goodWhenUp
                      icon={<ArrowLeftRight size={18} />}
                      tint="lavender"
                    />
                    <MetricCard
                      label="Kept this period"
                      amount={totals.income > 0 ? `${Math.round(totals.savingsRate)}%` : "—"}
                      change={{ text: totals.income > 0 ? "Of money in, after spending" : "Add income to calculate", direction: null }}
                      goodWhenUp
                      icon={<Wallet size={18} />}
                      tint="blue"
                    />
                  </div>

                  {allOwnCandidates > 0 && (
                    <section className="review-banner">
                      <span><strong>{allOwnCandidates.toLocaleString("en-NG")} transfers look like moves between your own accounts</strong> (same name or your own card/account number). They still count as money in and out until you confirm them.</span>
                      <span className="review-banner-actions">
                        <button className="button button-secondary" onClick={() => {
                          searchTransactions("");
                          setPeriod("all");
                          setOwnTransferFilter(true);
                        }}>Review</button>
                        <button className="button button-primary" onClick={confirmAllOwnTransfers}>Exclude all from totals</button>
                      </span>
                    </section>
                  )}

                  <div className="dashboard-grid">
                    <section className="panel cashflow-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="panel-kicker">CASH FLOW</div>
                          <h2>Income vs. spending by month</h2>
                        </div>
                        <div className="chart-legend">
                          <span><i className="legend-dot income-dot" /> Income</span>
                          <span><i className="legend-dot spending-dot" /> Spending</span>
                        </div>
                      </div>
                      <CashflowChart data={monthly} currency={currency} />
                    </section>

                    <section className="panel category-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="panel-kicker">WHERE IT GOES</div>
                          <h2>Spending breakdown</h2>
                        </div>
                        <button className="subtle-link" onClick={() => goTo("insights")}>Details <ArrowUpRight size={14} /></button>
                      </div>
                      <CategoryChart categories={activeCategories} currency={currency} onSelect={(category) => {
                        searchTransactions("");
                        setCategoryFilter(category);
                      }} />
                    </section>
                  </div>

                  <div className="lower-grid">
                    <section className="panel transactions-panel">
                      <div className="panel-heading transaction-heading">
                        <div>
                          <div className="panel-kicker">LATEST ACTIVITY</div>
                          <h2>Recent transactions <span className="heading-count">{withinPeriod.length.toLocaleString("en-NG")}</span></h2>
                        </div>
                        <button className="subtle-link" onClick={() => goTo("transactions")}>See all <ArrowUpRight size={14} /></button>
                      </div>
                      <TransactionTable transactions={[...withinPeriod].sort(sortNewestFirst).slice(0, 6)} currency={currency} />
                    </section>
                    <InsightsPanel
                      count={withinPeriod.length}
                      topCategory={topCategory}
                      biggest={biggest}
                      fees={fees.total}
                      totals={totals}
                      currency={currency}
                      onOpen={() => goTo("insights")}
                    />
                  </div>
                </>
              )}
              <div className="page-footnote"><ShieldCheck size={14} /> Your financial records stay in this browser and are never uploaded.</div>
            </>
          )}

          {loaded && activePage === "transactions" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> YOUR ACTIVITY</div>
                  <h1>Transactions</h1>
                  <p className="page-subtitle">Search, re-categorise, and tidy up transactions across all your statements. Change a category and Spendwise offers to remember it.</p>
                </div>
                <div className="heading-actions">
                  {periodControls}
                  <button className="button button-secondary" onClick={() => setShowAddTransaction(true)}><Plus size={15} /> Add</button>
                  <button className="button button-secondary" onClick={() => exportCsv(visibleTransactions)}><Download size={15} /> Export CSV</button>
                </div>
              </div>
              {emptyPeriodNotice}
              {pendingRule && (
                <section className="rule-suggestion" role="status">
                  <span>{pendingRule.count > 0 ? <>Also set <strong>{pendingRule.count.toLocaleString("en-NG")}</strong> similar transaction{pendingRule.count === 1 ? "" : "s"} matching “{pendingRule.pattern}” to <strong>{pendingRule.category}</strong>, and remember it for future imports?</> : <>Remember <strong>{pendingRule.pattern}</strong> as <strong>{pendingRule.category}</strong> for future imports?</>}</span>
                  <span className="rule-suggestion-actions">
                    <button className="button button-secondary" onClick={() => setPendingRule(null)}>Only this one</button>
                    <button className="button button-primary" onClick={acceptPendingRule}><Check size={14} /> {pendingRule.count > 0 ? "Apply to all & remember" : "Remember for future"}</button>
                  </span>
                </section>
              )}
              <section className="panel all-transactions">
                <div className="table-tools">
                  <div className="search-field">
                    <Search size={16} />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search description, amount, account…" />
                    {query && <button className="icon-button search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
                  </div>
                  <div className="filter-row">
                    <label className="filter-select"><Filter size={14} /><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Category"><option>All categories</option>{categoryList.filter((item) => transactions.some((transaction) => transaction.category === item)).map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label>
                    <label className="filter-select"><select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value)} aria-label="Money in or out"><option>All types</option><option value="income">Money in</option><option value="expense">Money out</option></select><ChevronDown size={13} /></label>
                    <label className="filter-select"><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Account"><option>All accounts</option>{sources.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label>
                    <button className={`filter-candidate-toggle ${hideInternal ? "filter-candidate-toggle--active" : ""}`} onClick={() => setHideInternal((value) => !value)}>
                      Hide own-pot moves
                    </button>
                    <button
                      className={`filter-candidate-toggle ${ownTransferFilter ? "filter-candidate-toggle--active" : ""}`}
                      onClick={() => setOwnTransferFilter((value) => !value)}
                      disabled={transferInsights.ownAccountCandidateCount === 0 && !ownTransferFilter}
                    >
                      Possible self-transfers · {transferInsights.ownAccountCandidateCount.toLocaleString("en-NG")}
                    </button>
                  </div>
                </div>
                <div className="transaction-summary">
                  <span>Showing {displayedTransactions.length.toLocaleString("en-NG")} of {visibleTransactions.length.toLocaleString("en-NG")} transaction{visibleTransactions.length === 1 ? "" : "s"}</span>
                  <span>{formatCurrency(visibleTotals.income, currency)} in · {formatCurrency(visibleTotals.expenses, currency)} out <small>(own transfers excluded)</small></span>
                </div>
                {visibleTransactions.length
                  ? <>
                    <TransactionTable
                      transactions={displayedTransactions}
                      currency={currency}
                      showSource
                      onChangeCategory={changeCategory}
                      similarCounts={similarTransactionCounts}
                      rules={rules}
                      onToggleInternal={toggleInternal}
                      onDelete={deleteTransaction}
                    />
                    {displayedTransactions.length < visibleTransactions.length && (
                      <div className="table-load-more">
                        <button className="button button-secondary" onClick={() => setTransactionLimit((limit) => limit + 100)}>Show 100 more</button>
                        <button className="button button-text" onClick={() => setTransactionLimit(visibleTransactions.length)}>Show all {visibleTransactions.length.toLocaleString("en-NG")}</button>
                      </div>
                    )}
                  </>
                  : <div className="no-results"><Search size={20} /><strong>No transactions match those filters</strong><span>Try another search, period, or import a statement.</span></div>}
              </section>
            </>
          )}

          {activePage === "budgets" && (
            <BudgetsPage
              transactions={transactions}
              budgets={budgets}
              currency={currency}
              onSaveBudget={(budget) => {
                updateBudgets([...budgets.filter((item) => item.category !== budget.category), budget]);
                notify(`${budget.category} budget saved.`);
              }}
              onDeleteBudget={(category) => updateBudgets(budgets.filter((item) => item.category !== category))}
            />
          )}

          {activePage === "savings" && (
            <SavingsPage
              goals={savingsGoals}
              circles={savingsCircles}
              currency={currency}
              onCreateGoal={createSavingsGoal}
              onAddContribution={addSavingsContribution}
              onDeleteGoal={deleteSavingsGoal}
              onCreateCircle={createSavingsCircle}
              onUpdateCircle={updateSavingsCircle}
              onDeleteCircle={deleteSavingsCircle}
            />
          )}

          {activePage === "betting" && (
            <BettingPage
              bets={bets}
              transactions={transactions}
              currency={currency}
              onImport={() => betFileInput.current?.click()}
              onAddBet={createBetRecord}
              onChangeCategory={updateBetCategory}
              onDeleteBet={deleteBetRecord}
            />
          )}

          {activePage === "data" && (
            <DataPage
              rules={rules}
              counts={{ transactions: transactions.length, goals: savingsGoals.length, circles: savingsCircles.length, bets: bets.length, budgets: budgets.length }}
              matchCount={(rule) => transactions.filter((transaction) => ruleMatches({ id: "", category: "Other", createdAt: "", ...rule }, transaction)).length}
              onAddRule={addRule}
              onDeleteRule={(ruleId) => {
                updateRules(rules.filter((rule) => rule.id !== ruleId));
                notify("Rule deleted. Existing categories are unchanged; use Re-categorise history to undo its effect.");
              }}
              onRefreshCategories={refreshAllCategories}
              onExportBackup={exportBackup}
              onRestoreBackup={(file) => void restoreBackup(file)}
              onClearTransactions={clearTransactions}
              access={access.status}
              onSignIn={access.signIn}
            />
          )}

          {loaded && activePage === "insights" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> SPENDING PATTERNS</div>
                  <h1>Insights that make sense.</h1>
                  <p className="page-subtitle">Patterns from the transactions you’ve imported. No guesswork, no judgement.</p>
                </div>
                <div className="heading-actions">{periodControls}</div>
              </div>
              {transactions.length === 0 ? (
                <EmptyState onImport={() => fileInput.current?.click()} onDemo={loadDemo} />
              ) : (
                <>
                  {emptyPeriodNotice}
                  <div className="insight-summary">
                    <div className="insight-summary-icon"><Sparkles size={18} /></div>
                    <div><span>YOUR PERIOD SUMMARY</span><p>{summarySentence(totals, topCategory, currency)}</p></div>
                  </div>
                  <div className="insight-page-grid">
                    <section className="panel insight-category-panel">
                      <div className="panel-heading"><div><div className="panel-kicker">SPENDING MIX</div><h2>Where your money goes</h2></div></div>
                      <CategoryChart categories={activeCategories} currency={currency} large onSelect={(category) => {
                        searchTransactions("");
                        setCategoryFilter(category);
                      }} />
                    </section>
                    <div className="insight-side">
                      <InsightDetail
                        icon={<TrendingUp size={18} />}
                        title="Biggest spending category"
                        value={topCategory?.category ?? "No spending yet"}
                        detail={topCategory ? `${formatCurrency(topCategory.amount, currency)} · ${Math.round(topCategory.share)}% of categorised spending (transfers to people shown separately)` : "Import transactions to find a pattern."}
                        tone="mint"
                      />
                      <InsightDetail
                        icon={<TrendingDown size={18} />}
                        title="Largest single payment"
                        value={biggest ? formatCurrency(biggest.amount, currency) : "No outgoing yet"}
                        detail={biggest ? `${biggest.description} · ${formatDate(biggest.date)}` : "Import transactions to find a pattern."}
                        tone="peach"
                      />
                      <InsightDetail
                        icon={<Wallet size={18} />}
                        title="Savings rate"
                        value={totals.income > 0 ? `${Math.round(totals.savingsRate)}%` : "—"}
                        detail={totals.income > 0 ? `${formatCurrency(Math.max(totals.net, 0), currency)} left after recorded spending` : "Add an income transaction to calculate this."}
                        tone="lavender"
                      />
                      <div className="insight-note"><Lightbulb size={17} /><p>Money moving between your own wallet and savings pots (OWealth, Spend & Save, Targets) is left out of every total, so the numbers show what actually came in and went out.</p></div>
                    </div>
                  </div>
                  <section className="panel trend-panel">
                    <div className="panel-heading"><div><div className="panel-kicker">MONTH BY MONTH</div><h2>Cash flow trend</h2></div><div className="chart-legend"><span><i className="legend-dot income-dot" /> Income</span><span><i className="legend-dot spending-dot" /> Spending</span></div></div>
                    <CashflowChart data={monthly} currency={currency} />
                  </section>
                  <InsightsExtras transactions={withinPeriod} allTransactions={transactions} range={range} currency={currency} onSearch={searchTransactions} />
                  <TransferReviewPanel
                    insights={transferInsights}
                    currency={currency}
                    pendingCount={allOwnCandidates}
                    onConfirmAll={confirmAllOwnTransfers}
                    onReview={() => {
                      searchTransactions("");
                      setPeriod("all");
                      setOwnTransferFilter(true);
                    }}
                  />
                </>
              )}
            </>
          )}
        </div>
      </main>

      {importing && <div className="import-overlay"><div className="import-message"><LoaderCircle className="spin" size={22} /><strong>Reading your {activePage === "betting" ? "betting file" : "statement"}…</strong><span>Files are processed in this browser.</span></div></div>}
      {pendingImport && importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          mode={importMode}
          month={importMonth}
          customRange={importCustomRange}
          files={pendingImport.files}
          warnings={pendingImport.warnings}
          diagnosticsAvailable={pendingImport.diagnosticsAvailable}
          comparisonNote={!comparisonAvailable
            ? "Comparison is incomplete until the transaction history has finished loading."
            : "Comparison uses the transaction history saved in this browser only."}
          pdfExtraction={pendingImport.files.some((file) => file.name.toLowerCase().endsWith(".pdf"))}
          onModeChange={setImportMode}
          onMonthChange={setImportMonth}
          onCustomRangeChange={setImportCustomRange}
          onCancel={() => setPendingImport(null)}
          onConfirm={confirmImport}
          canConfirm={importPreview.rangeValid && importPreview.transactionsInRange.length > 0}
        />
      )}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
      {showPrivacy && <PrivacyModal email={access.status.state === "signed-in" ? access.status.email : null} onClose={() => setShowPrivacy(false)} />}
      {showAddTransaction && <AddTransactionModal currency={currency} sources={sources} onClose={() => setShowAddTransaction(false)} onSave={addManualTransaction} />}
    </div>
  );
}

function ImportPreviewModal({
  preview,
  mode,
  month,
  customRange,
  files,
  warnings,
  diagnosticsAvailable,
  comparisonNote,
  pdfExtraction,
  onModeChange,
  onMonthChange,
  onCustomRangeChange,
  onCancel,
  onConfirm,
  canConfirm,
}: {
  preview: ImportPreview;
  mode: ImportMode;
  month: string;
  customRange: ImportDateRange;
  files: File[];
  warnings: string[];
  diagnosticsAvailable: boolean;
  comparisonNote: string;
  pdfExtraction: boolean;
  onModeChange: (mode: ImportMode) => void;
  onMonthChange: (month: string) => void;
  onCustomRangeChange: (range: ImportDateRange) => void;
  onCancel: () => void;
  onConfirm: () => void;
  canConfirm: boolean;
}) {
  const dateLabel = (date: string | null) => date ? formatDate(date) : "Not detected";
  const rangeLabel = preview.range
    ? `${preview.range.start ? dateLabel(preview.range.start) : "No start boundary"} – ${preview.range.end ? dateLabel(preview.range.end) : "No end boundary"}`
    : "Choose a valid period";
  const modeDescriptions: Record<ImportMode, string> = {
    "full-history": "Review all valid transactions in these files. The existing exact duplicate check will still skip rows already in your history.",
    "specific-month": "Include only transactions in one calendar month. Valid rows outside that month stay out of the import and are counted below.",
    "custom-range": "Include only transactions between the selected dates, inclusive. Valid rows outside that range stay out and are counted below.",
    "new-transactions-only": "Filter confirmed exact duplicates out of the batch before confirmation. Similar-looking rows are only flagged; the other modes still skip exact duplicates through the existing importer.",
  };
  const totalRowsLabel = diagnosticsAvailable ? preview.scannedRows.toLocaleString("en-NG") : `${preview.scannedRows.toLocaleString("en-NG")} known`;

  return (
    <div className="modal-backdrop import-preview-backdrop">
      <section className="privacy-modal import-preview-modal" role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
        <button className="icon-button modal-close" onClick={onCancel} aria-label="Cancel import preview"><X size={17} /></button>
        <div className="privacy-modal-icon"><FileText size={19} /></div>
        <h2 id="import-preview-title">Review statement import</h2>
        <p className="import-preview-files">{files.map((file) => file.name).join(" · ")}</p>

        <label className="import-mode-label">
          Import mode
          <select value={mode} onChange={(event) => onModeChange(event.target.value as ImportMode)}>
            <option value="full-history">Full history</option>
            <option value="specific-month">Specific month</option>
            <option value="custom-range">Custom date range</option>
            <option value="new-transactions-only">New transactions only</option>
          </select>
        </label>
        <p className="import-mode-description">{modeDescriptions[mode]}</p>

        {mode === "specific-month" && (
          <label className="import-range-control">
            Month
            <input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} />
          </label>
        )}
        {mode === "custom-range" && (
          <div className="import-range-fields">
            <label>From<input type="date" value={customRange.start ?? ""} max={customRange.end ?? undefined} onChange={(event) => onCustomRangeChange({ ...customRange, start: event.target.value || null })} /></label>
            <label>To<input type="date" value={customRange.end ?? ""} min={customRange.start ?? undefined} onChange={(event) => onCustomRangeChange({ ...customRange, end: event.target.value || null })} /></label>
          </div>
        )}

        <div className="import-preview-range">
          <strong>Selected date boundaries</strong>
          <span>{rangeLabel}</span>
          {!preview.rangeValid && <span className="import-preview-error">Choose a valid month or both custom dates with the start on or before the end.</span>}
        </div>

        <div className="import-preview-grid">
          <div><span>Detected earliest date</span><strong>{dateLabel(preview.timeline.earliest)}</strong></div>
          <div><span>Detected latest date</span><strong>{dateLabel(preview.timeline.latest)}</strong></div>
          <div><span>Rows scanned</span><strong>{totalRowsLabel}</strong></div>
          <div><span>Valid transaction rows</span><strong>{preview.validRows.toLocaleString("en-NG")}</strong></div>
          <div><span>Invalid or incomplete rows</span><strong>{preview.invalidRows.toLocaleString("en-NG")}</strong></div>
          <div><span>Valid rows in selected period</span><strong>{preview.transactionsInRange.length.toLocaleString("en-NG")}</strong></div>
          <div><span>Rows sent to the confirmation path</span><strong>{preview.transactionsForConfirmation.length.toLocaleString("en-NG")}</strong></div>
          <div><span>Valid rows outside selected period</span><strong>{preview.transactionsOutsideRange.toLocaleString("en-NG")}</strong></div>
          <div><span>Confirmed exact duplicates</span><strong>{preview.confirmedDuplicates === null ? "Unavailable" : preview.confirmedDuplicates.toLocaleString("en-NG")}</strong></div>
          <div><span>Potential duplicates</span><strong>{preview.potentialDuplicates === null ? "Unavailable" : preview.potentialDuplicates.toLocaleString("en-NG")}</strong></div>
          <div><span>Potential changes to existing rows</span><strong>{preview.potentialChanges === null ? "Unavailable" : preview.potentialChanges.toLocaleString("en-NG")}</strong></div>
          <div><span>Expected additions</span><strong>{preview.expectedAdds === null ? "Unavailable" : preview.expectedAdds.toLocaleString("en-NG")}</strong></div>
          <div><span>Known existing imported rows within detected dates</span><strong>{preview.existingRowsInDetectedPeriod === null ? "Unavailable" : preview.existingRowsInDetectedPeriod.toLocaleString("en-NG")}</strong></div>
        </div>

        <div className="import-preview-samples">
          <strong>Timeline sampling</strong>
          <span>First {preview.timeline.firstSample.count} valid rows: {dateLabel(preview.timeline.firstSample.earliest)} – {dateLabel(preview.timeline.firstSample.latest)}</span>
          <span>Last {preview.timeline.lastSample.count} valid rows: {dateLabel(preview.timeline.lastSample.earliest)} – {dateLabel(preview.timeline.lastSample.latest)}</span>
          <span>The actual detected bounds scan all {preview.timeline.validRows.toLocaleString("en-NG")} valid rows, regardless of file order.</span>
        </div>

        <div className="import-preview-notes">
          <strong>Comparison limits</strong>
          <p>{comparisonNote}</p>
          <p>Statement-period metadata is not stored. The overlap check uses existing imported transaction dates within the detected range; it cannot confirm which original statement files covered those dates.</p>
          <p>Potential duplicates share a date and amount plus a normalized merchant or narration match; they are not skipped. Existing import logic does not update existing transaction records.</p>
          <p>Nothing is saved during preview. Confirm adds the selected transactions to this browser’s saved history. Original statement files are not uploaded.</p>
          {preview.missingDateRows > 0 && <p>{preview.missingDateRows.toLocaleString("en-NG")} row(s) had no date; {preview.invalidDateRows.toLocaleString("en-NG")} row(s) had an invalid date.</p>}
          {preview.ambiguousDateRows > 0 && <p>{preview.ambiguousDateRows.toLocaleString("en-NG")} ambiguous numeric date(s) use the existing day-first interpretation. Check these against the statement if it uses month-first dates.</p>}
          {preview.timeline.invalidTransactionDates > 0 && <p>{preview.timeline.invalidTransactionDates} parsed transaction(s) had an invalid normalized date and were excluded from timeline bounds.</p>}
          {!diagnosticsAvailable && <p>Some selected files did not provide row diagnostics; scanned and invalid-row totals may be incomplete.</p>}
          {pdfExtraction && <p>PDF counts reflect the existing selectable-text table parser; wrapped or missing-date PDF lines can be merged into neighboring descriptions.</p>}
          {preview.overlapSources.length > 0 && (
            <p>Existing dates in the detected range: {preview.overlapSources.map((item) => `${item.source} (${item.count}, ${dateLabel(item.earliest)}–${dateLabel(item.latest)})`).join("; ")}.</p>
          )}
        </div>

        {warnings.length > 0 && (
          <div className="import-preview-warnings">
            <strong>Parser notes</strong>
            {warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}
          </div>
        )}
        <div className="import-preview-actions">
          <button className="button button-secondary" onClick={onCancel}>Cancel</button>
          <button className="button button-primary" onClick={onConfirm} disabled={!canConfirm}>Confirm import</button>
        </div>
      </section>
    </div>
  );
}

function NavButton({ page, active, onClick, icon, count }: { page: Page; active: Page; onClick: (page: Page) => void; icon: React.ReactNode; count?: number }) {
  return (
    <button className={active === page ? "nav-item active" : "nav-item"} onClick={() => onClick(page)} aria-current={active === page ? "page" : undefined}>
      {icon}<span>{pageTitles[page]}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count.toLocaleString("en-NG")}</span>}
    </button>
  );
}

function PeriodSelect({
  value,
  custom,
  bounds,
  onChange,
  onCustomChange,
}: {
  value: Period;
  custom: DateRange;
  bounds: { first: string; last: string };
  onChange: (value: Period) => void;
  onCustomChange: (range: DateRange) => void;
}) {
  return (
    <div className="period-controls">
      <label className="period-select">
        <select value={value} aria-label="Period" onChange={(event) => {
          const next = event.target.value as Period;
          if (next === "custom" && !custom.start && !custom.end && bounds.last) {
            onCustomChange({ start: `${bounds.last.slice(0, 7)}-01`, end: bounds.last });
          }
          onChange(next);
        }}>
          {periodOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
        <ChevronDown size={15} />
      </label>
      {value === "custom" && (
        <span className="custom-range">
          <input type="date" aria-label="From" value={custom.start ?? ""} max={custom.end ?? undefined} onChange={(event) => onCustomChange({ ...custom, start: event.target.value || null })} />
          <span>to</span>
          <input type="date" aria-label="To" value={custom.end ?? ""} min={custom.start ?? undefined} onChange={(event) => onCustomChange({ ...custom, end: event.target.value || null })} />
        </span>
      )}
    </div>
  );
}

function MetricCard({
  label,
  amount,
  change,
  goodWhenUp,
  icon,
  tint,
}: {
  label: string;
  amount: string;
  change: Change;
  goodWhenUp: boolean;
  icon: React.ReactNode;
  tint: string;
}) {
  const bad = change.direction !== null && (change.direction === "up") !== goodWhenUp;
  return (
    <section className="metric-card">
      <div className="metric-top"><span>{label}</span><span className={`metric-icon ${tint}`}>{icon}</span></div>
      <strong className="metric-value">{amount}</strong>
      <div className={`metric-comparison ${bad ? "comparison-warn" : ""}`}>
        {change.direction === "up" && <TrendingUp size={13} />}
        {change.direction === "down" && <TrendingDown size={13} />}
        <span>{change.text}</span>
      </div>
    </section>
  );
}

function EmptyState({ onImport, onDemo }: { onImport: () => void; onDemo: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-art">
        <div className="empty-orbit orbit-one" /><div className="empty-orbit orbit-two" />
        <div className="empty-wallet"><Wallet size={29} /></div>
        <span className="float-chip chip-one"><ArrowDownLeft size={15} /></span>
        <span className="float-chip chip-two"><ArrowUpRight size={15} /></span>
      </div>
      <div className="eyebrow"><span className="eyebrow-dot" /> YOUR PRIVATE MONEY DASHBOARD</div>
      <h2>Start with your transaction history.</h2>
      <p>Import CSV, Excel, or text-based PDF statements (OPay, Access Bank, Moniepoint and similar). Spendwise brings them together and shows your income, spending, and patterns in one place.</p>
      <div className="empty-actions"><button className="button button-primary" onClick={onImport}><FileText size={17} /> Import a bank statement</button><button className="button button-text" onClick={onDemo}>Explore with sample data</button></div>
      <div className="empty-foot"><LockKeyhole size={13} /> Statements are read locally and never uploaded.</div>
    </section>
  );
}

function CashflowChart({ data, currency }: { data: MonthTotal[]; currency: string }) {
  if (!data.length) return <div className="chart-empty"><BarChart3 size={17} />No months to chart yet</div>;
  const maxValue = Math.max(...data.flatMap((item) => [item.income, item.expenses]), 1);
  const chartHeight = 190;
  const chartWidth = 600;
  const left = 54;
  const right = 10;
  const top = 8;
  const bottom = 30;
  const usableHeight = chartHeight - top - bottom;
  const usableWidth = chartWidth - left - right;
  const xFor = (index: number) => left + (data.length === 1 ? usableWidth / 2 : (index / (data.length - 1)) * usableWidth);
  const yFor = (value: number) => chartHeight - bottom - (value / maxValue) * usableHeight;
  const polyline = (key: "income" | "expenses") => data.map((item, index) => `${xFor(index)},${yFor(item[key])}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const showPoints = data.length <= 24;
  return (
    <div className="chart-wrap">
      <svg className="cashflow-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Monthly income and spending, ${data[0].label} to ${data[data.length - 1].label}`}>
        {[0, 0.5, 1].map((fraction) => {
          const y = top + usableHeight * (1 - fraction);
          return <g key={fraction}><line x1={left} x2={chartWidth - right} y1={y} y2={y} className="chart-gridline" /><text x={left - 9} y={y + 4} textAnchor="end" className="chart-axis-label">{formatCurrency(maxValue * fraction, currency, true)}</text></g>;
        })}
        <polyline points={polyline("income")} className="chart-line chart-line-income" />
        <polyline points={polyline("expenses")} className="chart-line chart-line-expense" />
        {data.map((item, index) => (
          <g key={item.month}>
            {/* A wide invisible column makes every month hoverable even when points are hidden. */}
            <rect x={xFor(index) - usableWidth / Math.max(data.length, 2) / 2} y={top} width={usableWidth / Math.max(data.length, 2)} height={usableHeight} className="chart-hover-column">
              <title>{`${item.label}\nIncome: ${formatCurrency(item.income, currency)}\nSpending: ${formatCurrency(item.expenses, currency)}`}</title>
            </rect>
            {showPoints && <circle cx={xFor(index)} cy={yFor(item.income)} r="3.5" className="chart-point point-income" />}
            {showPoints && <circle cx={xFor(index)} cy={yFor(item.expenses)} r="3.5" className="chart-point point-expense" />}
            {index % labelEvery === 0 && <text x={xFor(index)} y={chartHeight - 7} textAnchor="middle" className="chart-axis-label">{item.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

function CategoryChart({
  categories,
  currency,
  large = false,
  onSelect,
}: {
  categories: ReturnType<typeof getCategoryTotals>;
  currency: string;
  large?: boolean;
  onSelect?: (category: Category) => void;
}) {
  const radius = 47;
  const circumference = 2 * Math.PI * radius;
  const total = categories.reduce((sum, item) => sum + item.amount, 0);
  let accumulated = 0;
  return (
    <div className={`category-chart-layout ${large ? "category-chart-layout--large" : ""}`}>
      <div className="donut-wrap">
        <svg className="donut-chart" viewBox="0 0 120 120" role="img" aria-label="Spending by category">
          <circle cx="60" cy="60" r={radius} className="donut-track" />
          {categories.map((item) => {
            const dash = total > 0 ? (item.amount / total) * circumference : 0;
            const offset = accumulated;
            accumulated += dash;
            return <circle key={item.category} cx="60" cy="60" r={radius} className="donut-segment" stroke={categoryColors[item.category]} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset}><title>{item.category}: {formatCurrency(item.amount, currency)}</title></circle>;
          })}
          <text x="60" y="56" textAnchor="middle" className="donut-center-label">SPENDING</text>
          <text x="60" y="73" textAnchor="middle" className="donut-center-value">{formatCurrency(total, currency, true)}</text>
        </svg>
      </div>
      <div className="category-legend">
        {categories.slice(0, large ? 10 : 6).map((item) => (
          <button className="category-row" key={item.category} onClick={() => onSelect?.(item.category)} disabled={!onSelect} title={onSelect ? `Show ${item.category} transactions` : undefined}>
            <span className="category-name"><i className="category-swatch" style={{ backgroundColor: categoryColors[item.category] }} />{item.category}</span>
            <span className="category-amount">{formatCurrency(item.amount, currency, true)}</span>
            <span className="category-share">{total > 0 ? Math.round((item.amount / total) * 100) : 0}%</span>
          </button>
        ))}
        {categories.length === 0 && <div className="chart-empty"><BarChart3 size={17} />No spending in this period</div>}
      </div>
    </div>
  );
}

function TransactionTable({
  transactions,
  currency,
  showSource = false,
  onChangeCategory,
  onToggleInternal,
  onDelete,
  similarCounts,
  rules = [],
}: {
  transactions: Transaction[];
  currency: string;
  showSource?: boolean;
  onChangeCategory?: (transactionId: string, category: Category) => void;
  onToggleInternal?: (transactionId: string) => void;
  onDelete?: (transactionId: string) => void;
  similarCounts?: ReadonlyMap<string, number>;
  rules?: CategoryRule[];
}) {
  const editable = Boolean(onChangeCategory || onToggleInternal || onDelete);
  return (
    <div className="transaction-table-wrap">
      <table className="transaction-table">
        <thead><tr><th>TRANSACTION</th><th>DATE</th>{showSource && <th>ACCOUNT</th>}<th>CATEGORY</th><th className="amount-heading">AMOUNT</th>{editable && <th aria-label="Actions" />}</tr></thead>
        <tbody>
          {transactions.map((transaction) => {
            const isIncome = transaction.direction === "income";
            const party = recogniseTransactionParty(transaction.description);
            const classification = classifyTransaction(transaction, rules);
            const similarCount = Math.max(0, (similarCounts?.get(transaction.id) ?? 0) - 1);
            return (
              <tr key={transaction.id} className={transaction.internalTransfer ? "row-internal" : undefined}>
                <td>
                  <div className="transaction-name-cell">
                    <div className={`transaction-icon ${isIncome ? "transaction-icon-income" : ""}`}>
                      {isIncome ? <ArrowDownLeft size={16} /> : transaction.category === "Transfers" ? <ArrowLeftRight size={15} /> : transaction.category === "Bank fees" ? <Receipt size={15} /> : <FileText size={15} />}
                    </div>
                    <div className="transaction-name-copy">
                      <strong title={transaction.description}>{transaction.description}</strong>
                      <span>{transaction.source}{transaction.manual ? " · added by you" : ""}{transaction.note ? ` · ${transaction.note}` : ""}</span>
                      {party && <span className="transaction-intelligence-label">{party.kind === "merchant" ? "Merchant" : party.kind === "recipient" ? "Recipient" : "Sender"} · {party.name}</span>}
                      {similarCount > 0 && <span className="transaction-intelligence-label">{similarCount} similar transaction{similarCount === 1 ? "" : "s"}</span>}
                      {classification.confidence < 0.5 && <span className="transaction-review-label">Review category</span>}
                      {transaction.internalTransfer && <span className="transaction-review-label">Own money moving · excluded from totals</span>}
                      {transaction.ownAccountCandidate && !transaction.internalTransfer && (
                        <span className="transaction-review-row">
                          <span className="transaction-review-label">Possible own-account transfer</span>
                          {onToggleInternal && <button className="transaction-confirm-button" onClick={() => onToggleInternal(transaction.id)}>Mark internal</button>}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="transaction-date">{formatDate(transaction.date)}{transaction.time && <small>{transaction.time.slice(0, 5)}</small>}</td>
                {showSource && <td><span className="account-pill"><span className="account-mini">{initialLetter(transaction.source)}</span>{transaction.source}</span></td>}
                <td>
                  {onChangeCategory ? (
                    <select
                      className={`category-select category-${transaction.category.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                      value={transaction.category}
                      onChange={(event) => onChangeCategory(transaction.id, event.target.value as Category)}
                      aria-label={`Category for ${transaction.description}`}
                    >
                      {categoryList.map((category) => <option key={category}>{category}</option>)}
                    </select>
                  ) : (
                    <span className={`category-pill category-${transaction.category.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{transaction.category}</span>
                  )}
                </td>
                <td className={`transaction-amount ${isIncome ? "amount-income" : ""}`}>{isIncome ? "+" : "−"}{new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: transaction.amount % 1 ? 2 : 0 }).format(transaction.amount)}</td>
                {editable && (
                  <td className="row-actions">
                    {onToggleInternal && (
                      <button className="icon-button" onClick={() => onToggleInternal(transaction.id)} title={transaction.internalTransfer ? "Count in totals again" : "Mark as my own money moving (exclude from totals)"} aria-label={transaction.internalTransfer ? "Include in totals" : "Exclude from totals"}>
                        <ArrowLeftRight size={14} />
                      </button>
                    )}
                    {onDelete && <button className="icon-button" onClick={() => onDelete(transaction.id)} title="Delete transaction" aria-label="Delete transaction"><Trash2 size={14} /></button>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddTransactionModal({
  currency,
  sources,
  onClose,
  onSave,
}: {
  currency: string;
  sources: string[];
  onClose: () => void;
  onSave: (transaction: Omit<Transaction, "id">) => void;
}) {
  const [date, setDate] = useState(localIsoDate());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<Direction>("expense");
  const [category, setCategory] = useState<Category>("Other");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [source, setSource] = useState("Cash");
  const [note, setNote] = useState("");

  const guessed = description.trim() ? categorise(description, direction) : direction === "income" ? "Income" : "Other";
  const effectiveCategory = categoryTouched ? category : guessed;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(amount);
    if (!date || !description.trim() || !Number.isFinite(value) || value <= 0) return;
    onSave({
      date,
      description: description.trim(),
      amount: Math.round(value * 100) / 100,
      direction,
      category: effectiveCategory,
      source: source.trim() || "Cash",
      ...(note.trim() ? { note: note.trim().slice(0, 280) } : {}),
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="privacy-modal savings-modal" role="dialog" aria-modal="true" aria-labelledby="add-transaction-heading">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="privacy-modal-icon"><Plus size={20} /></div>
        <div className="panel-kicker">MANUAL ENTRY</div>
        <h2 id="add-transaction-heading">Add a transaction</h2>
        <p className="savings-form-help">For cash spending, sales paid in cash, or anything not on a statement.</p>
        <form className="savings-form form-two-col" onSubmit={submit}>
          <div className="segmented form-full" role="group" aria-label="Money in or out">
            <button type="button" className={direction === "expense" ? "active" : ""} onClick={() => setDirection("expense")}>Money out</button>
            <button type="button" className={direction === "income" ? "active" : ""} onClick={() => setDirection("income")}>Money in</button>
          </div>
          <label className="form-full">Description<input autoFocus required maxLength={140} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={direction === "expense" ? "e.g. Fuel for generator" : "e.g. Cash sale"} /></label>
          <label>Amount ({currency})<input required type="number" min="0.01" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="5000" /></label>
          <label>Date<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>Category
            <select value={effectiveCategory} onChange={(event) => { setCategory(event.target.value as Category); setCategoryTouched(true); }}>
              {categoryList.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Account<input list="known-accounts" value={source} onChange={(event) => setSource(event.target.value)} maxLength={40} /></label>
          <datalist id="known-accounts">{["Cash", ...sources].map((item) => <option key={item} value={item} />)}</datalist>
          <label className="form-full">Note (optional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} placeholder="Anything you want to remember" /></label>
          <button className="button button-primary modal-done form-full" type="submit"><Check size={15} /> Save transaction</button>
        </form>
      </section>
    </div>
  );
}

function TransferReviewPanel({
  insights,
  currency,
  pendingCount,
  onReview,
  onConfirmAll,
}: {
  insights: ReturnType<typeof getTransferInsights>;
  currency: string;
  pendingCount: number;
  onReview: () => void;
  onConfirmAll: () => void;
}) {
  return (
    <section className="panel transfer-review-panel">
      <div className="panel-heading">
        <div><div className="panel-kicker">TRANSFER REVIEW</div><h2>Own-account and repeat transfers</h2></div>
        <span className="review-banner-actions">
          <button className="button button-secondary" onClick={onReview} disabled={pendingCount === 0}>Review one by one</button>
          <button className="button button-primary" onClick={onConfirmAll} disabled={pendingCount === 0}>Exclude all {pendingCount ? pendingCount.toLocaleString("en-NG") : ""}</button>
        </span>
      </div>
      <div className="transfer-review-summary">
        <div>
          <strong>{insights.ownAccountCandidateCount.toLocaleString("en-NG")}</strong>
          <span>unconfirmed own-account candidates in this period · {formatCurrency(insights.ownAccountSent, currency)} sent · {formatCurrency(insights.ownAccountReceived, currency)} received</span>
        </div>
        <div>
          <strong>{insights.confirmedInternalCount.toLocaleString("en-NG")}</strong>
          <span>entries excluded from totals (wallet ↔ savings pots and confirmed own transfers)</span>
        </div>
      </div>
      <p className="transfer-review-note">Candidates are transfers to or from your own name, your own account number, or your own bank card. They stay in your totals until you confirm them. Repeated counterparties below are grouped by name only.</p>
      {insights.repeatedCounterparties.length > 0 ? (
        <div className="counterparty-list">
          <div className="counterparty-list-heading"><span>REPEATED COUNTERPARTY</span><span>COUNT</span><span>SENT</span><span>RECEIVED</span></div>
          {insights.repeatedCounterparties.map((counterparty) => (
            <div className="counterparty-list-row" key={counterparty.name}>
              <strong title={counterparty.name}>{counterparty.name}</strong>
              <span>{counterparty.count}</span>
              <span>{formatCurrency(counterparty.sent, currency, true)}</span>
              <span>{formatCurrency(counterparty.received, currency, true)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="counterparty-empty">No transfer counterparty appears three or more times in this period.</div>
      )}
    </section>
  );
}

function InsightsPanel({
  count,
  topCategory,
  biggest,
  fees,
  totals,
  currency,
  onOpen,
}: {
  count: number;
  topCategory: ReturnType<typeof getCategoryTotals>[number] | undefined;
  biggest: Transaction | undefined;
  fees: number;
  totals: ReturnType<typeof calculateTotals>;
  currency: string;
  onOpen: () => void;
}) {
  return (
    <section className="insights-panel">
      <div className="insight-title"><span className="insight-sparkle"><Sparkles size={16} /></span><div><div className="panel-kicker">A CLOSER LOOK</div><h2>Your key takeaways</h2></div></div>
      <div className="insight-highlight">
        <span className="insight-number">01</span><div><span className="takeaway-label">TOP SPENDING AREA</span><strong>{topCategory?.category ?? "Not enough data yet"}</strong><p>{topCategory ? `${formatCurrency(topCategory.amount, currency)} across ${topCategory.count.toLocaleString("en-NG")} transactions` : "Import transactions to see what stands out."}</p></div>
      </div>
      <div className="insight-highlight">
        <span className="insight-number">02</span><div><span className="takeaway-label">LARGEST SINGLE PAYMENT</span><strong>{biggest ? formatCurrency(biggest.amount, currency) : "No outgoing yet"}</strong><p>{biggest ? biggest.description : "Your largest payment will appear here."}</p></div>
      </div>
      <div className="insight-highlight">
        <span className="insight-number">03</span><div><span className="takeaway-label">FEES & CHARGES</span><strong>{formatCurrency(fees, currency)}</strong><p>{totals.income > 0 ? `Savings rate this period: ${Math.round(totals.savingsRate)}%` : "Bank charges, levies, and stamp duty paid"}</p></div>
      </div>
      <div className="insight-foot"><span>{count.toLocaleString("en-NG")} transaction{count === 1 ? "" : "s"} analysed</span><button className="subtle-link" onClick={onOpen}>Explore insights <ArrowUpRight size={14} /></button></div>
    </section>
  );
}

function InsightDetail({ icon, title, value, detail, tone }: { icon: React.ReactNode; title: string; value: string; detail: string; tone: string }) {
  return <div className="insight-detail-card"><span className={`insight-detail-icon ${tone}`}>{icon}</span><div className="insight-detail-copy"><span>{title}</span><strong>{value}</strong><p>{detail}</p></div></div>;
}

function summarySentence(
  totals: ReturnType<typeof calculateTotals>,
  topCategory: ReturnType<typeof getCategoryTotals>[number] | undefined,
  currency: string,
): string {
  if (totals.transactionCount === 0) return "No transactions in this period yet. Pick another period or import a statement.";
  if (totals.income === 0) return `You’ve recorded ${formatCurrency(totals.expenses, currency)} in outgoing payments. Add income transactions for a complete cash-flow picture.`;
  const rate = Math.round(totals.savingsRate);
  const start = rate >= 0
    ? `You kept ${rate}% of the ${formatCurrency(totals.income, currency)} that came in`
    : `You spent ${formatCurrency(totals.expenses - totals.income, currency)} more than came in`;
  return `${start}${topCategory ? `, and ${topCategory.category.toLowerCase()} was your largest spending area at ${formatCurrency(topCategory.amount, currency)}.` : "."}`;
}

function PrivacyModal({ email, onClose }: { email: string | null; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="privacy-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-heading">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="privacy-modal-icon"><LockKeyhole size={21} /></div>
        <div className="panel-kicker">PRIVATE BY DESIGN</div>
        <h2 id="privacy-heading">Your records stay in this browser.</h2>
        <p>Statements and saved SportyBet pages are read on your device. Transactions are kept in this browser’s IndexedDB storage; goals, bets, rules, and budgets in its local storage.</p>
        {email && <p>Cloudflare Access verified your identity as <strong>{email}</strong>. Sign-in is only for access control; it does not upload or sync financial records.</p>}
        <ul><li><Check size={15} /> No bank login or credentials are collected</li><li><Check size={15} /> No financial records are sent to a server</li><li><Check size={15} /> Download a full backup file any time from Data & rules</li></ul>
        <p className="privacy-modal-note">Cloudflare Access sign-in verifies identity only. Your financial data remains on this device.</p>
        <button className="button button-primary modal-done" onClick={onClose}>Got it</button>
      </section>
    </div>
  );
}

function AccessCard({ status, onSignIn, onDetails }: { status: AccessStatus; onSignIn: () => void; onDetails: () => void }) {
  const checking = status.state === "checking";
  const title = checking
    ? "Checking sign-in"
    : status.state === "signed-in"
      ? "Cloudflare Access verified"
      : "Records stay on this device";
  const detail = status.state === "signed-in"
    ? `Signed in as ${status.email}. Financial records stay in this browser.`
    : status.state === "signed-out"
      ? "Your records stay in this browser. Sign in with Cloudflare Access if required."
      : status.state === "unavailable"
        ? status.message ?? "Access sign-in is not configured on this site."
        : "Financial records are stored locally in this browser.";
  return (
    <div className="privacy-card access-card" role="status" aria-live="polite">
      <div className="privacy-icon">{checking ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}</div>
      <strong>{title}</strong>
      <p title={detail}>{detail}</p>
      <div className="access-card-actions">
        {status.state === "signed-out" && <button onClick={onSignIn}><LockKeyhole size={12} /> Sign in</button>}
        <button onClick={onDetails}>How it works <ArrowUpRight size={13} /></button>
      </div>
    </div>
  );
}

export default App;
