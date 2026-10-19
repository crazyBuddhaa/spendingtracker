import { useMemo, useState } from "react";
import { CalendarDays, Download, Receipt, Users } from "lucide-react";
import type { Transaction } from "./types";
import { getFeeSummary, getMonthlyReport, getSpendingRhythm, getTopCounterparties, monthlyReportToCsv } from "./lib/analytics";
import type { DateRange } from "./lib/insights";
import { downloadFile, formatCurrency, formatDate, formatMonth } from "./lib/format";

interface InsightsExtrasProps {
  transactions: Transaction[];
  allTransactions: Transaction[];
  range: DateRange;
  currency: string;
  onSearch: (query: string) => void;
}

export default function InsightsExtras({ transactions, allTransactions, range, currency, onSearch }: InsightsExtrasProps) {
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const fees = useMemo(() => getFeeSummary(transactions), [transactions]);
  const counterparties = useMemo(() => getTopCounterparties(transactions, direction, 10), [transactions, direction]);
  const rhythm = useMemo(() => getSpendingRhythm(transactions, range.start, range.end), [transactions, range.start, range.end]);
  const report = useMemo(() => getMonthlyReport(allTransactions), [allTransactions]);
  const maxWeekday = Math.max(1, ...rhythm.byWeekday.map((day) => day.average));
  const maxCounterparty = Math.max(1, ...counterparties.map((item) => item.amount));

  return (
    <>
      <div className="extras-grid">
        <section className="panel extras-panel">
          <div className="panel-heading">
            <div><div className="panel-kicker">WHO YOUR MONEY GOES TO</div><h2>{direction === "expense" ? "Top payees" : "Top sources of money in"}</h2></div>
            <div className="segmented" role="group" aria-label="Payees or payers">
              <button className={direction === "expense" ? "active" : ""} onClick={() => setDirection("expense")}>Paid</button>
              <button className={direction === "income" ? "active" : ""} onClick={() => setDirection("income")}>Received</button>
            </div>
          </div>
          {counterparties.length ? (
            <div className="bar-list">
              {counterparties.map((item) => (
                <button className="bar-list-row" key={item.key} onClick={() => onSearch(item.name.replace(/^Betting · /, ""))} title="Show these transactions">
                  <span className="bar-list-label"><strong>{item.name}</strong><small>{item.count.toLocaleString("en-NG")} payment{item.count === 1 ? "" : "s"} · last {formatDate(item.lastDate)}</small></span>
                  <span className="bar-list-track"><i className={direction === "income" ? "income" : ""} style={{ width: `${(item.amount / maxCounterparty) * 100}%` }} /></span>
                  <span className="bar-list-value">{formatCurrency(item.amount, currency, true)}</span>
                </button>
              ))}
            </div>
          ) : <div className="counterparty-empty"><Users size={14} /> Nothing recorded in this period.</div>}
        </section>

        <div className="extras-side">
          <section className="panel extras-panel">
            <div className="panel-heading"><div><div className="panel-kicker">CHARGES</div><h2>Bank fees and levies</h2></div><Receipt size={16} className="muted-icon" /></div>
            <div className="fee-total"><strong>{formatCurrency(fees.total, currency)}</strong><span>{fees.count.toLocaleString("en-NG")} charges · {fees.shareOfSpending.toFixed(fees.shareOfSpending < 1 ? 2 : 1)}% of spending</span></div>
            {fees.byType.length ? (
              <div className="fee-list">
                {fees.byType.slice(0, 6).map((fee) => (
                  <div key={fee.label}><span>{fee.label}</span><small>×{fee.count}</small><strong>{formatCurrency(fee.amount, currency)}</strong></div>
                ))}
              </div>
            ) : <div className="counterparty-empty">No charges in this period.</div>}
          </section>

          <section className="panel extras-panel">
            <div className="panel-heading"><div><div className="panel-kicker">SPENDING RHYTHM</div><h2>{formatCurrency(rhythm.dailyAverage, currency)} a day on average</h2></div><CalendarDays size={16} className="muted-icon" /></div>
            <div className="weekday-chart" role="img" aria-label={`Average spending by weekday${rhythm.busiestWeekday ? `; highest on ${rhythm.busiestWeekday}` : ""}`}>
              {rhythm.byWeekday.map((day) => (
                <div key={day.label} className={day.label === rhythm.busiestWeekday ? "busiest" : ""} title={`${day.label}: ${formatCurrency(day.average, currency)} on an average ${day.label}`}>
                  <span style={{ height: `${Math.max((day.average / maxWeekday) * 100, 2)}%` }} />
                  <small>{day.label}</small>
                </div>
              ))}
            </div>
            <p className="panel-note">{rhythm.busiestWeekday ? `${rhythm.busiestWeekday} is your heaviest spending day, across ${rhythm.days.toLocaleString("en-NG")} days.` : "Not enough spending to show a pattern."}</p>
          </section>
        </div>
      </div>

      <section className="panel report-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">ALL MONTHS</div><h2>Monthly report</h2></div>
          <button className="button button-secondary" disabled={!report.length} onClick={() => downloadFile(monthlyReportToCsv(report), "spendwise-monthly-report.csv", "text/csv;charset=utf-8")}><Download size={14} /> Export CSV</button>
        </div>
        <p className="panel-note">Spending is shown after refunds; your own transfers between accounts and savings pots are left out.</p>
        {report.length ? (
          <div className="simple-table-wrap report-table-wrap">
            <table className="simple-table report-table">
              <thead><tr><th>MONTH</th><th>MONEY IN</th><th>MONEY OUT</th><th>NET</th><th>BETTING</th><th>FEES</th><th>TOP CATEGORY</th><th>TXNS</th></tr></thead>
              <tbody>
                {report.map((row) => (
                  <tr key={row.month}>
                    <td><strong>{formatMonth(row.month)}</strong></td>
                    <td>{formatCurrency(row.income, currency)}</td>
                    <td>{formatCurrency(row.spending, currency)}</td>
                    <td className={row.net < 0 ? "text-negative" : "text-positive"}>{row.net > 0 ? "+" : ""}{formatCurrency(row.net, currency)}</td>
                    <td>{formatCurrency(row.betting, currency)}</td>
                    <td>{formatCurrency(row.fees, currency)}</td>
                    <td>{row.topCategory ?? "—"}</td>
                    <td>{row.transactions.toLocaleString("en-NG")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="counterparty-empty">No months to report yet.</div>}
      </section>
    </>
  );
}
