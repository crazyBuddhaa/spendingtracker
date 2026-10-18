import { useMemo, useState } from "react";
import { ArrowDownLeft, Check, Plus, PiggyBank, Target, Trash2, Wallet, X } from "lucide-react";
import type { SavingsGoal } from "./types";
import { savedForGoal, savingsSummary } from "./lib/savings";

interface SavingsPageProps {
  goals: SavingsGoal[];
  currency: string;
  onCreateGoal: (name: string, targetAmount: number, startingAmount: number) => void;
  onAddContribution: (goalId: string, amount: number) => void;
  onDeleteGoal: (goalId: string) => void;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function SavingsPage({
  goals,
  currency,
  onCreateGoal,
  onAddContribution,
  onDeleteGoal,
}: SavingsPageProps) {
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [startingAmount, setStartingAmount] = useState("");
  const [contributionGoalId, setContributionGoalId] = useState<string | null>(null);
  const [contributionAmount, setContributionAmount] = useState("");
  const summary = useMemo(() => savingsSummary(goals), [goals]);
  const contributionGoal = goals.find((goal) => goal.id === contributionGoalId);

  const submitGoal = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = Number(targetAmount);
    const starting = Number(startingAmount || 0);
    if (!goalName.trim() || !Number.isFinite(target) || target <= 0 || !Number.isFinite(starting) || starting < 0) return;
    onCreateGoal(goalName.trim(), target, starting);
    setGoalName("");
    setTargetAmount("");
    setStartingAmount("");
    setShowGoalForm(false);
  };

