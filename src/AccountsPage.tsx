import { ArrowLeftRight, ArrowUpRight, Coins, Eye, Landmark, Settings2 } from "lucide-react";
import { supportedCurrencies, type AccountPreferences, type Transaction } from "./types";
import { accountCurrency, convertAccountAmount, summariseAccounts } from "./lib/accounts";
import { formatCurrency, formatDate } from "./lib/format";

interface AccountsPageProps {
  transactions: Transaction[];
  preferences: AccountPreferences;
  onChange: (preferences: AccountPreferences) => void;
  onOpenAccount: (account: string) => void;
}

export default function AccountsPage({ transactions, preferences, onChange, onOpenAccount }: AccountsPageProps) {
  const accounts = summariseAccounts(transactions, preferences);
  const currencies = [...new Set(accounts.map((account) => account.currency))];
  const convertedKnown = accounts.filter((account) => convertAccountAmount(1, account.currency, preferences) !== null).length;
  const totalNet = accounts.reduce((sum, account) => sum + (convertAccountAmount(account.net, account.currency, preferences) ?? 0), 0);
  const allConverted = accounts.length > 0 && convertedKnown === accounts.length;

  const setCurrency = (account: string, currency: string) => onChange({
    ...preferences,
    accountCurrencies: { ...preferences.accountCurrencies, [account]: currency },
  });
  const setRate = (currency: string, raw: string) => {
    const rates = { ...preferences.rates };
    const value = Number(raw);
    if (raw && Number.isFinite(value) && value > 0) rates[currency] = value;
    else delete rates[currency];
    onChange({ ...preferences, rates });
  };

  return (
    <section className="accounts-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> ONE VIEW, EVERY ACCOUNT</div>
          <h1>Accounts, without the blind spots.</h1>
          <p className="page-subtitle">Compare activity in each account’s native currency. Optionally show equivalents using your own fixed rates.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" onClick={() => onChange({ ...preferences, showConverted: !preferences.showConverted })}>
            <Coins size={15} /> {preferences.showConverted ? "Hide converted totals" : "Show converted totals"}
          </button>
        </div>
      </div>

      <div className="account-overview-strip">
        <div><span>ACCOUNTS</span><strong>{accounts.length.toLocaleString("en-NG")}</strong><small>Across imported and manual activity</small></div>
        <div><span>NATIVE CURRENCIES</span><strong>{currencies.length.toLocaleString("en-NG")}</strong><small>{currencies.join(" · ") || "No activity yet"}</small></div>
        <div><span>CONVERTED NET</span><strong>{preferences.showConverted && allConverted ? formatCurrency(totalNet, preferences.displayCurrency) : "—"}</strong><small>{preferences.showConverted ? allConverted ? "Using your manual rates" : `${accounts.length - convertedKnown} account rate${accounts.length - convertedKnown === 1 ? "" : "s"} still needed` : "Turn on converted totals to compare"}</small></div>
      </div>

      <section className="panel account-display-settings">
        <div className="account-settings-title"><Settings2 size={17} /><div><strong>Display settings</strong><span>Rates are manual and stay in this browser. They are not live market rates.</span></div></div>
        <label>Display currency
          <select value={preferences.displayCurrency} onChange={(event) => onChange({ ...preferences, displayCurrency: event.target.value })}>
            {supportedCurrencies.map((currency) => <option key={currency}>{currency}</option>)}
          </select>
        </label>
        <label className="account-convert-toggle"><input type="checkbox" checked={preferences.showConverted} onChange={(event) => onChange({ ...preferences, showConverted: event.target.checked })} /> Show equivalents</label>
      </section>

      <section className="panel accounts-directory">
        <div className="panel-heading">
          <div><div className="panel-kicker">ACCOUNT DIRECTORY</div><h2>Native balances from recorded activity</h2></div>
          <span className="heading-note"><Eye size={14} /> Own-account transfers excluded</span>
        </div>
        <p className="panel-note">Net means money in minus money out in your saved history; it is not a live bank balance. Existing dashboard reports remain in NGN.</p>
        {accounts.length ? (
          <div className="account-list">
            <div className="account-list-header"><span>ACCOUNT</span><span>MONEY IN</span><span>MONEY OUT</span><span>NET ACTIVITY</span><span>RATE & ACTIONS</span></div>
            {accounts.map((account) => {
              const convertedNet = convertAccountAmount(account.net, account.currency, preferences);
              const needsRate = account.currency !== preferences.displayCurrency;
              return (
                <article className="account-row" key={account.name}>
                  <div className="account-identity">
                    <span className="account-monogram">{account.name.slice(0, 1).toUpperCase()}</span>
                    <div><strong title={account.name}>{account.name}</strong><span>{account.count.toLocaleString("en-NG")} transactions{account.latestDate ? ` · latest ${formatDate(account.latestDate)}` : ""}</span></div>
                    <select aria-label={`Currency for ${account.name}`} value={accountCurrency(account.name, preferences)} onChange={(event) => setCurrency(account.name, event.target.value)}>
                      {supportedCurrencies.map((currency) => <option key={currency}>{currency}</option>)}
                    </select>
                  </div>
                  <div className="account-money"><span>Money in</span><strong className="text-positive">+{formatCurrency(account.income, account.currency)}</strong></div>
                  <div className="account-money"><span>Money out</span><strong>−{formatCurrency(account.expenses, account.currency)}</strong></div>
                  <div className="account-money account-net"><span>Net activity</span><strong>{formatCurrency(account.net, account.currency)}</strong>{preferences.showConverted && <small>{needsRate ? convertedNet === null ? "Rate needed" : `≈ ${formatCurrency(convertedNet, preferences.displayCurrency)}` : "Native display currency"}</small>}</div>
                  <div className="account-row-actions">
                    {preferences.showConverted && needsRate && <label>1 {account.currency} = <input type="number" min="0.000001" step="any" value={preferences.rates[account.currency] ?? ""} onChange={(event) => setRate(account.currency, event.target.value)} placeholder="Rate" aria-label={`Manual ${account.currency} to ${preferences.displayCurrency} rate`} /> {preferences.displayCurrency}</label>}
                    <button className="button button-text" onClick={() => onOpenAccount(account.name)}>View activity <ArrowUpRight size={13} /></button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="feature-empty"><Landmark size={24} /><strong>No accounts yet</strong><span>Import statements or add a manual transaction to build your account view.</span></div>
        )}
      </section>

      <div className="account-footnote"><ArrowLeftRight size={15} /><span>Changing an account currency changes its display label, not the imported amounts. Only choose the currency the statement actually uses.</span></div>
    </section>
  );
}
