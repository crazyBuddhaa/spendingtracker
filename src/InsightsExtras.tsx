import { useMemo, useState } from "react";
import { CalendarDays, CalendarRange, Clock3, Download, ListOrdered, Receipt, TrendingDown, TrendingUp, Users } from "lucide-react";
import type { Transaction } from "./types";
import { getFeeSummary, getMonthlyReport, getSpendingRhythm, getTopCounterparties, monthlyReportToCsv } from "./lib/analytics";
import type { DateRange } from "./lib/insights";
import { downloadFile, formatCurrency, formatDate, formatMonth } from "./lib/format";
import { formatHour, formatMinuteOfDay, getSpendingTimeAnalytics } from "./lib/spendingTimeAnalytics";
import { getSpendingPatternAnalytics } from "./lib/spendingPatterns";
import {
  getIncomeSpendingTimeline,
  getSpendingSessionAnalytics,
  getTimePeriodPatterns,
  getTimeToFirstDiscretionaryPurchase,
} from "./lib/timeSpendingAnalytics";

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
  const timeAnalytics = useMemo(() => getSpendingTimeAnalytics(transactions), [transactions]);
  const cashflowTimeline = useMemo(() => getIncomeSpendingTimeline(transactions, 24), [transactions]);
  const patterns = useMemo(() => getSpendingPatternAnalytics(transactions, range), [transactions, range.start, range.end]);
  const firstDiscretionary = useMemo(() => getTimeToFirstDiscretionaryPurchase(transactions), [transactions]);
  const sessions = useMemo(() => getSpendingSessionAnalytics(transactions), [transactions]);
  const timePeriods = useMemo(() => getTimePeriodPatterns(transactions, range), [transactions, range.start, range.end]);
  const maxWeekday = Math.max(1, ...rhythm.byWeekday.map((day) => day.average));
  const maxCounterparty = Math.max(1, ...counterparties.map((item) => item.amount));
  const maxHourlySpend = Math.max(1, ...timeAnalytics.byHour.map((hour) => hour.amount));
  const maxHeatmapSpend = Math.max(1, ...timeAnalytics.heatmap.flatMap((day) => day.cells.map((cell) => cell.amount)));
  const maxDailyPattern = Math.max(1, ...patterns.dailyTrend.map((day) => day.amount));
  const maxWeeklyPattern = Math.max(1, ...patterns.weeklyTrend.map((week) => week.amount));
  const maxWeeklyFrequency = Math.max(1, ...patterns.weeklyTrend.map((week) => week.transactionCount));
  const maxDayPartSpend = Math.max(1, ...timePeriods.byDayPart.map((part) => part.amount));
  const maxCalendarPeriodAverage = Math.max(1, timePeriods.weekday.averagePerDay, timePeriods.weekend.averagePerDay);
  const peakHour = timeAnalytics.byHour.filter((hour) => hour.count > 0).sort((a, b) => b.amount - a.amount)[0];
  const paceChange = patterns.velocityChangePercent;
  const frequencyChange = patterns.frequencyChangePercent;
  const medianDelayLabel = firstDiscretionary.medianCalendarDays === null
    ? "Not enough data"
    : firstDiscretionary.medianCalendarDays === 0
      ? "Same day"
      : `${firstDiscretionary.medianCalendarDays.toLocaleString("en-NG", { maximumFractionDigits: 1 })} calendar days`;
  const medianSameDayMinutes = firstDiscretionary.medianSameDayMinutes;

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

      <section className="panel extras-panel spending-pattern-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">SPENDING VELOCITY &amp; FREQUENCY</div><h2>Daily and weekly patterns</h2></div>
          <CalendarRange size={16} className="muted-icon" />
        </div>
        {patterns.transactionCount ? (
          <>
            <div className="pattern-metrics">
              <div className="pattern-metric"><span>DAILY AVERAGE</span><strong>{formatCurrency(patterns.averageDailySpending, currency, true)}</strong><small>per calendar day · {patterns.calendarDays.toLocaleString("en-NG")} days</small></div>
              <div className="pattern-metric"><span>WEEKLY PACE</span><strong>{formatCurrency(patterns.weeklyPace, currency, true)}</strong><small>at this period’s daily rate</small></div>
              <div className="pattern-metric"><span>TRANSACTIONS</span><strong>{patterns.transactionsPerWeek.toFixed(1)}<small> / week</small></strong><small>{patterns.transactionCount.toLocaleString("en-NG")} expense transactions</small></div>
            </div>

            <p className="pattern-comparison">
              {paceChange !== null || frequencyChange !== null ? (
                <>
                  {paceChange !== null && (
                    <span className={paceChange > 0 ? "pattern-change-up" : paceChange < 0 ? "pattern-change-down" : ""}>
                      {paceChange > 0 ? <TrendingUp size={13} /> : paceChange < 0 ? <TrendingDown size={13} /> : null}
                      Spend pace {paceChange > 0 ? "up" : paceChange < 0 ? "down" : "unchanged"} {Math.abs(paceChange).toFixed(1)}%
                    </span>
                  )}
                  {frequencyChange !== null && (
                    <span className={frequencyChange > 0 ? "pattern-change-up" : frequencyChange < 0 ? "pattern-change-down" : ""}>
                      {frequencyChange > 0 ? <TrendingUp size={13} /> : frequencyChange < 0 ? <TrendingDown size={13} /> : null}
                      Transaction frequency {frequencyChange > 0 ? "up" : frequencyChange < 0 ? "down" : "unchanged"} {Math.abs(frequencyChange).toFixed(1)}%
                    </span>
                  )}
                  <small>Latest 7 days compared with the previous 7 days in this period.</small>
                </>
              ) : <small>Compare with the prior week once this period includes at least 14 days and the prior week has recorded activity.</small>}
            </p>

            <div className="spending-pattern-grid">
              <div className="pattern-chart-panel">
                <div className="pattern-chart-heading"><div><h3>Daily spend</h3><p>Latest {patterns.dailyTrend.length} calendar days in this period</p></div></div>
                <div className="pattern-bars daily-pattern-bars" role="img" aria-label={`Daily spending for the latest ${patterns.dailyTrend.length} days`}>
                  {patterns.dailyTrend.map((day, index) => (
                    <div className="pattern-bar" key={day.date} title={`${formatDate(day.date)}: ${formatCurrency(day.amount, currency)} · ${day.transactionCount} transaction${day.transactionCount === 1 ? "" : "s"}`}>
                      <span style={{ height: `${day.amount > 0 ? Math.max((day.amount / maxDailyPattern) * 100, 3) : 0}%` }} />
                      <small>{index === 0 || index === patterns.dailyTrend.length - 1 || index % 5 === 0 ? day.date.slice(8, 10) : ""}</small>
                    </div>
                  ))}
                </div>
                <div className="pattern-peak">
                  <span>Peak day</span>
                  <strong>{patterns.peakDay ? `${formatDate(patterns.peakDay.date)} · ${formatCurrency(patterns.peakDay.amount, currency, true)}` : "—"}</strong>
                </div>
              </div>

              <div className="pattern-chart-panel">
                <div className="pattern-chart-heading"><div><h3>Weekly spend</h3><p>Latest {patterns.weeklyTrend.length} calendar weeks · bars include transaction counts</p></div></div>
                <div className="pattern-bars weekly-pattern-bars" role="img" aria-label={`Weekly spending for the latest ${patterns.weeklyTrend.length} weeks`}>
                  {patterns.weeklyTrend.map((week, index) => (
                    <div className="pattern-bar" key={week.weekStart} title={`${formatDate(week.weekStart)}–${formatDate(week.weekEnd)}: ${formatCurrency(week.amount, currency)} · ${week.transactionCount} transaction${week.transactionCount === 1 ? "" : "s"} · ${week.daysInPeriod} day${week.daysInPeriod === 1 ? "" : "s"} in selected period`}>
                      <div className="pattern-bar-pair">
                        <span className="pattern-bar-spend" style={{ height: `${week.amount > 0 ? Math.max((week.amount / maxWeeklyPattern) * 100, 3) : 0}%` }} />
                        <i className="pattern-bar-frequency" style={{ height: `${week.transactionCount ? Math.max((week.transactionCount / maxWeeklyFrequency) * 100, 3) : 0}%` }} />
                      </div>
                      <small>{index === 0 || index === patterns.weeklyTrend.length - 1 || index % 4 === 0 ? formatDate(week.weekStart).slice(0, 5) : ""}</small>
                    </div>
                  ))}
                </div>
                <div className="pattern-chart-legend"><span><i className="pattern-legend-spend" />Spend</span><span><i className="pattern-legend-frequency" />Transactions</span></div>
                <div className="pattern-peaks">
                  <div className="pattern-peak">
                    <span>Peak spend week</span>
                    <strong>{patterns.peakWeek ? `${formatDate(patterns.peakWeek.weekStart)}–${formatDate(patterns.peakWeek.weekEnd)} · ${formatCurrency(patterns.peakWeek.amount, currency, true)}` : "—"}</strong>
                  </div>
                  <div className="pattern-peak">
                    <span>Most transactions</span>
                    <strong>{patterns.peakFrequencyWeek ? `${formatDate(patterns.peakFrequencyWeek.weekStart)}–${formatDate(patterns.peakFrequencyWeek.weekEnd)} · ${patterns.peakFrequencyWeek.transactionCount}` : "—"}</strong>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="counterparty-empty"><CalendarRange size={14} /> No expense transactions in this period yet. Import or add expenses to see pace, frequency, and peak periods.</div>
        )}
      </section>

      <div className="spending-time-grid">
        <section className="panel extras-panel">
          <div className="panel-heading">
            <div><div className="panel-kicker">HOURLY SPENDING</div><h2>When spending happens</h2></div>
            <Clock3 size={16} className="muted-icon" />
          </div>
          {timeAnalytics.timedTransactions ? (
            <>
              <div className="hourly-chart" role="img" aria-label={`Hourly spending totals for ${timeAnalytics.timedTransactions} timed transactions`}>
                {timeAnalytics.byHour.map((hour) => (
                  <div className="hourly-chart-bar" key={hour.hour} title={`${formatHour(hour.hour)}: ${formatCurrency(hour.amount, currency)} across ${hour.count} transaction${hour.count === 1 ? "" : "s"}`}>
                    <span style={{ height: `${Math.max((hour.amount / maxHourlySpend) * 100, hour.amount > 0 ? 3 : 0)}%` }} />
                    <small>{hour.hour % 3 === 0 ? String(hour.hour).padStart(2, "0") : ""}</small>
                  </div>
                ))}
              </div>
              <div className="time-coverage-note">
                <strong>{formatCurrency(timeAnalytics.totalTimedSpending, currency)}</strong> across {timeAnalytics.timedTransactions.toLocaleString("en-NG")} timed expenses.
                {timeAnalytics.untimedTransactions > 0 && ` ${timeAnalytics.untimedTransactions.toLocaleString("en-NG")} expenses have no usable time.`}
                {" "}{Math.round(timeAnalytics.timeCoverageByAmount * 100)}% of recorded spending is represented.
                {peakHour && <> Peak hour: <strong>{formatHour(peakHour.hour)}</strong> ({formatCurrency(peakHour.amount, currency, true)}).</>}
              </div>
            </>
          ) : <div className="counterparty-empty"><Clock3 size={14} /> No timed expense transactions in this period. Bank statements that include time of day unlock hourly patterns.</div>}
        </section>

        <section className="panel extras-panel">
          <div className="panel-heading">
            <div><div className="panel-kicker">SPENDING HEATMAP</div><h2>Weekday by hour</h2></div>
            <CalendarRange size={16} className="muted-icon" />
          </div>
          {timeAnalytics.timedTransactions ? (
            <>
              <div className="heatmap-scroll">
                <div className="spending-heatmap" role="img" aria-label="Expense totals grouped by weekday and hour">
                  <div className="heatmap-header"><span />{Array.from({ length: 24 }, (_, hour) => <small key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</small>)}</div>
                  {timeAnalytics.heatmap.map((day) => (
                    <div className="heatmap-row" key={day.day}>
                      <strong>{day.day}</strong>
                      {day.cells.map((cell) => {
                        const opacity = cell.amount > 0 ? 0.1 + (cell.amount / maxHeatmapSpend) * 0.75 : 0;
                        const label = `${day.day} ${formatHour(cell.hour)}: ${formatCurrency(cell.amount, currency)} across ${cell.count} transaction${cell.count === 1 ? "" : "s"}`;
                        return <span key={cell.hour} title={label} aria-label={label} style={{ backgroundColor: opacity ? `rgba(47, 122, 85, ${opacity})` : "#f0f3f0" }} />;
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="heatmap-legend"><span>Lower spend</span><i /><i /><i /><i /><span>Higher spend</span></div>
            </>
          ) : <div className="counterparty-empty"><CalendarRange size={14} /> The heatmap appears when at least one expense has a recorded time.</div>}
        </section>
      </div>

      <div className="time-analysis-grid">
        <section className="panel extras-panel time-analysis-panel">
          <div className="panel-heading">
            <div><div className="panel-kicker">INCOME TO FIRST DISCRETIONARY PURCHASE</div><h2>{medianDelayLabel}</h2></div>
            <CalendarDays size={16} className="muted-icon" />
          </div>
          {firstDiscretionary.matchedIncomeDates ? (
            <>
              <div className="time-analysis-stat">
                <strong>{firstDiscretionary.matchedIncomeDates} of {firstDiscretionary.incomeDates}</strong>
                <span>income dates were followed by a categorized discretionary purchase before the next recorded income.</span>
              </div>
              {medianSameDayMinutes !== null && (
                <p className="panel-note">For {firstDiscretionary.timedSameDayPurchases} same-day purchase{firstDiscretionary.timedSameDayPurchases === 1 ? "" : "s"} with usable times, the median delay was {Math.floor(medianSameDayMinutes / 60)}h {Math.round(medianSameDayMinutes % 60)}m.</p>
              )}
              <div className="time-match-list">
                {firstDiscretionary.matches.slice(0, 4).map((match) => (
                  <div key={`${match.incomeDate}-${match.purchaseDate}-${match.purchaseName}`}>
                    <span>{formatDate(match.incomeDate)} income</span>
                    <strong>{match.purchaseName}</strong>
                    <small>{match.purchaseCategory} · {match.calendarDays === 0 ? "same day" : `${match.calendarDays} day${match.calendarDays === 1 ? "" : "s"} later`}</small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="counterparty-empty"><CalendarDays size={14} /> No matched income-to-purchase intervals in this period yet.</div>
          )}
          <p className="panel-note">Discretionary categories here are Shopping, Entertainment, and Betting. Same-day order is counted only when all income and purchase times are recorded; the latest income interval may still be in progress.</p>
        </section>

        <section className="panel extras-panel time-analysis-panel">
          <div className="panel-heading">
            <div><div className="panel-kicker">SPENDING SESSIONS</div><h2>{sessions.sessionCount} grouped session{sessions.sessionCount === 1 ? "" : "s"}</h2></div>
            <Clock3 size={16} className="muted-icon" />
          </div>
          <div className="session-metrics">
            <div><span>TIMED EXPENSES</span><strong>{sessions.timedTransactions.toLocaleString("en-NG")}</strong></div>
            <div><span>IN SESSIONS</span><strong>{sessions.groupedTransactionCount.toLocaleString("en-NG")}</strong></div>
            <div><span>AVG SESSION</span><strong>{formatCurrency(sessions.averageSessionAmount, currency, true)}</strong></div>
          </div>
          <p className="panel-note">A session groups at least two same-day expenses with no more than 60 minutes between consecutive transactions. Transactions without a valid time are not grouped.</p>
          {sessions.largestSessions.length ? (
            <div className="session-list">
              {sessions.largestSessions.slice(0, 4).map((session) => (
                <div key={`${session.date}-${session.startMinute}-${session.endMinute}`}>
                  <span>{formatDate(session.date)} · {formatMinuteOfDay(session.startMinute)}–{formatMinuteOfDay(session.endMinute)}</span>
                  <small>{session.transactionCount} transactions · {session.categories.join(", ")}</small>
                  <strong>{formatCurrency(session.amount, currency, true)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="counterparty-empty"><Clock3 size={14} /> No multi-transaction sessions detected from the available timed expenses.</div>
          )}
        </section>
      </div>

      <section className="panel extras-panel time-period-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">MORNING, EVENING &amp; TIME-PERIOD COMPARISONS</div><h2>When and which days spending happens</h2></div>
          <CalendarRange size={16} className="muted-icon" />
        </div>
        <div className="time-period-grid">
          <div className="time-period-section">
            <h3>By time of day</h3>
            <p className="time-period-subtitle">Expenses with a valid statement time</p>
            <div className="daypart-list">
              {timePeriods.byDayPart.map((part) => (
                <div className="daypart-row" key={part.key}>
                  <div className="daypart-label"><strong>{part.label}</strong><small>{part.hours} · {part.transactionCount} transaction{part.transactionCount === 1 ? "" : "s"}</small></div>
                  <span className="daypart-track"><i style={{ width: `${Math.max((part.amount / maxDayPartSpend) * 100, part.amount > 0 ? 2 : 0)}%` }} /></span>
                  <strong className="daypart-amount">{formatCurrency(part.amount, currency, true)}</strong>
                </div>
              ))}
            </div>
            <p className="panel-note">{timePeriods.timedTransactions} of {timePeriods.totalDatedExpenses} dated expenses include a usable time ({timePeriods.totalDatedExpenses ? Math.round((timePeriods.timedTransactions / timePeriods.totalDatedExpenses) * 100) : 0}% time coverage).</p>
          </div>

          <div className="time-period-section">
            <h3>Weekdays vs weekends</h3>
            <p className="time-period-subtitle">Average spend per calendar day, including expenses without a time</p>
            {[timePeriods.weekday, timePeriods.weekend].map((period) => (
              <div className="calendar-period-row" key={period.label}>
                <div className="calendar-period-heading"><strong>{period.label}</strong><small>{period.days} calendar days · {period.transactionCount} transactions</small></div>
                <strong>{formatCurrency(period.averagePerDay, currency, true)}<small> / day</small></strong>
                <span className="daypart-track"><i style={{ width: `${Math.max((period.averagePerDay / maxCalendarPeriodAverage) * 100, period.averagePerDay > 0 ? 2 : 0)}%` }} /></span>
                <small>Total {formatCurrency(period.amount, currency, true)}</small>
              </div>
            ))}
            <p className="panel-note">
              {timePeriods.weekendVsWeekdayAveragePercent === null
                ? "A weekday-to-weekend average comparison needs recorded weekday spending."
                : `Weekend daily spending is ${Math.abs(timePeriods.weekendVsWeekdayAveragePercent).toFixed(1)}% ${timePeriods.weekendVsWeekdayAveragePercent > 0 ? "higher" : timePeriods.weekendVsWeekdayAveragePercent < 0 ? "lower" : "the same as"} weekday spending in this period.`}
            </p>
          </div>
        </div>
      </section>

      <section className="panel extras-panel spending-timeline-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">INCOME-TO-SPENDING TIMELINE</div><h2>Recent cashflow in this period</h2></div>
          <span className="heading-note"><ListOrdered size={14} /> {cashflowTimeline.length} shown</span>
        </div>
        <p className="panel-note">Income, refunds, and expenses in reverse chronological order. Confirmed internal transfers are excluded; transactions without a statement time appear after timed entries on the same date.</p>
        {cashflowTimeline.length ? (
          <ol className="spending-timeline">
            {cashflowTimeline.map(({ transaction, name, minuteOfDay, kind }) => (
              <li key={transaction.id} className={`cashflow-row-${kind}`}>
                <button className="spending-timeline-entry" onClick={() => onSearch(transaction.description)} title={transaction.description}>
                  <span className="spending-timeline-marker" aria-hidden="true" />
                  <span className="spending-timeline-copy">
                    <strong>{name}</strong>
                    <small>{kind === "income" ? "Income" : kind === "refund" ? "Refund" : "Expense"} · {transaction.category} · {minuteOfDay === null ? "Time not recorded" : formatMinuteOfDay(minuteOfDay)} · {transaction.source}</small>
                  </span>
                  <span className="spending-timeline-date">{formatDate(transaction.date)}</span>
                  <strong className="spending-timeline-amount">{kind === "expense" ? "−" : "+"}{formatCurrency(transaction.amount, currency, true)}</strong>
                </button>
              </li>
            ))}
          </ol>
        ) : <div className="counterparty-empty"><ListOrdered size={14} /> No income or spending transactions in this period.</div>}
      </section>

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