  const submitContribution = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(contributionAmount);
    if (!contributionGoal || !Number.isFinite(amount) || amount <= 0) return;
    onAddContribution(contributionGoal.id, amount);
    setContributionAmount("");
    setContributionGoalId(null);
  };

  return (
    <section className="savings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> SAVING WITH A PLAN</div>
          <h1>Your savings goals.</h1>
          <p className="page-subtitle">Set a target, record contributions, and see how close you are. Goals are saved in this browser.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-primary" onClick={() => setShowGoalForm(true)}><Plus size={15} /> New savings goal</button>
        </div>
      </div>

      <div className="savings-overview">
        <section className="panel savings-total-card">
          <span className="savings-total-icon"><Wallet size={18} /></span>
          <div><span className="savings-label">SAVED TOWARD GOALS</span><strong>{formatCurrency(summary.saved, currency)}</strong></div>
          <span className="savings-total-note">{goals.length} active goal{goals.length === 1 ? "" : "s"}</span>
        </section>
        <section className="panel savings-total-card">
          <span className="savings-total-icon savings-target-icon"><Target size={18} /></span>
          <div><span className="savings-label">LEFT TO REACH TARGETS</span><strong>{formatCurrency(summary.remaining, currency)}</strong></div>
          <span className="savings-total-note">{Math.round(summary.progress * 100)}% overall progress</span>
        </section>
      </div>

      <section className="panel savings-chart-panel">
        <div className="panel-heading">
          <div><div className="panel-kicker">YOUR GOALS</div><h2>Progress toward each target</h2></div>
          <span className="savings-chart-caption">Saved vs. target</span>
        </div>
        {goals.length ? <SavingsGoalChart goals={goals} currency={currency} /> : (
          <div className="savings-chart-empty"><PiggyBank size={19} /><span>Create a goal to see your progress chart.</span></div>
        )}
      </section>

      {goals.length ? (
        <div className="savings-goal-grid">
          {goals.map((goal) => {
            const saved = savedForGoal(goal);
            const progress = Math.min(saved / goal.targetAmount, 1);
            const percent = Math.round(progress * 100);
            const remaining = Math.max(goal.targetAmount - saved, 0);
            return (
              <article className="panel savings-goal-card" key={goal.id}>
                <button
                  className="icon-button savings-delete"
                  onClick={() => window.confirm(`Delete the “${goal.name}” goal and its saved contribution history?`) && onDeleteGoal(goal.id)}
                  aria-label={`Delete ${goal.name} goal`}
                  title="Delete goal"
                >
                  <Trash2 size={15} />
                </button>
                <div className="goal-card-main">
                  <ProgressRing saved={saved} target={goal.targetAmount} percent={percent} currency={currency} />
                  <div className="goal-card-copy">
                    <span className="savings-label">SAVINGS GOAL</span>
                    <h2>{goal.name}</h2>
                    <p><strong>{formatCurrency(saved, currency)}</strong> saved of {formatCurrency(goal.targetAmount, currency)}</p>
                    <span className="goal-remaining">{remaining > 0 ? `${formatCurrency(remaining, currency)} to go` : "Goal reached — nice work"}</span>
                  </div>
                </div>
                <div className="goal-card-footer">
                  <span>{goal.contributions.length} contribution{goal.contributions.length === 1 ? "" : "s"}</span>
                  <button className="button button-secondary" onClick={() => setContributionGoalId(goal.id)}><Plus size={14} /> Add money</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel savings-empty-state">
          <div className="savings-empty-icon"><PiggyBank size={23} /></div>
          <h2>Give your savings a target.</h2>
          <p>Create a goal for an emergency fund, a trip, or anything you’re setting money aside for. Add contributions as you save.</p>
          <button className="button button-primary" onClick={() => setShowGoalForm(true)}><Plus size={15} /> Create your first goal</button>
        </section>
      )}

      {showGoalForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowGoalForm(false)}>
          <section className="privacy-modal savings-modal" role="dialog" aria-modal="true" aria-labelledby="new-goal-heading">
            <button className="icon-button modal-close" onClick={() => setShowGoalForm(false)} aria-label="Close"><X size={18} /></button>
            <div className="privacy-modal-icon"><Target size={20} /></div>
            <div className="panel-kicker">NEW SAVINGS GOAL</div>
            <h2 id="new-goal-heading">What are you saving for?</h2>
            <form className="savings-form" onSubmit={submitGoal}>
              <label>Goal name<input autoFocus required maxLength={60} value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="Emergency fund" /></label>
              <label>Target amount ({currency})<input required type="number" min="1" step="100" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} placeholder="500000" /></label>
              <label>Already saved ({currency})<input type="number" min="0" step="100" value={startingAmount} onChange={(event) => setStartingAmount(event.target.value)} placeholder="0" /></label>
              <button className="button button-primary modal-done" type="submit"><Check size={15} /> Save goal</button>
            </form>
          </section>
        </div>
      )}

      {contributionGoal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setContributionGoalId(null)}>
          <section className="privacy-modal savings-modal" role="dialog" aria-modal="true" aria-labelledby="contribution-heading">
            <button className="icon-button modal-close" onClick={() => setContributionGoalId(null)} aria-label="Close"><X size={18} /></button>
            <div className="privacy-modal-icon"><ArrowDownLeft size={20} /></div>
            <div className="panel-kicker">ADD TO SAVINGS</div>
            <h2 id="contribution-heading">{contributionGoal.name}</h2>
            <p className="savings-form-help">Record an amount you’ve added to this goal. This is a local tracker, not a bank transfer.</p>
            <form className="savings-form" onSubmit={submitContribution}>
              <label>Contribution amount ({currency})<input autoFocus required type="number" min="1" step="100" value={contributionAmount} onChange={(event) => setContributionAmount(event.target.value)} placeholder="10000" /></label>
              <button className="button button-primary modal-done" type="submit"><Plus size={15} /> Add contribution</button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function ProgressRing({
  saved,
  target,
  percent,
  currency,
}: {
  saved: number;
  target: number;
  percent: number;
  currency: string;
}) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(saved / target, 1);
  return (
    <div className="goal-ring" role="img" aria-label={`${percent}% of ${formatCurrency(target, currency)} saved`}>
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <circle className="goal-ring-track" cx="52" cy="52" r={radius} />
        <circle
          className="goal-ring-value"
          cx="52"
          cy="52"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <div className="goal-ring-copy"><strong>{percent}%</strong><span>saved</span></div>
    </div>
  );
}

function SavingsGoalChart({ goals, currency }: { goals: SavingsGoal[]; currency: string }) {
  const chartHeight = Math.max(90, goals.length * 54 + 16);
  const barX = 8;
  const barWidth = 360;
  return (
    <div className="savings-chart-wrap">
      <svg className="savings-goal-chart" viewBox={`0 0 560 ${chartHeight}`} role="img" aria-label="Savings progress by goal">
        {goals.map((goal, index) => {
          const y = index * 54 + 12;
          const saved = savedForGoal(goal);
          const progress = Math.min(saved / goal.targetAmount, 1);
          const percent = Math.round(progress * 100);
          const label = goal.name.length > 30 ? `${goal.name.slice(0, 27)}…` : goal.name;
          return (
            <g key={goal.id}>
              <text className="savings-chart-label" x={barX} y={y}>{label}</text>
              <text className="savings-chart-percent" x="545" y={y} textAnchor="end">{percent}%</text>
              <rect className="savings-chart-track" x={barX} y={y + 9} width={barWidth} height="10" rx="5" />
              <rect className="savings-chart-fill" x={barX} y={y + 9} width={barWidth * progress} height="10" rx="5" />
              <text className="savings-chart-amount" x={barX} y={y + 37}>{formatCurrency(saved, currency)} saved</text>
              <text className="savings-chart-amount" x={barX + barWidth} y={y + 37} textAnchor="end">Target {formatCurrency(goal.targetAmount, currency)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
