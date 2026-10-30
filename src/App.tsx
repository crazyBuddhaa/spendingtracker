import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessCard, AddTransactionModal, ImportPreviewModal, PrivacyModal } from "./components/AppOverlays";
import { EmptyState, MetricCard, NavButton, PeriodSelect } from "./components/AppControls";
import { CashflowChart, CategoryChart } from "./components/DashboardCharts";
import { TransactionTable } from "./components/TransactionTable";
import { InsightDetail, InsightsPanel, summarySentence, TransferReviewPanel } from "./components/InsightWidgets";
import { initialLetter, pageTitles, relativeChange, periodOptions, sortNewestFirst, type Change, type Page } from "./app/constants";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  DatabaseBackup,
  Download,
  Filter,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  LoaderCircle,
  Menu,
  PiggyBank,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Ticket,
  TrendingDown,
  TrendingUp,
  Wallet,
  Users,
  X,
} from "lucide-react";
import { transactionsToCsv } from "./lib/csv";
import { parseStatementFile } from "./lib/statementImport";
import { inspectStoredTransactions, serializeTransactions, TRANSACTIONS_STORAGE_KEY } from "./lib/transactionStorage";
import { findNewTransactions } from "./lib/transactionDeduplication";
import { buildImportPreview, type ImportDateRange, type ImportMode, type ImportPreview } from "./lib/importPreview";
import { getTransferInsights } from "./lib/transactionPatterns";
import { readValue, requestPersistentStorage, writeValue } from "./lib/persistentStore";
import { applyCategoryRules, categorise, ruleMatches, similarityKey } from "./lib/categorise";
import { normaliseRecipientProfiles, resolveTransactionParty } from "./lib/recipientProfiles";
import { buildClassificationHistory, classifyTransaction, classifyTransactions, getSimilarTransactionCounts } from "./lib/transactionIntelligence";
import { detectRecurringRecipients, getClassificationReviewQueue, reclassifyHistoricalTransactions } from "./lib/transactionReview";
import { createBackup, normaliseBudgets, normaliseRules, readBackup } from "./lib/backup";
import {
  appendMutationEntry,
  auditLedger,
  matchTransfers,
  normaliseMutationLog,
  normaliseStatementSnapshots,
  transferMatchWindowDays,
  type InferredSuggestion,
} from "./lib/reconciliation";
import { getFeeSummary } from "./lib/analytics";
import { normaliseIncomeSourceOverrides, type IncomeSourceOverrides, type IncomeSourceType } from "./lib/financialIndicators";
import { downloadFile, formatCurrency, formatDate, localIsoDate, newId } from "./lib/format";
import SavingsPage from "./SavingsPage";
import BettingPage from "./BettingPage";
import InvestmentsPage from "./InvestmentsPage";
import BudgetsPage from "./BudgetsPage";
import DataPage from "./DataPage";
import ReconcilePage from "./components/ReconcilePage";
import InsightsExtras from "./InsightsExtras";
import ClassificationReviewPage from "./ClassificationReviewPage";
import RecipientProfilesPage from "./RecipientProfilesPage";
import BillsPage from "./BillsPage";
import AccountsPage from "./AccountsPage";
import FinancialIndicatorsPanel from "./FinancialIndicatorsPanel";
import { DEFAULT_ACCOUNT_PREFERENCES, normaliseAccountPreferences, summariseAccounts } from "./lib/accounts";
import { normaliseRecurringBills } from "./lib/recurringBills";
import { useAccessAuth } from "./useAccessAuth";
import { normaliseSavingsGoals } from "./lib/savings";
import { normaliseSavingsCircles } from "./lib/savingsCircles";
import { normaliseBets } from "./lib/sportyBetImport";
import { normaliseInvestments, type InvestmentStore } from "./lib/investments";
import { investmentActionLabels } from "./types";
import { parseBettingFile } from "./lib/bettingFileImport";
import { type BetPaymentMatch } from "./lib/bettingCorrelation";
import { linkKey, normaliseBettingLinks, type BettingLink } from "./lib/bettingLinks";
import {
  calculateTotals,
  filterByRange,
  getCategoryTotals,
  getMonthlySeries,
  previousRange,
  resolvePeriod,
  type DateRange,
  type Period,
} from "./lib/insights";
import {
  categoryList,
  type AccountPreferences,
  type BetCategory,
  type BetRecord,
  type Budget,
  type Category,
  type CategoryRule,
  type Direction,
  type ImportDiagnostics,
  type MutationEntry,
  type MutationKind,
  type InvestmentRecord,
  type RecipientProfile,
  type RecurringBill,
  type SavingsCircle,
  type SavingsContribution,
  type SavingsGoal,
  type StatementSnapshot,
  type Transaction,
} from "./types";

const SAVINGS_STORAGE_KEY = "spendwise.savings-goals.v1";
const CIRCLES_STORAGE_KEY = "spendwise.savings-circles.v1";
const BETS_STORAGE_KEY = "spendwise.bets.v1";
const RULES_STORAGE_KEY = "spendwise.rules.v1";
const BUDGETS_STORAGE_KEY = "spendwise.budgets.v1";
const RECIPIENT_PROFILES_STORAGE_KEY = "spendwise.recipient-profiles.v1";
const PERIOD_STORAGE_KEY = "spendwise.period.v1";
const BILLS_STORAGE_KEY = "spendwise.recurring-bills.v1";
const ACCOUNTS_STORAGE_KEY = "spendwise.account-preferences.v1";
const OPENING_BALANCE_STORAGE_KEY = "spendwise.projection-opening-balance.v1";
const INCOME_SOURCE_OVERRIDES_STORAGE_KEY = "spendwise.income-source-overrides.v1";
const SNAPSHOTS_STORAGE_KEY = "spendwise.statement-snapshots.v1";
const AUDIT_LOG_STORAGE_KEY = "spendwise.mutation-log.v1";
const INVESTMENTS_STORAGE_KEY = "spendwise.investments.v1";
const BETTING_LINKS_STORAGE_KEY = "spendwise.betting-links.v1";
const currency = "NGN";

const storageLabels: Record<string, string> = {
  [TRANSACTIONS_STORAGE_KEY]: "Transaction history",
  [SAVINGS_STORAGE_KEY]: "Savings goals",
  [CIRCLES_STORAGE_KEY]: "Contribution circles",
  [BETS_STORAGE_KEY]: "Betting records",
  [RULES_STORAGE_KEY]: "Category rules",
  [BUDGETS_STORAGE_KEY]: "Budgets",
  [RECIPIENT_PROFILES_STORAGE_KEY]: "Recipient profiles",
  [PERIOD_STORAGE_KEY]: "Selected period",
  [BILLS_STORAGE_KEY]: "Recurring items",
  [ACCOUNTS_STORAGE_KEY]: "Account preferences",
  [OPENING_BALANCE_STORAGE_KEY]: "Projection opening balance",
  [INCOME_SOURCE_OVERRIDES_STORAGE_KEY]: "Income-source labels",
  [SNAPSHOTS_STORAGE_KEY]: "Statement comparisons",
  [AUDIT_LOG_STORAGE_KEY]: "Audit trail",
  [INVESTMENTS_STORAGE_KEY]: "Investment ledger",
  [BETTING_LINKS_STORAGE_KEY]: "Betting links",
};




interface PendingStatementImport {
  transactions: Transaction[];
  skipped: number;
  diagnostics: ImportDiagnostics;
  diagnosticsAvailable: boolean;
  warnings: string[];
  files: File[];
}

