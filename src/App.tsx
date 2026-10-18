import { useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CloudUpload,
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
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { transactionsToCsv } from "./lib/csv";
import { parseStatementFile } from "./lib/statementImport";
import SavingsPage from "./SavingsPage";
import BettingPage from "./BettingPage";
import { normaliseSavingsGoals } from "./lib/savings";
import { normaliseSavingsCircles } from "./lib/savingsCircles";
import { normaliseBets, parseSportyBetPage } from "./lib/sportyBetImport";
import {
  calculateTotals,
  filterByPeriod,
  getCategoryTotals,
  getMonthlyTotals,
  largestExpense,
  type Period,
} from "./lib/insights";
import type { BetCategory, BetRecord, Category, SavingsCircle, SavingsContribution, SavingsGoal, Transaction } from "./types";

const STORAGE_KEY = "spendwise.transactions.v1";
const SAVINGS_STORAGE_KEY = "spendwise.savings-goals.v1";
const CIRCLES_STORAGE_KEY = "spendwise.savings-circles.v1";
const BETS_STORAGE_KEY = "spendwise.bets.v1";
const currency = "NGN";
const periodOptions: { value: Period; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
];
const categoryColors: Record<Category, string> = {
  Income: "#317a60",
  "Food & groceries": "#e5aa51",
  Transport: "#8d7bd1",
  "Bills & utilities": "#5da1a0",
  Shopping: "#e17e73",
  Transfers: "#7b8c93",
  Health: "#c56f91",
  Entertainment: "#5286b6",
  Education: "#b99557",
  Other: "#a6aaa4",
};

function readStoredTransactions(): Transaction[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is Transaction =>
        item &&
        typeof item.id === "string" &&
        typeof item.date === "string" &&
        typeof item.description === "string" &&
        typeof item.amount === "number" &&
        (item.direction === "income" || item.direction === "expense") &&
        typeof item.source === "string",
    );
  } catch {
    return [];
  }
}

