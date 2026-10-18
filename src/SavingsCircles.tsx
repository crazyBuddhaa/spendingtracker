import { useState } from "react";
import { CalendarDays, Check, ChevronRight, CircleDollarSign, Plus, RotateCw, Trash2, X } from "lucide-react";
import type { CircleEntry, SavingsCircle } from "./types";
import { savingsCircleSummary } from "./lib/savingsCircles";

interface SavingsCirclesProps {
  circles: SavingsCircle[];
  currency: string;
  onCreate: (circle: Omit<SavingsCircle, "id">) => void;
  onUpdate: (circle: SavingsCircle) => void;
  onDelete: (circleId: string) => void;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function localDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function SavingsCircles({ circles, currency, onCreate, onUpdate, onDelete }: SavingsCirclesProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [contributionAmount, setContributionAmount] = useState("");
  const [intervalDays, setIntervalDays] = useState("");
  const [memberCount, setMemberCount] = useState("");
  const [myPosition, setMyPosition] = useState("");
  const [currentTurn, setCurrentTurn] = useState("");
  const [myPayoutReceived, setMyPayoutReceived] = useState(false);
  const [currentTurnDate, setCurrentTurnDate] = useState("");
  const [entryCircleId, setEntryCircleId] = useState<string | null>(null);
  const [entryKind, setEntryKind] = useState<CircleEntry["kind"]>("contribution");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDate, setEntryDate] = useState(localDate());

  const submitCircle = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const contribution = Number(contributionAmount);
    const days = Number(intervalDays);
    const members = Number(memberCount);
    const position = Number(myPosition);
    const turn = Number(currentTurn);
    if (
      !name.trim() ||
      !Number.isFinite(contribution) || contribution <= 0 ||
      !Number.isInteger(days) || days < 1 ||
      !Number.isInteger(members) || members < 2 ||
      !Number.isInteger(position) || position < 1 || position > members ||
      !Number.isInteger(turn) || turn < 1 || turn > members
    ) return;