function readJson<T>(key: string, normalise: (value: unknown) => T, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
    if (raw === null) {
      storageIssues.delete(key);
      return fallback;
    }
    const value = normalise(JSON.parse(raw));
    storageIssues.delete(key);
    return value;
  } catch {
    storageIssues.set(key, {
      key,
      raw,
      reason: "This saved value could not be read, so defaults are shown instead.",
    });
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

interface StorageIssue {
  key: string;
  /** The value exactly as it was stored, for a recovery download. */
  raw: string | null;
  reason: string;
}

const storageIssues = new Map<string, StorageIssue>();

function collectStorageIssues(): StorageIssue[] {
  return [...storageIssues.values()];
}

function parseRawValue(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
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
  const [bankLinks, setBankLinks] = useState<BettingLink[]>(() => readJson(BETTING_LINKS_STORAGE_KEY, normaliseBettingLinks, []));
  const [investmentStore, setInvestmentStore] = useState<InvestmentStore>(() =>
    readJson(INVESTMENTS_STORAGE_KEY, normaliseInvestments, { records: [], valuations: [] }));
  const [rules, setRules] = useState<CategoryRule[]>(() => readJson(RULES_STORAGE_KEY, normaliseRules, []));
  const [recipientProfiles, setRecipientProfiles] = useState<RecipientProfile[]>(() => readJson(RECIPIENT_PROFILES_STORAGE_KEY, normaliseRecipientProfiles, []));
  const [budgets, setBudgets] = useState<Budget[]>(() => readJson(BUDGETS_STORAGE_KEY, normaliseBudgets, []));
  const [incomeSourceOverrides, setIncomeSourceOverrides] = useState<IncomeSourceOverrides>(() =>
    readJson(INCOME_SOURCE_OVERRIDES_STORAGE_KEY, normaliseIncomeSourceOverrides, {}),
  );
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>(() => readJson(BILLS_STORAGE_KEY, normaliseRecurringBills, []));
  const [statementSnapshots, setStatementSnapshots] = useState<StatementSnapshot[]>(() => readJson(SNAPSHOTS_STORAGE_KEY, normaliseStatementSnapshots, []));
  const [auditLog, setAuditLog] = useState<MutationEntry[]>(() => readJson(AUDIT_LOG_STORAGE_KEY, normaliseMutationLog, []));
  const [accountPreferences, setAccountPreferences] = useState<AccountPreferences>(() => readJson(ACCOUNTS_STORAGE_KEY, normaliseAccountPreferences, DEFAULT_ACCOUNT_PREFERENCES));
  const [projectionOpeningBalance, setProjectionOpeningBalance] = useState<number>(() => readJson(OPENING_BALANCE_STORAGE_KEY, (value) => typeof value === "number" && Number.isFinite(value) ? value : 0, 0));
  const [storageReport, setStorageReport] = useState<StorageIssue[]>(() => collectStorageIssues());
  const writesBlocked = useRef(storageReport.length > 0);
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
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(() => new Set());
  const [bulkCategory, setBulkCategory] = useState<Category>("Other");
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
      if (value !== null) void requestPersistentStorage();
      const inspection = inspectStoredTransactions(value ?? null);
      setTransactions(inspection.transactions);
      if (inspection.reason || inspection.dropped > 0) {
        // Stop saving until the user decides, otherwise the next save would overwrite
        // records that might still be recoverable.
        writesBlocked.current = true;
        setStorageReport((current) => [
          ...current.filter((issue) => issue.key !== TRANSACTIONS_STORAGE_KEY),
          {
            key: TRANSACTIONS_STORAGE_KEY,
            raw: value ?? null,
            reason: inspection.reason
              ?? `${inspection.dropped.toLocaleString("en-NG")} saved transaction${inspection.dropped === 1 ? "" : "s"} could not be read.`,
          },
        ]);
      }
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
      if (writesBlocked.current) return;
      void writeValue(TRANSACTIONS_STORAGE_KEY, serializeTransactions(transactions)).then((ok) => {
        if (ok) void requestPersistentStorage();
        else notify("Could not save to this browser. Download a backup from Data & rules before closing this tab.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [transactions, loaded, notify]);

  useEffect(() => {
    persistJson(PERIOD_STORAGE_KEY, { period, custom: customRange });
  }, [period, customRange]);

  useEffect(() => {
    setTransactionLimit(100);
    setSelectedTransactionIds(new Set());
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
  const accountSummaries = useMemo(() => summariseAccounts(transactions, accountPreferences), [transactions, accountPreferences]);
  const previousTotals = useMemo(() => {
    const previous = previousRange(period, range);
    return previous ? calculateTotals(filterByRange(transactions, previous)) : null;
  }, [transactions, period, range]);
  const classificationHistory = useMemo(() => buildClassificationHistory(transactions, recipientProfiles), [transactions, recipientProfiles]);
  const similarTransactionCounts = useMemo(() => getSimilarTransactionCounts(transactions, recipientProfiles), [transactions, recipientProfiles]);
  const classificationReviewQueue = useMemo(
    () => getClassificationReviewQueue(transactions, rules, classificationHistory, recipientProfiles),
    [transactions, rules, classificationHistory, recipientProfiles],
  );
  const recurringRecipients = useMemo(() => detectRecurringRecipients(transactions, recipientProfiles), [transactions, recipientProfiles]);
  const recurringTransactionIds = useMemo(
    () => new Set(recurringRecipients.flatMap((recipient) => recipient.transactionIds)),
    [recurringRecipients],
  );
  const ledgerIssues = useMemo(() => auditLedger(transactions), [transactions]);
  const transferIntel = useMemo(() => matchTransfers(transactions, transferMatchWindowDays), [transactions]);
  const inferredTransactionCount = useMemo(() => transactions.filter((transaction) => transaction.inferred).length, [transactions]);
  const reconcileIssueCount = ledgerIssues.length + transferIntel.unmatched.length + inferredTransactionCount;

  const visibleTransactions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
    return withinPeriod
      .filter((transaction) => categoryFilter === "All categories" || transaction.category === categoryFilter)
      .filter((transaction) => directionFilter === "All types" || transaction.direction === directionFilter)
      .filter((transaction) => sourceFilter === "All accounts" || transaction.source === sourceFilter)
      .filter((transaction) => !ownTransferFilter || (transaction.ownAccountCandidate === true && !transaction.internalTransfer))
      .filter((transaction) => !hideInternal || !transaction.internalTransfer)
      .filter((transaction) => {
        if (!normalizedQuery) return true;
        const party = resolveTransactionParty(transaction.description, recipientProfiles);
        return `${transaction.description} ${transaction.category} ${transaction.source} ${transaction.note ?? ""} ${transaction.amount} ${party?.name ?? ""} ${party?.profile?.aliases.join(" ") ?? ""}`.toLowerCase().replace(/\s+/g, " ").includes(normalizedQuery);
      })
      .sort(sortNewestFirst);
  }, [withinPeriod, query, categoryFilter, directionFilter, sourceFilter, ownTransferFilter, hideInternal, recipientProfiles]);
  const displayedTransactions = useMemo(() => visibleTransactions.slice(0, transactionLimit), [visibleTransactions, transactionLimit]);
  const visibleTotals = useMemo(() => calculateTotals(visibleTransactions), [visibleTransactions]);

  const access = useAccessAuth();

  // Never overwrite a value we could not read until the user has had a chance to
  // download it; the storage banner explains the pause.
  const persistJson = (key: string, value: unknown): boolean => {
    if (writesBlocked.current) return true;
    return saveJson(key, value);
  };

  const updateSavingsGoals = (next: SavingsGoal[]) => {
    setSavingsGoals(next);
    if (!persistJson(SAVINGS_STORAGE_KEY, next)) notify("Could not save your goals in this browser. Download a backup before closing this tab.");
  };

  const updateSavingsCircles = (next: SavingsCircle[]) => {
    setSavingsCircles(next);
    if (!persistJson(CIRCLES_STORAGE_KEY, next)) notify("Could not save contribution circles in this browser. Download a backup before closing this tab.");
  };

  const updateBets = (next: BetRecord[]) => {
    setBets(next);
    if (!persistJson(BETS_STORAGE_KEY, next)) notify("Could not save betting records in this browser. Download a backup before closing this tab.");
  };

  const updateRules = (next: CategoryRule[]) => {
    setRules(next);
    if (!persistJson(RULES_STORAGE_KEY, next)) notify("Could not save your rules in this browser.");
  };

  const updateRecipientProfiles = (next: RecipientProfile[]) => {
    const normalised = normaliseRecipientProfiles(next);
    setRecipientProfiles(normalised);
    if (!persistJson(RECIPIENT_PROFILES_STORAGE_KEY, normalised)) notify("Could not save recipient profiles in this browser.");
  };

  const updateBudgets = (next: Budget[]) => {
    setBudgets(next);
    if (!persistJson(BUDGETS_STORAGE_KEY, next)) notify("Could not save your budgets in this browser.");
  };

  const updateIncomeSourceOverride = (sourceKey: string, type: IncomeSourceType | null) => {
    const next = { ...incomeSourceOverrides };
    if (type === null) delete next[sourceKey];
    else Object.defineProperty(next, sourceKey, { value: type, enumerable: true, configurable: true, writable: true });
    const normalised = normaliseIncomeSourceOverrides(next);
    setIncomeSourceOverrides(normalised);
    if (!persistJson(INCOME_SOURCE_OVERRIDES_STORAGE_KEY, normalised)) {
      notify("Could not save the income-source label in this browser. Download a backup before closing this tab.");
    }
  };

  const updateRecurringBills = (next: RecurringBill[]) => {
    setRecurringBills(next);
    if (!persistJson(BILLS_STORAGE_KEY, next)) notify("Could not save recurring items in this browser.");
  };

  const updateAccountPreferences = (next: AccountPreferences) => {
    setAccountPreferences(next);
    if (!persistJson(ACCOUNTS_STORAGE_KEY, next)) notify("Could not save account display preferences in this browser.");
  };

  const updateProjectionOpeningBalance = (value: number) => {
    setProjectionOpeningBalance(value);
    if (!persistJson(OPENING_BALANCE_STORAGE_KEY, value)) notify("Could not save the projection opening balance in this browser.");
  };

  const updateStatementSnapshots = (next: StatementSnapshot[]) => {
    setStatementSnapshots(next);
    if (!writesBlocked.current && !saveJson(SNAPSHOTS_STORAGE_KEY, next)) notify("Could not save statement comparisons in this browser.");
  };

  /** Appends one audit entry; the log is append-only and local-only. */
  const recordMutation = (kind: MutationKind, detail: string, options?: { ids?: string[]; evidence?: string }) => {
    const entry: MutationEntry = {
      id: newId("trail"),
      at: new Date().toISOString(),
      kind,
      detail,
      ...(options?.ids ? { transactionIds: options.ids } : {}),
      ...(options?.evidence ? { evidence: options.evidence } : {}),
    };
    setAuditLog((current) => {
      const next = appendMutationEntry(current, entry);
      // The audit trail is informational, so a failed save never blocks the app.
      if (!writesBlocked.current) saveJson(AUDIT_LOG_STORAGE_KEY, next);
      return next;
    });
  };

  const importFiles = async (files: FileList | File[]) => {
    if (writesBlocked.current) {
      notify("Download the unreadable saved data or discard it before importing new statements.");
      return;
    }
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
      imported: classifyTransactions(pendingImport.transactions, rules, classificationHistory, recipientProfiles),
      existing: transactions,
      diagnostics: pendingImport.diagnosticsAvailable ? pendingImport.diagnostics : undefined,
      skipped: pendingImport.skipped,
      mode: importMode,
      month: importMonth,
      customRange: importCustomRange,
      comparisonAvailable,
    })
    : null, [pendingImport, transactions, rules, classificationHistory, recipientProfiles, importMode, importMonth, importCustomRange, comparisonAvailable]);

  const confirmImport = () => {
    if (!pendingImport || !importPreview?.rangeValid) return;
    const imported = importPreview.transactionsInRange;
    const newTransactions = findNewTransactions(transactions, classifyTransactions(importPreview.transactionsForConfirmation, rules, classificationHistory, recipientProfiles));
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
      recordMutation("import", `${newTransactions.length.toLocaleString("en-NG")} transaction row${newTransactions.length === 1 ? "" : "s"} imported from ${pendingImport.files.map((file) => file.name).join(", ")}.`, {
        ids: newTransactions.map((transaction) => transaction.id),
        evidence: "Rows were appended exactly as parsed; the importer does not modify values. Skip count below covers duplicate rows.",
      });
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
      transaction.id === transactionId ? { ...transaction, category, categoryLocked: true, rejectedSuggestion: undefined } : transaction));
    recordMutation("update", `Category set to “${category}” on “${target.description}” (${formatDate(target.date)}, ${target.source}).`, {
      ids: [transactionId],
      evidence: `Previous category: ${target.category}. Category locked so automatic rules skip it.`,
    });
    const pattern = similarityKey(target.description);
    if (pattern.length < 3) return;
    const probe = { id: "", pattern, category, direction: target.direction, createdAt: "" };
    const similar = transactions.filter((transaction) =>
      transaction.id !== transactionId && !transaction.categoryLocked && !transaction.manual &&
      transaction.category !== category && ruleMatches(probe, transaction)).length;
    setPendingRule({ pattern, category, direction: target.direction, count: similar });
  };

  const toggleTransactionSelection = (transactionId: string) => {
    setSelectedTransactionIds((current) => {
      const next = new Set(current);
      if (next.has(transactionId)) next.delete(transactionId);
      else next.add(transactionId);
      return next;
    });
  };

  const selectDisplayedTransactions = (shown: Transaction[], selected: boolean) => {
    setSelectedTransactionIds((current) => {
      const next = new Set(current);
      for (const transaction of shown) {
        if (selected) next.add(transaction.id);
        else next.delete(transaction.id);
      }
      return next;
    });
  };

  const applyBulkCategory = () => {
    if (!selectedTransactionIds.size) return;
    const ids = new Set(selectedTransactionIds);
    const applied = transactions.filter((transaction) => ids.has(transaction.id)).length;
    const changed = transactions.filter((transaction) => ids.has(transaction.id) && transaction.category !== bulkCategory).length;
    setTransactions((current) => current.map((transaction) => ids.has(transaction.id)
      ? { ...transaction, category: bulkCategory, categoryLocked: true, rejectedSuggestion: undefined }
      : transaction));
    recordMutation("update", `Bulk category “${bulkCategory}” applied to ${applied.toLocaleString("en-NG")} transaction${applied === 1 ? "" : "s"}; ${changed.toLocaleString("en-NG")} categor${changed === 1 ? "y" : "ies"} actually changed.`, {
      ids: [...ids],
      evidence: "Each affected row is now category-locked.",
    });
    setSelectedTransactionIds(new Set());
    notify(`${applied.toLocaleString("en-NG")} transaction${applied === 1 ? "" : "s"} set to ${bulkCategory} · ${changed.toLocaleString("en-NG")} categor${changed === 1 ? "y" : "ies"} changed.`);
  };

  const resolveReviewCandidate = (transactionId: string, decision: "accept" | "reject" | "confirm") => {
    const target = transactions.find((transaction) => transaction.id === transactionId);
    if (!target) return;
    const suggestion = classifyTransaction(target, rules, classificationHistory, recipientProfiles);
    if (decision === "reject" && suggestion.category === target.category) return;
    setTransactions((current) => current.map((transaction) => {
      if (transaction.id !== transactionId) return transaction;
      if (decision === "accept") {
        return { ...transaction, category: suggestion.category, categoryLocked: true, rejectedSuggestion: undefined };
      }
      if (decision === "reject") {
        return { ...transaction, categoryLocked: true, rejectedSuggestion: suggestion.category };
      }
      return { ...transaction, categoryLocked: true, rejectedSuggestion: undefined };
    }));
    recordMutation("update", decision === "reject"
      ? `Suggestion “${suggestion.category}” rejected for “${target.description}” (${formatDate(target.date)}); the payee learns to keep “${target.category}”.`
      : `Classification confirmed as “${decision === "accept" ? suggestion.category : target.category}” on “${target.description}” (${formatDate(target.date)}).`, {
      ids: [transactionId],
      evidence: `Classifier had suggested “${suggestion.category}” at ${Math.round(suggestion.confidence * 100)}% (${suggestion.reason}).`,
    });
    notify(decision === "reject"
      ? `Suggestion rejected. Future matches for this payee will learn ${target.category}.`
      : `Category confirmed as ${decision === "accept" ? suggestion.category : target.category}.`);
  };

  const resolveBulkReview = (transactionIds: string[], decision: "accept" | "confirm") => {
    const ids = new Set(transactionIds);
    let changed = 0;
    setTransactions((current) => current.map((transaction) => {
      if (!ids.has(transaction.id)) return transaction;
      const suggestion = classifyTransaction(transaction, rules, classificationHistory, recipientProfiles);
      if (decision === "accept" && suggestion.category === transaction.category) return transaction;
      changed += 1;
      return {
        ...transaction,
        category: decision === "accept" ? suggestion.category : transaction.category,
        categoryLocked: true,
        rejectedSuggestion: undefined,
      };
    }));
    notify(`${changed.toLocaleString("en-NG")} review decision${changed === 1 ? "" : "s"} confirmed.`);
    recordMutation("update", `${changed.toLocaleString("en-NG")} review decision${changed === 1 ? "" : "s"} confirmed (${decision === "accept" ? "suggested categories accepted" : "current categories locked"}).`, {
      ids: transactionIds,
    });
  };

  const acceptSuggestionAndCreateRule = (transactionId: string, rule: Omit<CategoryRule, "id" | "createdAt">) => {
    resolveReviewCandidate(transactionId, "accept");
    addRule(rule);
  };

  const addRule = (rule: Omit<CategoryRule, "id" | "createdAt">) => {
    const created: CategoryRule = { ...rule, id: newId("rule"), createdAt: localIsoDate() };
    updateRules([...rules, created]);
    const next = applyCategoryRules(transactions, [created]);
    const changed = next.filter((transaction, index) => transaction !== transactions[index]).length;
    setTransactions(next);
    if (!changed) return;
    recordMutation("update", `Rule “${rule.pattern}” → “${rule.category}” affected ${changed.toLocaleString("en-NG")} unlocked transaction${changed === 1 ? "" : "s"}.`, {
      ids: next.filter((transaction, index) => transaction !== transactions[index]).map((transaction) => transaction.id),
      evidence: "Locked manual categories and manual entries were left untouched.",
    });
    notify(`Rule saved · ${changed.toLocaleString("en-NG")} transaction${changed === 1 ? "" : "s"} updated.`);
  };

  const acceptPendingRule = () => {
    if (!pendingRule) return;
    addRule({ pattern: pendingRule.pattern, category: pendingRule.category, direction: pendingRule.direction });
    setPendingRule(null);
  };

  const toggleInternal = (transactionId: string) => {
    const target = transactions.find((transaction) => transaction.id === transactionId);
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
    if (target) {
      recordMutation("update", `“${target.description}” (${formatDate(target.date)}) is ${target.internalTransfer ? "counted in totals again" : "marked as your own money moving between accounts and excluded from totals"}.`, {
        ids: [transactionId],
        evidence: target.internalTransfer
          ? "Internal mark removed; category returned to its rule-based value where allowed."
          : "Internal transfers never change the underlying amounts, only which totals include them.",
      });
    }
  };

  const confirmAllOwnTransfers = () => {
    if (!allOwnCandidates) return;
    if (!window.confirm(`Mark all ${allOwnCandidates.toLocaleString("en-NG")} possible own-account transfers as internal? They will be excluded from income and spending totals. You can undo any one of them from the Transactions page.`)) return;
    setTransactions((current) => current.map((transaction) =>
      transaction.ownAccountCandidate && !transaction.internalTransfer
        ? { ...transaction, internalTransfer: true, ownAccountCandidate: false, category: "Transfers" }
        : transaction));
    const confirmedIds = transactions.filter((transaction) => transaction.ownAccountCandidate && !transaction.internalTransfer).map((transaction) => transaction.id);
    recordMutation("update", `${confirmedIds.length.toLocaleString("en-NG")} own-account transfer candidate${confirmedIds.length === 1 ? "" : "s"} confirmed as internal and excluded from totals.`, {
      ids: confirmedIds,
      evidence: "Confirmations rely on the own-name, own-account-number, and own-card checks in the importer; totals no longer include them.",
    });
    notify(`${allOwnCandidates.toLocaleString("en-NG")} transfers between your own accounts are now excluded from totals.`);
  };

  const deleteTransaction = (transactionId: string) => {
    if (!window.confirm("Delete this transaction from your history?")) return;
    const target = transactions.find((transaction) => transaction.id === transactionId);
    setTransactions((current) => current.filter((transaction) => transaction.id !== transactionId));
    recordMutation("delete", `Deleted “${target?.description ?? transactionId}” (${target ? `${formatDate(target.date)}, ${formatCurrency(target.amount, currency)}` : "record not found for this report"}).`, {
      ids: [transactionId],
      evidence: "Deletion removes it from totals. The statement file itself is never touched; re-importing restores the row.",
    });
    notify("Transaction deleted.");
  };

  const addManualTransaction = (transaction: Omit<Transaction, "id">) => {
    const created: Transaction = { ...transaction, id: newId("manual"), manual: true, categoryLocked: true };
    setTransactions((current) => [...current, created]);
    recordMutation("add", `Manual entry added: “${created.description}” ${created.direction === "income" ? "+" : "−"}${formatCurrency(created.amount, currency)} (${formatDate(created.date)}).`, {
      ids: [created.id],
    });
    setShowAddTransaction(false);
    if (!filterByRange([{ ...transaction, id: "" }], range).length) setPeriod("all");
    notify("Transaction added.");
  };

  const refreshAllCategories = (startDate?: string, endDate?: string) => {
    const rangeText = startDate || endDate
      ? `${startDate ? formatDate(startDate) : "earliest history"} through ${endDate ? formatDate(endDate) : "latest history"}`
      : "all imported history";
    const eligible = transactions.filter((transaction) =>
      !transaction.manual && !transaction.categoryLocked &&
      (!startDate || transaction.date >= startDate) &&
      (!endDate || transaction.date <= endDate)).length;
    if (!eligible) {
      notify("No unlocked transactions are in that date range.");
      return;
    }
    if (!window.confirm(`Reclassify up to ${eligible.toLocaleString("en-NG")} unlocked transactions in ${rangeText}? Hand-picked categories and manual entries will stay unchanged.`)) return;
    const result = reclassifyHistoricalTransactions(transactions, rules, classificationHistory, { start: startDate, end: endDate }, recipientProfiles);
    setTransactions(result.transactions);
    recordMutation("update", `History re-classification across ${rangeText}: ${result.changed.toLocaleString("en-NG")} categor${result.changed === 1 ? "y" : "ies"} of ${result.eligible.toLocaleString("en-NG")} eligible transactions.`, {
      ids: result.transactions.filter((transaction, index) => transaction !== transactions[index]).map((transaction) => transaction.id),
      evidence: "Hand-picked categories and manual entries were not touched.",
    });
    notify(`${result.changed.toLocaleString("en-NG")} categor${result.changed === 1 ? "y" : "ies"} changed across ${result.eligible.toLocaleString("en-NG")} eligible transactions.`);
  };

  const saveRecipientProfile = (profile: RecipientProfile) => {
    const nextProfiles = normaliseRecipientProfiles([...recipientProfiles.filter((item) => item.id !== profile.id), profile]);
    updateRecipientProfiles(nextProfiles);
    const history = buildClassificationHistory(transactions, nextProfiles);
    const result = reclassifyHistoricalTransactions(transactions, rules, history, {}, nextProfiles);
    setTransactions(result.transactions);
    recordMutation("update", `Recipient profile “${profile.name}” saved; ${result.changed.toLocaleString("en-NG")} unlocked categor${result.changed === 1 ? "y" : "ies"} refreshed.`, {
      evidence: "Aliases from the statement variants feed the same identity; locked manual categories were not overwritten.",
    });
    notify(`Profile saved · ${result.changed.toLocaleString("en-NG")} unlocked categor${result.changed === 1 ? "y" : "ies"} refreshed.`);
  };

  const deleteRecipientProfile = (profileId: string) => {
    const profile = recipientProfiles.find((item) => item.id === profileId);
    if (!window.confirm(`Remove${profile ? ` “${profile.name}”` : " this recipient profile"}? Unlocked transactions will be recategorised from the remaining rules and history.`)) return;
    const nextProfiles = recipientProfiles.filter((item) => item.id !== profileId);
    updateRecipientProfiles(nextProfiles);
    const history = buildClassificationHistory(transactions, nextProfiles);
    const result = reclassifyHistoricalTransactions(transactions, rules, history, {}, nextProfiles);
    setTransactions(result.transactions);
    notify("Profile removed. Unlocked transactions returned to their remaining rules and history.");
  };

  /* -------------------------------------------- transparency & reconciliation */

  const saveStatementSnapshot = (snapshot: Omit<StatementSnapshot, "id" | "createdAt">) => {
    const created: StatementSnapshot = { ...snapshot, id: newId("snap"), createdAt: new Date().toISOString() };
    updateStatementSnapshots([...statementSnapshots, created]);
    recordMutation("update", `Statement comparison added for ${snapshot.account}, ${formatDate(snapshot.periodStart)} – ${formatDate(snapshot.periodEnd)}.`, {
      evidence: "Declared balances and totals live only in this browser and are compared against recorded rows.",
    });
    notify("Statement period saved for comparison.");
  };

  const deleteStatementSnapshot = (snapshotId: string) => {
    const snapshot = statementSnapshots.find((item) => item.id === snapshotId);
    const confirmed = snapshot && `${snapshot.account} (${formatDate(snapshot.periodStart)} – ${formatDate(snapshot.periodEnd)})`;
    updateStatementSnapshots(statementSnapshots.filter((item) => item.id !== snapshotId));
    recordMutation("delete", `Statement comparison removed${confirmed ? ` for ${confirmed}` : ""}.`, {
      evidence: "Only the declared figures were removed; recorded transactions are untouched.",
    });
    notify("Comparison removed. Recorded transactions are unchanged.");
  };

  const addInferredTransaction = (suggestion: InferredSuggestion) => {
    const note = `Inferred by reconciliation: ${suggestion.basis}`.slice(0, 280);
    const created: Transaction = {
      id: newId("inferred"),
      date: suggestion.date,
      description: suggestion.description,
      amount: suggestion.amount,
      direction: suggestion.direction,
      category: suggestion.direction === "income" ? "Income" : "Other",
      source: suggestion.account,
      inferred: true,
      note,
    };
    setTransactions((current) => [...current, created]);
    recordMutation("inferred-add", `Inferred record accepted: “${suggestion.description}” ${suggestion.direction === "income" ? "+" : "−"}${formatCurrency(suggestion.amount, currency)} on ${formatDate(suggestion.date)} in ${suggestion.account}.`, {
      ids: [created.id],
      evidence: suggestion.basis,
    });
    notify("Added as an inferred record. It stays labelled until you verify it.");
  };

  const verifyInferredTransaction = (transactionId: string) => {
    const target = transactions.find((transaction) => transaction.id === transactionId && transaction.inferred);
    if (!target) return;
    setTransactions((current) => current.map((transaction) =>
      transaction.id === transactionId ? { ...transaction, inferred: false } : transaction));
    recordMutation("verify", `Inferred record “${target.description}” (${formatDate(target.date)}, ${formatCurrency(target.amount, currency)}) verified as an original record by you.`, {
      ids: [transactionId],
      evidence: target.note ?? undefined,
    });
    notify("Verified. The record now counts like any original row.");
  };

  /* ---------------------------------------------- recurring planning */

  const saveRecurringBill = (bill: RecurringBill) => {
    const exists = recurringBills.some((item) => item.id === bill.id);
    updateRecurringBills(exists ? recurringBills.map((item) => item.id === bill.id ? bill : item) : [...recurringBills, bill]);
    notify(`“${bill.name}” ${exists ? "updated" : "added to the recurring calendar"}.`);
  };

  const deleteRecurringBill = (billId: string) => {
    const bill = recurringBills.find((item) => item.id === billId);
    if (!bill || !window.confirm(`Delete “${bill.name}” from the recurring calendar? Existing transactions are unchanged.`)) return;
    updateRecurringBills(recurringBills.filter((item) => item.id !== billId));
    notify("Recurring item deleted.");
  };

  const toggleRecurringBill = (billId: string) => {
    updateRecurringBills(recurringBills.map((bill) => bill.id === billId ? { ...bill, paused: !bill.paused || undefined } : bill));
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
    if (!window.confirm("Delete this bet record? This cannot be undone.")) return;
    updateBets(bets.filter((bet) => bet.id !== betId));
    notify("Bet record deleted.");
  };

  const confirmBetLink = (match: BetPaymentMatch) => {
    if (bankLinks.some((link) => linkKey(link.betId, link.transactionId) === linkKey(match.betId, match.transactionId))) {
      notify("That pair is already linked.");
      return;
    }
    const bet = bets.find((row) => row.id === match.betId);
    const transaction = transactions.find((row) => row.id === match.transactionId);
    if (!bet || !transaction) {
      notify("That record is no longer available; the suggestion will clear on its own.");
      return;
    }
    const link: BettingLink = {
      id: newId("blink"),
      betId: match.betId,
      transactionId: match.transactionId,
      side: match.side,
      method: match.method,
      amount: match.betAmount,
      date: match.bankDate,
      linkedOn: localIsoDate(),
      ...(match.operator ? { operator: match.operator } : {}),
    };
    const next = [...bankLinks, link];
    setBankLinks(next);
    if (!persistJson(BETTING_LINKS_STORAGE_KEY, next)) notify("Could not save the link in this browser. Download a backup before closing this tab.");
    recordMutation("add", `Bank row linked: “${transaction.description}” (${formatDate(transaction.date)}, ${formatCurrency(transaction.amount, currency)}) ↔ ${match.side === "stake" ? "stake" : "return"} on bet ${bet.source} (${formatDate(bet.date)}), found by ${match.method}.`, {
      evidence: "Links are bookkeeping only; no transaction, bet, or category was changed.",
    });
    notify("Link confirmed. Correlation figures now count it.");
  };

  const removeBetLink = (linkId: string) => {
    const link = bankLinks.find((row) => row.id === linkId);
    if (!link) return;
    const bet = bets.find((row) => row.id === link.betId);
    const transaction = transactions.find((row) => row.id === link.transactionId);
    setBankLinks(bankLinks.filter((row) => row.id !== linkId));
    recordMutation("delete", `Bank link removed: “${transaction?.description ?? link.transactionId}” ↔ ${link.side === "stake" ? "stake" : "return"} on ${bet?.source ?? link.betId} (${formatDate(link.date)}).`, {
      evidence: "Only the link was removed; the bet, the transaction, and all other links were untouched.",
    });
    notify("Link removed.");
  };

  /* ------------------------------------------ investments (own model) */

  const updateInvestments = (next: InvestmentStore) => {
    setInvestmentStore(next);
    if (!persistJson(INVESTMENTS_STORAGE_KEY, next)) notify("Could not save the investment ledger in this browser. Download a backup before closing this tab.");
  };

  const createInvestmentRecord = (record: Omit<InvestmentRecord, "id">) => {
    const created: InvestmentRecord = { ...record, id: newId("inv") };
    updateInvestments({ records: [...investmentStore.records, created], valuations: investmentStore.valuations });
    recordMutation("add", `Investment event recorded: ${investmentActionLabels[created.action]} ${created.asset} — ${formatCurrency(created.amount, currency)} (${formatDate(created.date)}, ${created.broker}).`, {
      evidence: "Investment events live in their own ledger and never change bank-transaction totals.",
    });
    notify("Investment event recorded.");
  };

  const deleteInvestmentRecord = (recordId: string) => {
    const record = investmentStore.records.find((row) => row.id === recordId);
    if (!record) return;
    updateInvestments({
      records: investmentStore.records.filter((row) => row.id !== recordId),
      valuations: investmentStore.valuations,
    });
    recordMutation("delete", `Investment event deleted: ${record.asset} — ${formatCurrency(record.amount, currency)} (${formatDate(record.date)}).`, {
      evidence: "Only this ledger row was removed; sibling events and value marks for other assets were untouched.",
    });
    notify("Investment event deleted.");
  };

  const setAssetValuation = (asset: string, marketValue: number, asOf: string) => {
    const key = asset.toLowerCase();
    const existing = investmentStore.valuations.find((valuation) => valuation.asset.toLowerCase() === key && valuation.asOf === asOf);
    const valuations = existing
      ? investmentStore.valuations.map((valuation) => valuation.id === existing.id ? { ...valuation, marketValue } : valuation)
      : [...investmentStore.valuations, { id: newId("val"), asset, marketValue, asOf }];
    updateInvestments({ records: investmentStore.records, valuations });
    recordMutation("update", `Current value marked for ${asset}: ${formatCurrency(marketValue, currency)} as of ${formatDate(asOf)}.`, {
      evidence: "Value marks are manual; the app does not fetch live prices.",
    });
    notify(`Value mark saved for ${asset}.`);
  };

  const clearAssetValuation = (asset: string) => {
    updateInvestments({
      records: investmentStore.records,
      valuations: investmentStore.valuations.filter((valuation) => valuation.asset.toLowerCase() !== asset.toLowerCase()),
    });
    recordMutation("delete", `Value marks cleared for ${asset}.`, {
      evidence: "Recorded events for the asset are untouched.",
    });
    notify(`Value marks cleared for ${asset}.`);
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
    const goal = savingsGoals.find((item) => item.id === goalId);
    if (!window.confirm(`Delete the savings goal${goal ? ` “${goal.name}”` : ""} and its contribution history? This cannot be undone.`)) return;
    updateSavingsGoals(savingsGoals.filter((item) => item.id !== goalId));
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
    const circle = savingsCircles.find((item) => item.id === circleId);
    if (!window.confirm(`Delete the contribution circle${circle ? ` “${circle.name}”` : ""} and its local history? This cannot be undone.`)) return;
    updateSavingsCircles(savingsCircles.filter((item) => item.id !== circleId));
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
      createBackup({ transactions, savingsGoals, savingsCircles, bets, rules, budgets, recipientProfiles, recurringBills, accountPreferences, incomeSourceOverrides, projectionOpeningBalance, statementSnapshots, mutationLog: auditLog, investments: investmentStore, bettingLinks: bankLinks }),
      `spendwise-backup-${localIsoDate()}.json`,
      "application/json",
    );
    notify("Backup downloaded. Keep it somewhere safe — it contains your full history.");
  };

  const downloadStorageRecovery = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      note: "Raw Spendwise browser data captured because some values could not be read.",
      entries: storageReport.map((issue) => ({
        store: storageLabels[issue.key] ?? issue.key,
        key: issue.key,
        reason: issue.reason,
        value: parseRawValue(issue.raw),
      })),
    };
    downloadFile(
      JSON.stringify(payload, null, 2),
      `spendwise-recovery-${localIsoDate()}.json`,
      "application/json",
    );
    notify("Raw saved data downloaded for recovery.");
  };

  const discardStorageIssues = () => {
    if (!window.confirm("Discard the unreadable saved data and continue? Affected records will be replaced next time Spendwise saves. Download the raw data first if you may want to recover them.")) return;
    storageIssues.clear();
    writesBlocked.current = false;
    setStorageReport([]);
    // Write what is currently on screen so edits made during the pause survive and
    // the same warning does not return on reload.
    saveJson(SAVINGS_STORAGE_KEY, savingsGoals);
    saveJson(CIRCLES_STORAGE_KEY, savingsCircles);
    saveJson(BETS_STORAGE_KEY, bets);
    saveJson(RULES_STORAGE_KEY, rules);
    saveJson(RECIPIENT_PROFILES_STORAGE_KEY, recipientProfiles);
    saveJson(BUDGETS_STORAGE_KEY, budgets);
    saveJson(INCOME_SOURCE_OVERRIDES_STORAGE_KEY, incomeSourceOverrides);
    saveJson(BILLS_STORAGE_KEY, recurringBills);
    saveJson(ACCOUNTS_STORAGE_KEY, accountPreferences);
    saveJson(OPENING_BALANCE_STORAGE_KEY, projectionOpeningBalance);
    saveJson(SNAPSHOTS_STORAGE_KEY, statementSnapshots);
    saveJson(AUDIT_LOG_STORAGE_KEY, auditLog);
    saveJson(INVESTMENTS_STORAGE_KEY, investmentStore);
    saveJson(BETTING_LINKS_STORAGE_KEY, bankLinks);
    saveJson(PERIOD_STORAGE_KEY, { period, custom: customRange });
    void writeValue(TRANSACTIONS_STORAGE_KEY, serializeTransactions(transactions));
    notify("Unreadable data discarded. Saving is on again.");
  };

  const restoreBackup = async (file: File) => {
    if (writesBlocked.current) {
      notify("Download the unreadable saved data or discard it before restoring a backup.");
      return;
    }
    const backup = readBackup(await file.text());
    if (!backup) {
      notify("That file is not a Spendwise backup.");
      return;
    }
    if (!window.confirm(`Replace everything in this browser with the backup (${backup.transactions.length.toLocaleString("en-NG")} transactions, ${backup.savingsGoals.length} goals, ${backup.bets.length} bets, ${backup.rules.length} rules, ${backup.budgets.length} budgets, ${backup.recipientProfiles?.length ?? 0} recipient profiles, ${Object.keys(backup.incomeSourceOverrides ?? {}).length} income-source labels)?`)) return;
    setTransactions(backup.transactions);
    updateSavingsGoals(backup.savingsGoals);
    updateSavingsCircles(backup.savingsCircles);
    updateBets(backup.bets);
    updateRules(backup.rules);
    updateBudgets(backup.budgets);
    updateRecipientProfiles(backup.recipientProfiles ?? []);
    setIncomeSourceOverrides(backup.incomeSourceOverrides ?? {});
    if (!persistJson(INCOME_SOURCE_OVERRIDES_STORAGE_KEY, backup.incomeSourceOverrides ?? {})) {
      notify("The backup was restored, but income-source labels could not be saved in this browser.");
    }
    updateRecurringBills(backup.recurringBills ?? []);
    updateAccountPreferences(backup.accountPreferences ?? DEFAULT_ACCOUNT_PREFERENCES);
    updateProjectionOpeningBalance(backup.projectionOpeningBalance ?? 0);
    updateStatementSnapshots(backup.statementSnapshots ?? []);
    updateInvestments(backup.investments ?? { records: [], valuations: [] });
    setBankLinks(backup.bettingLinks ?? []);
    if (!persistJson(BETTING_LINKS_STORAGE_KEY, backup.bettingLinks ?? [])) {
      notify("The backup was restored, but betting links could not be saved in this browser.");
    }
    recordMutation("restore", `Backup restored: ${backup.transactions.length.toLocaleString("en-NG")} transactions replaced the previous ${transactions.length.toLocaleString("en-NG")} in this browser.`, {
      evidence: "The full backup content replaced local data at your confirmation.",
    });
    setPeriod("all");
    notify("Backup restored.");
  };

  const loadDemo = () => {
    if (transactions.length && !window.confirm("Replace your current transactions with fictional demo data?")) return;
    setTransactions(createDemoTransactions());
    recordMutation("clear", `Transaction history replaced with fictional demo data (${transactions.length.toLocaleString("en-NG")} previous recorded rows).`, {
      evidence: "Demo rows use ids starting with “demo-” so they are recognisable.",
    });
    setPeriod("90d");
    notify("Fictional demo data loaded. Import your own statement when ready.");
  };

  const clearTransactions = () => {
    if (!transactions.length) return;
    if (!window.confirm("Delete all locally saved transactions? This cannot be undone.")) return;
    recordMutation("clear", `All ${transactions.length.toLocaleString("en-NG")} recorded transactions were cleared from this browser at your request.`, {
      evidence: "Download a backup first next time; clearing is permanent.",
    });
    setTransactions([]);
    notify("Transaction history cleared from this browser.");
  };

  const goTo = (page: Page) => {
    setActivePage(page);
    setSelectedTransactionIds(new Set());
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

  // The money-out chart includes transfers to other people as their own slice, so its
  // total matches the Money out card. "Spending" still means consumption only.
  const chartCategories = categories;
  const spendingCategories = categories.filter((item) => item.category !== "Transfers" && item.amount > 0);
  const spendingTotal = spendingCategories.reduce((sum, item) => sum + item.amount, 0);
  const topCategory = spendingCategories[0];
  const biggest = useMemo(() => withinPeriod
    .filter((transaction) => transaction.direction === "expense" && !transaction.internalTransfer && transaction.category !== "Transfers")
    .reduce<Transaction | undefined>((max, transaction) => (!max || transaction.amount > max.amount ? transaction : max), undefined), [withinPeriod]);
  const comparisonsAvailable = previousTotals !== null;
  const moneyOutChange: Change = comparisonsAvailable
    ? relativeChange(totals.expenses, previousTotals!.expenses)
    : { text: totals.refunds ? `After ${formatCurrency(totals.refunds, currency)} in refunds` : "Across the whole period", direction: null };
  const moneyOutDetail = totals.transfersOut > 0
    ? { ...moneyOutChange, text: `${moneyOutChange.text} · ${formatCurrency(totals.transfersOut, currency, true)} transfers` }
    : moneyOutChange;
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
          <div className="nav-group" role="group" aria-labelledby="nav-group-overview">
            <div className="nav-group-label" id="nav-group-overview">Overview</div>
            <NavButton page="overview" active={activePage} onClick={goTo} icon={<LayoutDashboard size={18} />} />
          </div>
          <div className="nav-group" role="group" aria-labelledby="nav-group-activity">
            <div className="nav-group-label" id="nav-group-activity">Activity</div>
            <NavButton page="accounts" active={activePage} onClick={goTo} icon={<Landmark size={18} />} count={sources.length || undefined} />
            <NavButton page="transactions" active={activePage} onClick={goTo} icon={<ArrowLeftRight size={18} />} count={transactions.length} />
          </div>
          <div className="nav-group" role="group" aria-labelledby="nav-group-classifier">
            <div className="nav-group-label" id="nav-group-classifier">Classifier</div>
            <NavButton page="review" active={activePage} onClick={goTo} icon={<ClipboardCheck size={18} />} count={classificationReviewQueue.length} />
            <NavButton page="recipients" active={activePage} onClick={goTo} icon={<Users size={18} />} count={recipientProfiles.length || undefined} />
          </div>
          <div className="nav-group" role="group" aria-labelledby="nav-group-planning">
            <div className="nav-group-label" id="nav-group-planning">Planning</div>
            <NavButton page="bills" active={activePage} onClick={goTo} icon={<CalendarDays size={18} />} count={recurringBills.length || undefined} />
            <NavButton page="budgets" active={activePage} onClick={goTo} icon={<Target size={18} />} count={budgets.length || undefined} />
            <NavButton page="savings" active={activePage} onClick={goTo} icon={<PiggyBank size={18} />} count={savingsGoals.length + savingsCircles.length || undefined} />
          </div>
          <div className="nav-group" role="group" aria-labelledby="nav-group-analysis">
            <div className="nav-group-label" id="nav-group-analysis">Analysis</div>
            <NavButton page="insights" active={activePage} onClick={goTo} icon={<BarChart3 size={18} />} />
            <NavButton page="reconcile" active={activePage} onClick={goTo} icon={<ShieldCheck size={18} />} count={reconcileIssueCount || undefined} />
          </div>
          <div className="nav-group" role="group" aria-labelledby="nav-group-models">
            <div className="nav-group-label" id="nav-group-models">Asset models</div>
            <NavButton page="betting" active={activePage} onClick={goTo} icon={<Ticket size={18} />} count={bets.length || undefined} />
            <NavButton page="investments" active={activePage} onClick={goTo} icon={<TrendingUp size={18} />} count={investmentStore.records.length || undefined} />
          </div>
          <div className="nav-group" role="group" aria-labelledby="nav-group-tools">
            <div className="nav-group-label" id="nav-group-tools">Tools</div>
            <NavButton page="data" active={activePage} onClick={goTo} icon={<DatabaseBackup size={18} />} count={rules.length || undefined} />
          </div>
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

          {storageReport.length > 0 && (
            <section className="import-notice storage-notice" role="alert">
              <div className="import-notice-copy">
                <strong>Some saved data could not be read</strong>
                <p>Saving is paused so these records are not overwritten. Download the raw copy first if you may want to recover it.</p>
                {storageReport.map((issue) => (
                  <p key={issue.key}><b>{storageLabels[issue.key] ?? issue.key}:</b> {issue.reason}</p>
                ))}
              </div>
              <div className="storage-notice-actions">
                <button className="button button-secondary" onClick={downloadStorageRecovery}><Download size={15} /> Download raw data</button>
                <button className="button button-primary" onClick={discardStorageIssues}>Discard &amp; continue</button>
              </div>
            </section>
          )}

          {!loaded && (activePage === "overview" || activePage === "accounts" || activePage === "transactions" || activePage === "review" || activePage === "reconcile" || activePage === "bills" || activePage === "insights" || activePage === "recipients") && (
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
                      change={moneyOutDetail}
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

                  {accountSummaries.length > 1 && (
                    <section className="overview-accounts" aria-label="Account activity summary">
                      <div className="overview-accounts-heading"><span>ACCOUNT VISIBILITY</span><button className="subtle-link" onClick={() => goTo("accounts")}>All accounts <ArrowUpRight size={13} /></button></div>
                      <div className="overview-account-list">{accountSummaries.slice(0, 4).map((account) => (
                        <button key={account.name} onClick={() => { setPeriod("all"); searchTransactions(""); setSourceFilter(account.name); }}>
                          <span className="account-mini">{initialLetter(account.name)}</span><span><strong>{account.name}</strong><small>{account.count} transactions · {account.currency}</small></span><strong>{formatCurrency(account.net, account.currency, true)}</strong>
                        </button>
                      ))}</div>
                    </section>
                  )}

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
                          <h2>Income vs. money out by month</h2>
                        </div>
                        <div className="chart-legend">
                          <span><i className="legend-dot income-dot" /> Income</span>
                          <span><i className="legend-dot spending-dot" /> Money out</span>
                        </div>
                      </div>
                      <CashflowChart data={monthly} currency={currency} />
                    </section>

                    <section className="panel category-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="panel-kicker">WHERE IT GOES</div>
                          <h2>Money out breakdown</h2>
                        </div>
                        <button className="subtle-link" onClick={() => goTo("insights")}>Details <ArrowUpRight size={14} /></button>
                      </div>
                      <CategoryChart categories={chartCategories} currency={currency} onSelect={(category) => {
                        searchTransactions("");
                        setCategoryFilter(category);
                      }} />
                      <p className="breakdown-note">
                        {totals.transfersOut > 0
                          ? `${formatCurrency(totals.spending, currency)} spending + ${formatCurrency(totals.transfersOut, currency)} sent to other accounts = ${formatCurrency(totals.expenses, currency)} money out${totals.refunds > 0 ? `, after ${formatCurrency(totals.refunds, currency)} in refunds` : ""}.`
                          : `${formatCurrency(totals.expenses, currency)} money out${totals.refunds > 0 ? ` after ${formatCurrency(totals.refunds, currency)} in refunds` : ""}.`}
                        {" "}Moves between your own accounts are excluded.
                      </p>
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
                      <TransactionTable
                        transactions={[...withinPeriod].sort(sortNewestFirst).slice(0, 6)}
                        currency={currency}
                        rules={rules}
                        classificationHistory={classificationHistory}
                        recipientProfiles={recipientProfiles}
                        recurringTransactionIds={recurringTransactionIds}
                      />
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

          {loaded && activePage === "accounts" && (
            <AccountsPage
              transactions={transactions}
              preferences={accountPreferences}
              onChange={updateAccountPreferences}
              onOpenAccount={(account) => {
                setPeriod("all");
                searchTransactions("");
                setSourceFilter(account);
              }}
            />
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
                {selectedTransactionIds.size > 0 && (
                  <div className="bulk-classification-toolbar" role="status">
                    <strong>{selectedTransactionIds.size.toLocaleString("en-NG")} selected</strong>
                    <label>Set category to
                      <select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value as Category)}>
                        {categoryList.map((category) => <option key={category}>{category}</option>)}
                      </select>
                    </label>
                    <button className="button button-primary" onClick={applyBulkCategory}><Check size={14} /> Apply to selected</button>
                    <button className="button button-text" onClick={() => setSelectedTransactionIds(new Set())}>Clear selection</button>
                  </div>
                )}
                {visibleTransactions.length
                  ? <>
                    <TransactionTable
                      transactions={displayedTransactions}
                      currency={currency}
                      showSource
                      onChangeCategory={changeCategory}
                      similarCounts={similarTransactionCounts}
                      rules={rules}
                      classificationHistory={classificationHistory}
                      recipientProfiles={recipientProfiles}
                      recurringTransactionIds={recurringTransactionIds}
                      selectedTransactionIds={selectedTransactionIds}
                      onToggleSelection={toggleTransactionSelection}
                      onSelectDisplayed={selectDisplayedTransactions}
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

          {loaded && activePage === "review" && (
            <ClassificationReviewPage
              candidates={classificationReviewQueue}
              recurringRecipients={recurringRecipients}
              transactions={transactions}
              currency={currency}
              onAcceptSuggestion={(transactionId) => resolveReviewCandidate(transactionId, "accept")}
              onAcceptAndCreateRule={acceptSuggestionAndCreateRule}
              onRejectSuggestion={(transactionId) => resolveReviewCandidate(transactionId, "reject")}
              onConfirmCurrent={(transactionId) => resolveReviewCandidate(transactionId, "confirm")}
              onBulkDecision={resolveBulkReview}
              onChooseCategory={changeCategory}
              onOpenRecipient={(name) => {
                setPeriod("all");
                searchTransactions(name);
              }}
            />
          )}

          {loaded && activePage === "reconcile" && (
            <ReconcilePage
              transactions={transactions}
              snapshots={statementSnapshots}
              auditLog={auditLog}
              currency={currency}
              accounts={sources}
              issues={ledgerIssues}
              transferIntel={transferIntel}
              onOpenTransactions={(ids) => {
                if (ids.length === 0) {
                  goTo("data");
                  return;
                }
                searchTransactions("");
                setPeriod("all");
                setCategoryFilter("All categories");
                setSelectedTransactionIds(new Set(ids));
                goTo("transactions");
              }}
              onAddSnapshot={saveStatementSnapshot}
              onDeleteSnapshot={deleteStatementSnapshot}
              onAddInferred={addInferredTransaction}
              onVerifyInferred={verifyInferredTransaction}
            />
          )}

          {loaded && activePage === "bills" && (
            <BillsPage
              bills={recurringBills}
              accounts={sources}
              preferences={accountPreferences}
              startingBalance={projectionOpeningBalance}
              onStartingBalanceChange={updateProjectionOpeningBalance}
              onSave={saveRecurringBill}
              onDelete={deleteRecurringBill}
              onTogglePause={toggleRecurringBill}
            />
          )}

          {loaded && activePage === "recipients" && (
            <RecipientProfilesPage
              transactions={transactions}
              profiles={recipientProfiles}
              currency={currency}
              onSaveProfile={saveRecipientProfile}
              onDeleteProfile={deleteRecipientProfile}
              onOpenTransactions={(name) => {
                setPeriod("all");
                searchTransactions(name);
              }}
            />
          )}

          {activePage === "budgets" && (
            <BudgetsPage
              transactions={transactions}
              budgets={budgets}
              recipientProfiles={recipientProfiles}
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

          {activePage === "investments" && (
            <InvestmentsPage
              records={investmentStore.records}
              valuations={investmentStore.valuations}
              currency={currency}
              onAddRecord={createInvestmentRecord}
              onDeleteRecord={deleteInvestmentRecord}
              onSetValuation={setAssetValuation}
              onClearValuation={clearAssetValuation}
            />
          )}

          {activePage === "betting" && (
            <BettingPage
              bets={bets}
              transactions={transactions}
              currency={currency}
              bankLinks={bankLinks}
              onImport={() => betFileInput.current?.click()}
              onAddBet={createBetRecord}
              onChangeCategory={updateBetCategory}
              onDeleteBet={deleteBetRecord}
              onConfirmLink={confirmBetLink}
              onRemoveLink={removeBetLink}
            />
          )}

          {activePage === "data" && (
            <DataPage
              rules={rules}
              transactions={transactions}
              recipientProfiles={recipientProfiles}
              counts={{ transactions: transactions.length, goals: savingsGoals.length, circles: savingsCircles.length, bets: bets.length, budgets: budgets.length, profiles: recipientProfiles.length, bills: recurringBills.length }}
              matchCount={(rule) => transactions.filter((transaction) => ruleMatches(rule, transaction)).length}
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
                      <div className="panel-heading"><div><div className="panel-kicker">MONEY OUT MIX</div><h2>Where your money goes</h2></div></div>
                      <CategoryChart categories={chartCategories} currency={currency} large onSelect={(category) => {
                        searchTransactions("");
                        setCategoryFilter(category);
                      }} />
                      <p className="breakdown-note">
                        {totals.transfersOut > 0
                          ? `${formatCurrency(totals.spending, currency)} spending + ${formatCurrency(totals.transfersOut, currency)} sent to other accounts = ${formatCurrency(totals.expenses, currency)} money out${totals.refunds > 0 ? `, after ${formatCurrency(totals.refunds, currency)} in refunds` : ""}.`
                          : `${formatCurrency(totals.expenses, currency)} money out${totals.refunds > 0 ? ` after ${formatCurrency(totals.refunds, currency)} in refunds` : ""}.`}
                        {" "}Moves between your own accounts are excluded.
                      </p>
                    </section>
                    <div className="insight-side">
                      <InsightDetail
                        icon={<TrendingUp size={18} />}
                        title="Biggest spending category"
                        value={topCategory?.category ?? "No spending yet"}
                        detail={topCategory ? `${formatCurrency(topCategory.amount, currency)} · ${spendingTotal > 0 ? Math.round((topCategory.amount / spendingTotal) * 100) : 0}% of categorised spending (transfers to people shown separately)` : "Import transactions to find a pattern."}
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
                      <div className="insight-note"><Lightbulb size={17} /><p>Money moving between your own wallet and savings pots (OWealth, Spend & Save, Targets) is left out of every total, so the numbers show what actually came in and went out. Transfers to other people are included in money out and shown as their own slice, so the breakdown still adds up.</p></div>
                    </div>
                  </div>
                  <FinancialIndicatorsPanel
                    transactions={transactions}
                    range={range}
                    budgets={budgets}
                    recipientProfiles={recipientProfiles}
                    incomeSourceOverrides={incomeSourceOverrides}
                    onUpdateIncomeSourceOverride={updateIncomeSourceOverride}
                    currency={currency}
                    onSearch={searchTransactions}
                  />
                  <section className="panel trend-panel">
                    <div className="panel-heading"><div><div className="panel-kicker">MONTH BY MONTH</div><h2>Cash flow trend</h2></div><div className="chart-legend"><span><i className="legend-dot income-dot" /> Income</span><span><i className="legend-dot spending-dot" /> Money out</span></div></div>
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

export default App;
