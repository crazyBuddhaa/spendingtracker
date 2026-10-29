import { useState } from "react";
import type * as React from "react";
import { ArrowUpRight, Check, FileText, LockKeyhole, LoaderCircle, Plus, X } from "lucide-react";
import { categorise } from "../lib/categorise";
import { formatDate, localIsoDate } from "../lib/format";
import type { AccessStatus } from "../useAccessAuth";
import type { ImportDateRange, ImportMode, ImportPreview } from "../lib/importPreview";
import { categoryList, type Category, type Direction, type Transaction } from "../types";

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