function readStoredSavingsGoals(): SavingsGoal[] {
  try {
    return normaliseSavingsGoals(JSON.parse(localStorage.getItem(SAVINGS_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function readStoredSavingsCircles(): SavingsCircle[] {
  try {
    return normaliseSavingsCircles(JSON.parse(localStorage.getItem(CIRCLES_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function readStoredBets(): BetRecord[] {
  try {
    return normaliseBets(JSON.parse(localStorage.getItem(BETS_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function formatCurrency(amount: number, currency: string, compact = false): string {
  if (compact && Math.abs(amount) >= 1_000_000) {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  }
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${date}T00:00:00`));
}

function initialLetter(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || "B";
}

function relativeChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "No change" : "New this period";
  const change = ((current - previous) / previous) * 100;
  return `${change > 0 ? "+" : ""}${Math.round(change)}% vs previous`;
}

function createDemoTransactions(): Transaction[] {
  const now = new Date();
  const rows: Omit<Transaction, "id">[] = [];
  const demo = [
    ["Salary — Example Co.", 0.72, "income", "Income"],
    ["Market groceries", 0.12, "expense", "Food & groceries"],
    ["Bolt ride", 0.055, "expense", "Transport"],
    ["Electricity bill", 0.048, "expense", "Bills & utilities"],
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
      rows.push({
        date: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`,
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

function App() {
  const [transactions, setTransactions] = useState<Transaction[]>(readStoredTransactions);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>(readStoredSavingsGoals);
  const [savingsCircles, setSavingsCircles] = useState<SavingsCircle[]>(readStoredSavingsCircles);
  const [bets, setBets] = useState<BetRecord[]>(readStoredBets);
  const [period, setPeriod] = useState<Period>("30d");
  const [activePage, setActivePage] = useState<"overview" | "transactions" | "insights" | "savings" | "betting">("overview");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [directionFilter, setDirectionFilter] = useState("All types");
  const [sourceFilter, setSourceFilter] = useState("All accounts");
  const [toast, setToast] = useState("");
  const [importing, setImporting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const betFileInput = useRef<HTMLInputElement>(null);

  const withinPeriod = useMemo(() => filterByPeriod(transactions, period), [transactions, period]);
  const totals = useMemo(() => calculateTotals(withinPeriod), [withinPeriod]);
  const categories = useMemo(() => getCategoryTotals(withinPeriod), [withinPeriod]);
  const monthly = useMemo(() => getMonthlyTotals(transactions, 6), [transactions]);
  const sources = useMemo(
    () => [...new Set(transactions.map((transaction) => transaction.source))].sort(),
    [transactions],
  );
  const previousTotals = useMemo(() => {
    const now = new Date();
    const currentStart = new Date(now);
    const previousStart = new Date(now);
    if (period === "30d") {
      currentStart.setDate(now.getDate() - 29);
      previousStart.setDate(now.getDate() - 59);
    } else if (period === "90d") {
      currentStart.setDate(now.getDate() - 89);
      previousStart.setDate(now.getDate() - 179);
    } else if (period === "12m") {
      currentStart.setMonth(now.getMonth() - 11, 1);
      previousStart.setMonth(now.getMonth() - 23, 1);
    } else {
      return calculateTotals([]);
    }
    currentStart.setHours(0, 0, 0, 0);
    previousStart.setHours(0, 0, 0, 0);
    const currentFloor = localIsoDate(currentStart);
    const previousFloor = localIsoDate(previousStart);
    const previous = transactions.filter(
      (transaction) => transaction.date >= previousFloor && transaction.date < currentFloor,
    );
    return calculateTotals(previous);
  }, [transactions, period]);
  const visibleTransactions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...withinPeriod]
      .filter((transaction) => categoryFilter === "All categories" || transaction.category === categoryFilter)
      .filter((transaction) => directionFilter === "All types" || transaction.direction === directionFilter)
      .filter((transaction) => sourceFilter === "All accounts" || transaction.source === sourceFilter)
      .filter(
        (transaction) =>
          !normalizedQuery ||
          `${transaction.description} ${transaction.category} ${transaction.source}`
            .toLowerCase()
            .includes(normalizedQuery),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [withinPeriod, query, categoryFilter, directionFilter, sourceFilter]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const updateTransactions = (next: Transaction[]) => {
    setTransactions(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      notify("Could not save to browser storage. Export your transactions before closing this tab.");
    }
  };

  const updateSavingsGoals = (next: SavingsGoal[]) => {
    setSavingsGoals(next);
    try {
      localStorage.setItem(SAVINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      notify("Could not save your goals in this browser. Export or note them before closing this tab.");
    }
  };

  const updateSavingsCircles = (next: SavingsCircle[]) => {
    setSavingsCircles(next);
    try {
      localStorage.setItem(CIRCLES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      notify("Could not save contribution circles in this browser. Note or export your records before closing this tab.");
    }
  };

  const updateBets = (next: BetRecord[]) => {
    setBets(next);
    try {
      localStorage.setItem(BETS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      notify("Could not save betting records in this browser. Export or note them before closing this tab.");
    }
  };

  const importFiles = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    const statementFiles = selectedFiles.filter((file) => /\.(csv|xls|xlsx|pdf)$/i.test(file.name));
    if (statementFiles.length === 0) {
      notify("Choose a CSV, Excel (.xls/.xlsx), or text-based PDF statement.");
      return;
    }
    setImporting(true);
    const imported: Transaction[] = [];
    let skipped = 0;
    const messages: string[] = [];

    try {
      for (const file of statementFiles) {
        try {
          const result = await parseStatementFile(file);
          imported.push(...result.transactions);
          skipped += result.skipped;
          messages.push(...result.warnings.map((warning) => `${file.name}: ${warning}`));
        } catch {
          messages.push(`${file.name} could not be read. Scanned or password-protected PDFs may need to be exported as CSV or Excel.`);
        }
      }

      const existingKeys = new Set(
        transactions.map((transaction) => `${transaction.date}|${transaction.description.toLowerCase()}|${transaction.amount}|${transaction.source}`),
      );
      const newTransactions = imported.filter((transaction) => {
        const key = `${transaction.date}|${transaction.description.toLowerCase()}|${transaction.amount}|${transaction.source}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });
      if (newTransactions.length) {
        updateTransactions([...transactions, ...newTransactions]);
        notify(`${newTransactions.length} transaction${newTransactions.length === 1 ? "" : "s"} imported${skipped ? ` · ${skipped} skipped` : ""}.`);
        setActivePage("overview");
      } else if (imported.length) {
        notify("Those transactions are already in your history.");
      } else {
        notify(messages[0] ?? "No transactions could be imported. Check the statement columns and try again.");
      }
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const importBetPage = async (files: FileList | File[]) => {
    const file = Array.from(files).find((item) => /\.(mhtml|mht|html|htm)$/i.test(item.name));
    if (!file) {
      notify("Choose a saved SportyBet page (.mhtml, .mht, or .html).");
      return;
    }
    setActivePage("betting");
    setImporting(true);
    try {
      const result = parseSportyBetPage(await file.text());
      const existingIds = new Set(bets.map((bet) => bet.id));
      const newBets = result.bets.filter((bet) => {
        if (existingIds.has(bet.id)) return false;
        existingIds.add(bet.id);
        return true;
      });
      if (newBets.length) {
        updateBets([...bets, ...newBets]);
        setActivePage("betting");
        notify(`${newBets.length} bet${newBets.length === 1 ? "" : "s"} imported${result.warnings.length ? ` · ${result.warnings[0]}` : ""}.`);
      } else if (result.bets.length) {
        setActivePage("betting");
        notify("Those betting records are already in your ledger.");
      } else {
        notify(result.warnings[0] ?? "No bet records could be extracted from this page.");
      }
    } catch {
      notify("This saved page could not be read. Try saving SportyBet as a complete web page (.mhtml).");
    } finally {
      setImporting(false);
      if (betFileInput.current) betFileInput.current.value = "";
    }
  };

  const createBetRecord = (bet: Omit<BetRecord, "id">) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `bet-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    updateBets([...bets, { ...bet, id }]);
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
    const id = globalThis.crypto?.randomUUID?.() ?? `goal-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    const date = localIsoDate(new Date());
    const contributions: SavingsContribution[] = startingAmount > 0
      ? [{ id: `${id}-starting`, date, amount: startingAmount }]
      : [];
    updateSavingsGoals([...savingsGoals, { id, name, targetAmount, createdAt: date, contributions }]);
    notify(`“${name}” savings goal created.`);
  };

  const addSavingsContribution = (goalId: string, amount: number) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `contribution-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    const date = localIsoDate(new Date());
    const next = savingsGoals.map((goal) =>
      goal.id === goalId
        ? { ...goal, contributions: [...goal.contributions, { id, date, amount }] }
        : goal,
    );
    updateSavingsGoals(next);
    notify("Savings contribution recorded.");
  };

  const deleteSavingsGoal = (goalId: string) => {
    updateSavingsGoals(savingsGoals.filter((goal) => goal.id !== goalId));
    notify("Savings goal deleted.");
  };

  const createSavingsCircle = (circle: Omit<SavingsCircle, "id">) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `circle-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    updateSavingsCircles([...savingsCircles, { ...circle, id }]);
    notify(`“${circle.name}” circle saved in this browser.`);
  };

  const updateSavingsCircle = (circle: SavingsCircle) => {
    updateSavingsCircles(savingsCircles.map((item) => item.id === circle.id ? circle : item));
  };

  const deleteSavingsCircle = (circleId: string) => {
    updateSavingsCircles(savingsCircles.filter((circle) => circle.id !== circleId));
    notify("Contribution circle and its local history deleted.");
  };

  const exportCsv = () => {
    if (visibleTransactions.length === 0) {
      notify("There are no transactions to export.");
      return;
    }
    const blob = new Blob([transactionsToCsv(visibleTransactions)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "spendwise-transactions.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify(`${visibleTransactions.length} transactions exported.`);
  };

  const loadDemo = () => {
    if (transactions.length && !window.confirm("Replace your current transactions with fictional demo data?")) return;
    updateTransactions(createDemoTransactions());
    notify("Fictional demo data loaded. Import your own statement when ready.");
  };

  const clearTransactions = () => {
    if (!transactions.length) return;
    if (!window.confirm("Delete all locally saved transactions? This cannot be undone.")) return;
    updateTransactions([]);
    notify("Transaction history cleared from this browser.");
  };

  const activeCategories = categories.filter((item) => item.category !== "Transfers");
  const topCategory = activeCategories[0];
  const biggest = largestExpense(withinPeriod);

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
          <div className="workspace-copy"><strong>My finances</strong><span>Personal workspace</span></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>
        <div className="nav-label">MENU</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={activePage === "overview" ? "nav-item active" : "nav-item"} onClick={() => { setActivePage("overview"); setSidebarOpen(false); }}>
            <LayoutDashboard size={18} /><span>Overview</span>
          </button>
          <button className={activePage === "transactions" ? "nav-item active" : "nav-item"} onClick={() => { setActivePage("transactions"); setSidebarOpen(false); }}>
            <ArrowLeftRight size={18} /><span>Transactions</span>
            <span className="nav-count">{transactions.length}</span>
          </button>
          <button className={activePage === "insights" ? "nav-item active" : "nav-item"} onClick={() => { setActivePage("insights"); setSidebarOpen(false); }}>
            <BarChart3 size={18} /><span>Insights</span>
          </button>
          <button className={activePage === "savings" ? "nav-item active" : "nav-item"} onClick={() => { setActivePage("savings"); setSidebarOpen(false); }}>
            <PiggyBank size={18} /><span>Savings</span>
            {savingsGoals.length + savingsCircles.length > 0 && <span className="nav-count">{savingsGoals.length + savingsCircles.length}</span>}
          </button>
          <button className={activePage === "betting" ? "nav-item active" : "nav-item"} onClick={() => { setActivePage("betting"); setSidebarOpen(false); }}>
            <Ticket size={18} /><span>Betting</span>
            {bets.length > 0 && <span className="nav-count">{bets.length}</span>}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <div className="privacy-icon"><LockKeyhole size={16} /></div>
            <strong>Your data stays yours</strong>
            <p>Imports and records are processed and stored in this browser only.</p>
            <button onClick={() => setShowPrivacy(true)}>How it works <ArrowUpRight size={13} /></button>
          </div>
          <div className="profile-row">
            <div className="profile-avatar">Y</div>
            <div className="profile-copy"><strong>Your workspace</strong><span>Private account</span></div>
            <button className="icon-button" onClick={clearTransactions} title="Clear all transactions" aria-label="Clear all transactions"><Trash2 size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button menu-toggle" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumbs"><span>My finances</span><span className="crumb-slash">/</span><strong>{activePage === "overview" ? "Overview" : activePage === "transactions" ? "Transactions" : activePage === "savings" ? "Savings" : activePage === "betting" ? "Betting" : "Insights"}</strong></div>
          <div className="topbar-actions">
            <span className="currency-badge">{currency}</span>
            {activePage === "betting" ? (
              <button className="button button-primary top-import" onClick={() => betFileInput.current?.click()}><Plus size={16} /> Import bets</button>
            ) : (
              <button className="button button-primary top-import" onClick={() => fileInput.current?.click()}><Plus size={16} /> Import statement</button>
            )}
            <input ref={fileInput} className="visually-hidden" type="file" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple onChange={(event) => event.target.files && void importFiles(event.target.files)} />
            <input ref={betFileInput} className="visually-hidden" type="file" accept=".mhtml,.mht,.html,.htm,application/x-mimearchive,text/html" onChange={(event) => event.target.files && void importBetPage(event.target.files)} />
          </div>
        </header>

        <div className="page-content">
          {activePage === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> YOUR MONEY AT A GLANCE</div>
                  <h1>Good money habits start with clarity.</h1>
                  <p className="page-subtitle">A calm, clear picture of where your money comes from and where it goes.</p>
                </div>
                <div className="heading-actions">
                  <PeriodSelect value={period} onChange={setPeriod} />
                  <button className="button button-secondary" onClick={exportCsv}><Download size={15} /> Export</button>
                </div>
              </div>

              {transactions.length === 0 ? (
                <EmptyState onImport={() => fileInput.current?.click()} onDemo={loadDemo} />
              ) : (
                <>
                  <div className="metric-grid">
                    <MetricCard
                      label="Money in"
                      amount={formatCurrency(totals.income, currency)}
                      comparison={period === "all" ? "Across all imported history" : relativeChange(totals.income, previousTotals.income)}
                      icon={<ArrowDownLeft size={18} />}
                      tint="mint"
                    />
                    <MetricCard
                      label="Money out"
                      amount={formatCurrency(totals.expenses, currency)}
                      comparison={period === "all" ? "Across all imported history" : relativeChange(totals.expenses, previousTotals.expenses)}
                      icon={<ArrowUpRight size={18} />}
                      tint="peach"
                    />
                    <MetricCard
                      label="Net cash flow"
                      amount={formatCurrency(totals.net, currency)}
                      comparison="Income minus outgoing"
                      icon={<ArrowLeftRight size={18} />}
                      tint="lavender"
                    />
                    <MetricCard
                      label="Kept this period"
                      amount={`${Math.round(totals.savingsRate)}%`}
                      comparison={totals.income > 0 ? "Of your income after spending" : "Add income to calculate"}
                      icon={<Wallet size={18} />}
                      tint="blue"
                    />
                  </div>

                  <div className="dashboard-grid">
                    <section className="panel cashflow-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="panel-kicker">CASH FLOW</div>
                          <h2>Income vs. spending</h2>
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
                        <button className="subtle-link" onClick={() => setActivePage("insights")}>Details <ArrowUpRight size={14} /></button>
                      </div>
                      <CategoryChart categories={activeCategories} currency={currency} />
                    </section>
                  </div>

                  <div className="lower-grid">
                    <section className="panel transactions-panel">
                      <div className="panel-heading transaction-heading">
                        <div>
                          <div className="panel-kicker">LATEST ACTIVITY</div>
                          <h2>Recent transactions <span className="heading-count">{withinPeriod.length}</span></h2>
                        </div>
                        <button className="subtle-link" onClick={() => setActivePage("transactions")}>See all <ArrowUpRight size={14} /></button>
                      </div>
                      <TransactionTable transactions={[...withinPeriod].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)} currency={currency} />
                    </section>
                    <InsightsPanel
                      count={withinPeriod.length}
                      topCategory={topCategory}
                      biggest={biggest}
                      totals={totals}
                      currency={currency}
                      onOpen={() => setActivePage("insights")}
                    />
                  </div>
                </>
              )}
              <div className="page-footnote"><ShieldCheck size={14} /> Your transaction data is private and stays on this device.</div>
            </>
          )}

          {activePage === "transactions" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> YOUR ACTIVITY</div>
                  <h1>Transactions</h1>
                  <p className="page-subtitle">Search and filter transactions across all your imported statements.</p>
                </div>
                <div className="heading-actions">
                  <PeriodSelect value={period} onChange={setPeriod} />
                  <button className="button button-secondary" onClick={exportCsv}><Download size={15} /> Export CSV</button>
                </div>
              </div>
              <section className="panel all-transactions">
                <div className="table-tools">
                  <div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transactions" /></div>
                  <div className="filter-row">
                    <label className="filter-select"><Filter size={14} /><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All categories</option>{[...new Set(transactions.map((item) => item.category))].sort().map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label>
                    <label className="filter-select"><select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value)}><option>All types</option><option value="income">Income</option><option value="expense">Spending</option></select><ChevronDown size={13} /></label>
                    <label className="filter-select"><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option>All accounts</option>{sources.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label>
                  </div>
                </div>
                <div className="transaction-summary"><span>{visibleTransactions.length} transaction{visibleTransactions.length === 1 ? "" : "s"}</span><span>{formatCurrency(calculateTotals(visibleTransactions).expenses, currency)} outgoing</span></div>
                {visibleTransactions.length
                  ? <TransactionTable transactions={visibleTransactions} currency={currency} showSource />
                  : <div className="no-results"><Search size={20} /><strong>No transactions match those filters</strong><span>Try another search or import a statement.</span></div>}
              </section>
            </>
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
              currency={currency}
              onImport={() => betFileInput.current?.click()}
              onAddBet={createBetRecord}
              onChangeCategory={updateBetCategory}
              onDeleteBet={deleteBetRecord}
            />
          )}

          {activePage === "insights" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> SPENDING PATTERNS</div>
                  <h1>Insights that make sense.</h1>
                  <p className="page-subtitle">Simple patterns from the transactions you’ve imported. No guesswork, no judgement.</p>
                </div>
                <div className="heading-actions"><PeriodSelect value={period} onChange={setPeriod} /></div>
              </div>
              {transactions.length === 0 ? (
                <EmptyState onImport={() => fileInput.current?.click()} onDemo={loadDemo} />
              ) : (
                <>
                  <div className="insight-summary">
                    <div className="insight-summary-icon"><Sparkles size={18} /></div>
                    <div><span>YOUR PERIOD SUMMARY</span><p>{summarySentence(totals, topCategory, currency)}</p></div>
                  </div>
                  <div className="insight-page-grid">
                    <section className="panel insight-category-panel">
                      <div className="panel-heading"><div><div className="panel-kicker">SPENDING MIX</div><h2>Where your money goes</h2></div></div>
                      <CategoryChart categories={activeCategories} currency={currency} large />
                    </section>
                    <div className="insight-side">
                      <InsightDetail
                        icon={<TrendingUp size={18} />}
                        title="Biggest spending category"
                        value={topCategory?.category ?? "No spending yet"}
                        detail={topCategory ? `${formatCurrency(topCategory.amount, currency)} · ${Math.round(topCategory.share)}% of categorized outgoings` : "Import transactions to find a pattern."}
                        tone="mint"
                      />
                      <InsightDetail
                        icon={<TrendingDown size={18} />}
                        title="Largest outgoing"
                        value={biggest ? formatCurrency(biggest.amount, currency) : "No outgoing yet"}
                        detail={biggest ? `${biggest.description} · ${formatDate(biggest.date)}` : "Import transactions to find a pattern."}
                        tone="peach"
                      />
                      <InsightDetail
                        icon={<Wallet size={18} />}
                        title="Savings rate"
                        value={`${Math.round(totals.savingsRate)}%`}
                        detail={totals.income > 0 ? `${formatCurrency(Math.max(totals.net, 0), currency)} left after recorded spending` : "Add an income transaction to calculate this."}
                        tone="lavender"
                      />
                      <div className="insight-note"><Lightbulb size={17} /><p>Transfers are shown separately from lifestyle spending so it’s easier to spot where money is actually going.</p></div>
                    </div>
                  </div>
                  <section className="panel trend-panel">
                    <div className="panel-heading"><div><div className="panel-kicker">MONTH BY MONTH</div><h2>Cash flow trend</h2></div><div className="chart-legend"><span><i className="legend-dot income-dot" /> Income</span><span><i className="legend-dot spending-dot" /> Spending</span></div></div>
                    <CashflowChart data={monthly} currency={currency} />
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </main>

      {importing && <div className="import-overlay"><div className="import-message"><LoaderCircle className="spin" size={22} /><strong>Reading your {activePage === "betting" ? "betting page" : "statement"}…</strong><span>Everything stays in this browser.</span></div></div>}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function PeriodSelect({ value, onChange }: { value: Period; onChange: (value: Period) => void }) {
  return (
    <label className="period-select">
      <select value={value} onChange={(event) => onChange(event.target.value as Period)}>
        {periodOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={15} />
    </label>
  );
}

function MetricCard({
  label,
  amount,
  comparison,
  icon,
  tint,
}: {
  label: string;
  amount: string;
  comparison: string;
  icon: React.ReactNode;
  tint: string;
}) {
  const isNegative = comparison.startsWith("+") && label === "Money out";
  return (
    <section className="metric-card">
      <div className="metric-top"><span>{label}</span><span className={`metric-icon ${tint}`}>{icon}</span></div>
      <strong className="metric-value">{amount}</strong>
      <div className={`metric-comparison ${isNegative ? "comparison-warn" : ""}`}>
        {comparison.includes("%") && (isNegative ? <TrendingUp size={13} /> : <TrendingDown size={13} />)}
        <span>{comparison}</span>
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
       <p>Import CSV, Excel, or text-based PDF statements. Spendwise will bring them together and show your income, spending, and patterns in one place.</p>
      <div className="empty-actions"><button className="button button-primary" onClick={onImport}><CloudUpload size={17} /> Import a bank statement</button><button className="button button-text" onClick={onDemo}>Explore with sample data</button></div>
       <div className="empty-foot"><LockKeyhole size={13} /> Statements are read locally and never uploaded.</div>
    </section>
  );
}

function CashflowChart({ data, currency }: { data: ReturnType<typeof getMonthlyTotals>; currency: string }) {
  const maxValue = Math.max(...data.flatMap((item) => [item.income, item.expenses]), 1);
  const chartHeight = 190;
  const chartWidth = 600;
  const left = 50;
  const right = 8;
  const top = 8;
  const bottom = 30;
  const usableHeight = chartHeight - top - bottom;
  const usableWidth = chartWidth - left - right;
  const scaleValue = (value: number) => chartHeight - bottom - (value / maxValue) * usableHeight;
  const incomePoints = data.map((item, index) => ({
    x: left + (data.length === 1 ? usableWidth / 2 : (index / (data.length - 1)) * usableWidth),
    y: scaleValue(item.income),
  }));
  const expensePoints = data.map((item, index) => ({
    x: left + (data.length === 1 ? usableWidth / 2 : (index / (data.length - 1)) * usableWidth),
    y: scaleValue(item.expenses),
  }));
  const polyline = (points: { x: number; y: number }[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
  const axisValues = [0, 0.5, 1];
  return (
    <div className="chart-wrap">
      <svg className="cashflow-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Monthly income and spending chart">
        {axisValues.map((fraction) => {
          const y = top + usableHeight * (1 - fraction);
          return <g key={fraction}><line x1={left} x2={chartWidth - right} y1={y} y2={y} className="chart-gridline" /><text x={left - 9} y={y + 4} textAnchor="end" className="chart-axis-label">{formatCurrency(maxValue * fraction, currency, true)}</text></g>;
        })}
        <polyline points={polyline(incomePoints)} className="chart-line chart-line-income" />
        <polyline points={polyline(expensePoints)} className="chart-line chart-line-expense" />
        {incomePoints.map((point, index) => <circle key={`i-${data[index].month}`} cx={point.x} cy={point.y} r="4" className="chart-point point-income"><title>{data[index].label} income: {formatCurrency(data[index].income, currency)}</title></circle>)}
        {expensePoints.map((point, index) => <circle key={`e-${data[index].month}`} cx={point.x} cy={point.y} r="4" className="chart-point point-expense"><title>{data[index].label} spending: {formatCurrency(data[index].expenses, currency)}</title></circle>)}
        {data.map((item, index) => <text key={item.month} x={left + (data.length === 1 ? usableWidth / 2 : (index / (data.length - 1)) * usableWidth)} y={chartHeight - 7} textAnchor="middle" className="chart-axis-label">{item.label}</text>)}
      </svg>
    </div>
  );
}

function CategoryChart({
  categories,
  currency,
  large = false,
}: {
  categories: ReturnType<typeof getCategoryTotals>;
  currency: string;
  large?: boolean;
}) {
  const radius = 47;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;
  return (
    <div className={`category-chart-layout ${large ? "category-chart-layout--large" : ""}`}>
      <div className="donut-wrap">
        <svg className="donut-chart" viewBox="0 0 120 120" role="img" aria-label="Spending by category">
          <circle cx="60" cy="60" r={radius} className="donut-track" />
          {categories.map((item) => {
            const dash = (item.share / 100) * circumference;
            const offset = accumulated;
            accumulated += dash;
            return <circle key={item.category} cx="60" cy="60" r={radius} className="donut-segment" stroke={categoryColors[item.category]} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset}><title>{item.category}: {formatCurrency(item.amount, currency)}</title></circle>;
          })}
          <text x="60" y="56" textAnchor="middle" className="donut-center-label">TOTAL OUT</text>
          <text x="60" y="73" textAnchor="middle" className="donut-center-value">{formatCurrency(categories.reduce((sum, item) => sum + item.amount, 0), currency, true)}</text>
        </svg>
      </div>
      <div className="category-legend">
        {categories.slice(0, large ? 8 : 5).map((item) => (
          <div className="category-row" key={item.category}>
            <span className="category-name"><i className="category-swatch" style={{ backgroundColor: categoryColors[item.category] }} />{item.category}</span>
            <span className="category-amount">{formatCurrency(item.amount, currency, true)}</span>
            <span className="category-share">{Math.round(item.share)}%</span>
          </div>
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
}: {
  transactions: Transaction[];
  currency: string;
  showSource?: boolean;
}) {
  return (
    <div className="transaction-table-wrap">
      <table className="transaction-table">
        <thead><tr><th>TRANSACTION</th><th>DATE</th>{showSource && <th>ACCOUNT</th>}<th>CATEGORY</th><th className="amount-heading">AMOUNT</th></tr></thead>
        <tbody>
          {transactions.map((transaction) => {
            const isIncome = transaction.direction === "income";
            return (
              <tr key={transaction.id}>
                <td><div className="transaction-name-cell"><div className={`transaction-icon ${isIncome ? "transaction-icon-income" : ""}`}>{isIncome ? <ArrowDownLeft size={16} /> : transaction.category === "Transfers" ? <ArrowLeftRight size={15} /> : <FileText size={15} />}</div><div className="transaction-name-copy"><strong>{transaction.description}</strong><span>{transaction.source}</span></div></div></td>
                <td className="transaction-date">{formatDate(transaction.date)}</td>
                {showSource && <td><span className="account-pill"><span className="account-mini">{initialLetter(transaction.source)}</span>{transaction.source}</span></td>}
                <td><span className={`category-pill category-${transaction.category.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{transaction.category}</span></td>
                <td className={`transaction-amount ${isIncome ? "amount-income" : ""}`}>{isIncome ? "+" : "−"}{formatCurrency(transaction.amount, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InsightsPanel({
  count,
  topCategory,
  biggest,
  totals,
  currency,
  onOpen,
}: {
  count: number;
  topCategory: ReturnType<typeof getCategoryTotals>[number] | undefined;
  biggest: Transaction | undefined;
  totals: ReturnType<typeof calculateTotals>;
  currency: string;
  onOpen: () => void;
}) {
  return (
    <section className="insights-panel">
      <div className="insight-title"><span className="insight-sparkle"><Sparkles size={16} /></span><div><div className="panel-kicker">A CLOSER LOOK</div><h2>Your key takeaways</h2></div></div>
      <div className="insight-highlight">
        <span className="insight-number">01</span><div><span className="takeaway-label">TOP SPENDING AREA</span><strong>{topCategory?.category ?? "Not enough data yet"}</strong><p>{topCategory ? `${formatCurrency(topCategory.amount, currency)} across ${topCategory.count} transactions` : "Import transactions to see what stands out."}</p></div>
      </div>
      <div className="insight-highlight">
        <span className="insight-number">02</span><div><span className="takeaway-label">LARGEST OUTGOING</span><strong>{biggest ? formatCurrency(biggest.amount, currency) : "No outgoing yet"}</strong><p>{biggest ? biggest.description : "Your largest payment will appear here."}</p></div>
      </div>
      <div className="insight-highlight">
        <span className="insight-number">03</span><div><span className="takeaway-label">SAVINGS RATE</span><strong>{totals.income > 0 ? `${Math.round(totals.savingsRate)}%` : "—"}</strong><p>{totals.income > 0 ? "Of recorded income left after outgoing" : "Add income to see your rate."}</p></div>
      </div>
      <div className="insight-foot"><span>{count} transaction{count === 1 ? "" : "s"} analyzed</span><button className="subtle-link" onClick={onOpen}>Explore insights <ArrowUpRight size={14} /></button></div>
    </section>
  );
}

function InsightDetail({
  icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return <div className="insight-detail-card"><span className={`insight-detail-icon ${tone}`}>{icon}</span><div className="insight-detail-copy"><span>{title}</span><strong>{value}</strong><p>{detail}</p></div></div>;
}

function summarySentence(
  totals: ReturnType<typeof calculateTotals>,
  topCategory: ReturnType<typeof getCategoryTotals>[number] | undefined,
  currency: string,
): string {
  if (totals.transactionCount === 0) return "Import statements to see a useful summary of your money.";
  if (totals.income === 0) return `You’ve recorded ${formatCurrency(totals.expenses, currency)} in outgoing payments. Add income transactions for a complete cash-flow picture.`;
  const rate = Math.round(totals.savingsRate);
  const start = rate >= 20 ? `You kept ${rate}% of recorded income` : rate >= 0 ? `You kept ${rate}% of recorded income` : `Recorded spending was higher than income`;
  return `${start}${topCategory ? `, and ${topCategory.category.toLowerCase()} was your largest spending area at ${formatCurrency(topCategory.amount, currency)}.` : "."}`;
}

function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="privacy-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-heading">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="privacy-modal-icon"><LockKeyhole size={21} /></div>
        <div className="panel-kicker">PRIVATE BY DESIGN</div>
         <h2 id="privacy-heading">Your records stay in this browser.</h2>
          <p>Transaction statements and saved SportyBet pages are read on your device. Transactions, savings goals, and betting records are saved in this browser’s local storage.</p>
         <ul><li><Check size={15} /> No bank login or credentials are collected</li><li><Check size={15} /> No financial records are sent to a server</li><li><Check size={15} /> Delete transaction, bet, and goal records from their own pages</li></ul>
        <p className="privacy-modal-note">If you clear browser data or switch devices, import your statements again. This starter does not yet connect directly to bank APIs.</p>
        <button className="button button-primary modal-done" onClick={onClose}>Got it</button>
      </section>
    </div>
  );
}

export default App;
