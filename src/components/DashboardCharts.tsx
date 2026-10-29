import { BarChart3 } from "lucide-react";
import { formatCurrency } from "../lib/format";
import { categoryColors } from "../app/constants";
import type { getCategoryTotals, MonthTotal } from "../lib/insights";
import type { Category } from "../types";

export function CashflowChart({ data, currency }: { data: MonthTotal[]; currency: string }) {
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
      <svg className="cashflow-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Monthly income and money out, ${data[0].label} to ${data[data.length - 1].label}`}>
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
              <title>{`${item.label}\nIncome: ${formatCurrency(item.income, currency)}\nMoney out: ${formatCurrency(item.expenses, currency)}`}</title>
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

export function CategoryChart({
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
  const positiveTotal = categories.reduce((sum, item) => sum + Math.max(item.amount, 0), 0);
  const categoryLabel = (category: Category) => category === "Transfers" ? "Transfers to others" : category === "Refunds" ? "Refunds (credit)" : category;
  let accumulated = 0;
  return (
    <div className={`category-chart-layout ${large ? "category-chart-layout--large" : ""}`}>
      <div className="donut-wrap">
        <svg className="donut-chart" viewBox="0 0 120 120" role="img" aria-label="Money out by category">
          <circle cx="60" cy="60" r={radius} className="donut-track" />
          {categories.filter((item) => item.amount > 0).map((item) => {
            const dash = positiveTotal > 0 ? (item.amount / positiveTotal) * circumference : 0;
            const offset = accumulated;
            accumulated += dash;
            return <circle key={item.category} cx="60" cy="60" r={radius} className="donut-segment" stroke={categoryColors[item.category]} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset}><title>{categoryLabel(item.category)}: {formatCurrency(item.amount, currency)}</title></circle>;
          })}
          <text x="60" y="56" textAnchor="middle" className="donut-center-label">MONEY OUT</text>
          <text x="60" y="73" textAnchor="middle" className="donut-center-value">{formatCurrency(total, currency, true)}</text>
        </svg>
      </div>
      <div className="category-legend">
        {categories.slice(0, large ? 10 : 6).map((item) => (
          <button className="category-row" key={item.category} onClick={() => onSelect?.(item.category)} disabled={!onSelect} title={onSelect ? `Show ${categoryLabel(item.category)} transactions` : undefined}>
            <span className="category-name"><i className="category-swatch" style={{ backgroundColor: categoryColors[item.category] }} />{categoryLabel(item.category)}</span>
            <span className="category-amount">{formatCurrency(item.amount, currency, true)}</span>
            <span className="category-share">{positiveTotal > 0 ? Math.round((item.amount / positiveTotal) * 100) : 0}%</span>
          </button>
        ))}
        {categories.length === 0 && <div className="chart-empty"><BarChart3 size={17} />No spending in this period</div>}
      </div>
    </div>
  );
}