    onCreate({
      name: name.trim(),
      contributionAmount: contribution,
      intervalDays: days,
      memberCount: members,
      myPosition: position,
      currentTurn: turn,
      myPayoutReceived,
      currentTurnDate: currentTurnDate || null,
      entries: [],
    });
    setName("");
    setContributionAmount("");
    setIntervalDays("");
    setMemberCount("");
    setMyPosition("");
    setCurrentTurn("");
    setMyPayoutReceived(false);
    setCurrentTurnDate("");
    setShowCreate(false);
  };

  const beginEntry = (circle: SavingsCircle, kind: CircleEntry["kind"]) => {
    setEntryCircleId(circle.id);
    setEntryKind(kind);
    setEntryAmount(String(kind === "contribution" ? circle.contributionAmount : circle.contributionAmount * circle.memberCount));
    setEntryDate(localDate());
  };

  const submitEntry = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const circle = circles.find((item) => item.id === entryCircleId);
    const amount = Number(entryAmount);
    if (!circle || !entryDate || !Number.isFinite(amount) || amount <= 0) return;
    const entry: CircleEntry = {
      id: globalThis.crypto?.randomUUID?.() ?? `circle-entry-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
      date: entryDate,
      kind: entryKind,
      amount,
      turn: entryKind === "payout" ? circle.myPosition : circle.currentTurn,
    };
    onUpdate({
      ...circle,
      entries: [...circle.entries, entry],
      myPayoutReceived: entryKind === "payout" ? true : circle.myPayoutReceived,
    });
    setEntryCircleId(null);
  };

  const advanceTurn = (circle: SavingsCircle) => {
    const nextTurn = circle.currentTurn === circle.memberCount ? 1 : circle.currentTurn + 1;
    if (!window.confirm(`Move the current turn from #${circle.currentTurn} to #${nextTurn}?`)) return;
    let nextDate: string | null = null;
    if (circle.currentTurnDate) {
      const date = new Date(`${circle.currentTurnDate}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + circle.intervalDays);
      nextDate = date.toISOString().slice(0, 10);
    }
    onUpdate({
      ...circle,
      currentTurn: nextTurn,
      currentTurnDate: nextDate,
      myPayoutReceived: nextTurn === 1 ? false : circle.myPayoutReceived,
    });
  };

  const entryCircle = circles.find((circle) => circle.id === entryCircleId);

  return (
    <section className="circle-section">
      <div className="page-heading circle-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> ROTATING CONTRIBUTIONS</div>
          <h2>Contribution circles</h2>
          <p className="page-subtitle">Track offline group turns separately from money you’ve saved for yourself.</p>
        </div>
        <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add a circle</button>
      </div>

      {circles.length ? (
        <div className="circle-grid">
          {circles.map((circle) => {
            const summary = savingsCircleSummary(circle);
            const entries = [...circle.entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
            return (
              <article className="panel circle-card" key={circle.id}>
                <button className="icon-button circle-delete" onClick={() => window.confirm(`Delete “${circle.name}” and its local history?`) && onDelete(circle.id)} aria-label={`Delete ${circle.name}`} title="Delete circle"><Trash2 size={14} /></button>
                <div className="circle-card-heading">
                  <span className="circle-icon"><RotateCw size={17} /></span>
                  <div><span className="savings-label">OFFLINE ROTATION</span><h3>{circle.name}</h3></div>
                </div>
                <div className="circle-payout-summary">
                  <span>POOL PAYOUT PER TURN</span>
                  <strong>{formatCurrency(summary.payoutAmount, currency)}</strong>
                  <small>{formatCurrency(circle.contributionAmount, currency)} × {circle.memberCount} members</small>
                </div>
                <div className="circle-facts">
                  <div><span>YOUR POSITION</span><strong>#{circle.myPosition} of {circle.memberCount}</strong></div>
                  <div><span>CURRENT TURN</span><strong>#{circle.currentTurn}</strong></div>
                  <div><span>CONTRIBUTION</span><strong>{formatCurrency(circle.contributionAmount, currency)} every {circle.intervalDays} days</strong></div>
                  <div><span>FULL ROTATION</span><strong>{circle.memberCount} turns · about {summary.cycleDays} days</strong></div>
                </div>
                <div className="circle-next-payout">
                  <CircleDollarSign size={16} />
                  <div>
                    <strong>{circle.myPayoutReceived ? "Your payout this rotation is recorded as received" : "Your payout this rotation is not yet recorded"}</strong>
                    <small>
                      {summary.turnsUntilNextPayout === 0
                        ? "Your position is the current turn."
                        : `Next personal payout: ${summary.turnsUntilNextPayout} turn${summary.turnsUntilNextPayout === 1 ? "" : "s"} away (about ${summary.daysUntilNextPayout} days from the current turn).`}
                      {summary.expectedPayoutDate ? ` Expected around ${formatDate(summary.expectedPayoutDate)}.` : ""}
                    </small>
                  </div>
                </div>
                <label className="circle-date-field"><CalendarDays size={14} /><span>Current turn date (optional)</span>
                  <input type="date" value={circle.currentTurnDate ?? ""} onChange={(event) => onUpdate({ ...circle, currentTurnDate: event.target.value || null })} />
                </label>
                <div className="circle-ledger-summary">
                  <span>{summary.contributionCount} contributions · {summary.payoutCount} payouts recorded</span>
                  <span>Net logged: {formatCurrency(summary.netRecorded, currency)}</span>
                </div>
                <div className="circle-actions">
                  <button className="button button-secondary" onClick={() => beginEntry(circle, "contribution")}><Plus size={13} /> Log contribution</button>
                  <button className="button button-secondary" onClick={() => beginEntry(circle, "payout")}><CircleDollarSign size={14} /> Log payout</button>
                  <button className="button button-text" onClick={() => advanceTurn(circle)}><ChevronRight size={15} /> Advance turn</button>
                </div>
                {entries.length ? (
                  <div className="circle-history">
                    <span className="savings-label">RECENT LOCAL HISTORY</span>
                    {entries.map((entry) => (
                      <div className="circle-history-row" key={entry.id}>
                        <span>{formatDate(entry.date)} · {entry.kind === "contribution" ? `Contribution for #${entry.turn}` : `Payout at #${entry.turn}`}</span>
                        <strong>{entry.kind === "contribution" ? "−" : "+"}{formatCurrency(entry.amount, currency)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="circle-history-empty">No payments logged yet. Records stay in this browser.</p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel circle-empty">
          <div className="savings-empty-icon"><RotateCw size={20} /></div>
          <strong>No contribution circles yet.</strong>
          <p>Create one to track the amount, interval, member order, current turn, and your payouts. This does not move money.</p>
          <button className="button button-secondary" onClick={() => setShowCreate(true)}><Plus size={14} /> Set up a circle</button>
        </section>
      )}

      <p className="circle-privacy-note">Circle details and entries are stored in this browser only. They are not uploaded to a bank or group member.</p>

      {showCreate && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowCreate(false)}>
          <section className="privacy-modal circle-modal" role="dialog" aria-modal="true" aria-labelledby="circle-create-heading">
            <button className="icon-button modal-close" onClick={() => setShowCreate(false)} aria-label="Close"><X size={18} /></button>
            <div className="privacy-modal-icon"><RotateCw size={20} /></div>
            <div className="panel-kicker">NEW OFFLINE CIRCLE</div>
            <h2 id="circle-create-heading">Set up the rotation</h2>
            <p className="savings-form-help">Enter the group rules and current position. This tracker records activity; it does not send or collect money.</p>
            <form className="savings-form circle-form" onSubmit={submitCircle}>
              <label>Circle name<input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Rotating contribution" /></label>
              <label>Your contribution ({currency})<input required type="number" min="0.01" step="0.01" value={contributionAmount} onChange={(event) => setContributionAmount(event.target.value)} placeholder="5000" /></label>
              <label>Days between turns<input required type="number" min="1" step="1" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} placeholder="10" /></label>
              <label>Number of members<input required type="number" min="2" step="1" value={memberCount} onChange={(event) => setMemberCount(event.target.value)} placeholder="14" /></label>
              <label>Your position<input required type="number" min="1" step="1" value={myPosition} onChange={(event) => setMyPosition(event.target.value)} placeholder="9" /></label>
              <label>Current turn<input required type="number" min="1" step="1" value={currentTurn} onChange={(event) => setCurrentTurn(event.target.value)} placeholder="14" /></label>
              <label>Current turn date (optional)<input type="date" value={currentTurnDate} onChange={(event) => setCurrentTurnDate(event.target.value)} /></label>
              <label className="circle-checkbox"><input type="checkbox" checked={myPayoutReceived} onChange={(event) => setMyPayoutReceived(event.target.checked)} /> I already received my payout this rotation</label>
              <button className="button button-primary modal-done" type="submit"><Check size={15} /> Save circle in this browser</button>
            </form>
          </section>
        </div>
      )}

      {entryCircle && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEntryCircleId(null)}>
          <section className="privacy-modal circle-modal" role="dialog" aria-modal="true" aria-labelledby="circle-entry-heading">
            <button className="icon-button modal-close" onClick={() => setEntryCircleId(null)} aria-label="Close"><X size={18} /></button>
            <div className="privacy-modal-icon">{entryKind === "contribution" ? <Plus size={19} /> : <CircleDollarSign size={19} />}</div>
            <div className="panel-kicker">LOCAL CIRCLE HISTORY</div>
            <h2 id="circle-entry-heading">{entryKind === "contribution" ? "Log a contribution" : "Log a payout"}</h2>
            <p className="savings-form-help">
              {entryKind === "contribution"
                ? `${entryCircle.name} · contribution for current turn #${entryCircle.currentTurn}`
                : `${entryCircle.name} · your payout at position #${entryCircle.myPosition}`}
            </p>
            <form className="savings-form" onSubmit={submitEntry}>
              <label>Amount ({currency})<input autoFocus required type="number" min="0.01" step="0.01" value={entryAmount} onChange={(event) => setEntryAmount(event.target.value)} /></label>
              <label>Date<input required type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
              <button className="button button-primary modal-done" type="submit"><Check size={15} /> Save local record</button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
