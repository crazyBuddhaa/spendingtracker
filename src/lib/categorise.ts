import type { Category, CategoryRule, Direction, Transaction } from "../types.ts";

/**
 * Ordered keyword rules. The first matching rule wins, so specific patterns
 * (fees, levies, betting) come before broad ones (transfers, shopping).
 */
const keywordRules: Array<{ category: Category; pattern: RegExp; direction?: Direction }> = [
  { category: "Income", pattern: /\b(?:owealth )?interest earned\b|\brefer friends\b|\breferral bonus\b|\bcashback\b/ },
  { category: "Refunds", pattern: /^(?:refund|reversal)\b|\breversal\b|\brefund\b/, direction: "income" },
  {
    category: "Bank fees",
    pattern: /\b(?:ussd charge|vat on transfer fee|transfer fee|bank charges?|service charge|stamp duty|electronic money transfer levy|emt levy|sms (?:alert|subscription|charge)|redemption fee|maintenance fee|card fee|commission)\b/,
  },
  {
    category: "Betting",
    pattern: /[|@]\s*footbal|\bfootball\s*internet\b|\b(?:betting|sportybet|sporty\s*bet|footballing|football\.com|msport|one_?xbet|1xbet|betano|bet9ja|betlion|betking|paripesa|bangbet|surebet|betwinner|betway|nairabet|merrybet|ilot)\b/,
  },
  { category: "Airtime & data", pattern: /\b(?:airtime|mobile data|data bundle|data plan|recharge)\b/ },
  {
    category: "Bills & utilities",
    pattern: /\b(?:remita|lirs|firs|tax|levy payment|electric(?:ity)?|ikedc|ekedc|aedc|phed|ibedc|prepaid meter|power|water|internet|wifi|spectranet|smile|dstv|gotv|startimes|multichoice|showmax|cable|utility)\b|^tv\b/,
  },
  { category: "Education", pattern: /\b(?:waec|neco|jamb|school|tuition|course|udemy|coursera|education|books?|exam)\b/ },
  { category: "Health", pattern: /\b(?:pharmacy|hospital|clinic|health|medical|doctor|lab test|hmo)\b/ },
  { category: "Transport", pattern: /\b(?:uber|bolt|indrive|taxi|bus|brt|transport|fuel|petrol|diesel|filling station|parking|ride|logistics)\b/ },
  {
    category: "Food & groceries",
    pattern: /\b(?:grocery|groceries|provision|market|food|foods|restaurant|cafe|kitchen|supermarket|shoprite|spar|eatery|chicken republic|chicken|mcdonald|kfc|domino|bakery|chowdeck|glovo)\b/,
  },
  { category: "Rent & housing", pattern: /\b(?:rent|landlord|estate dues|service charge|caretaker|agent fee)\b/ },
  { category: "Entertainment", pattern: /\b(?:netflix|spotify|apple music|youtube|cinema|movie|game|gaming|concert|entertainment|boomplay|audiomack)\b/ },
  { category: "Cash withdrawal", pattern: /\b(?:atm withdrawal|cash withdrawal|pos withdrawal)\b|\bpos\b(?!.*\b(?:purchase|payment)\b)/ },
  {
    category: "Shopping",
    pattern: /\b(?:shop|store|stores|boutique|clothing|fashion|amazon|jumia|konga|aliexpress|temu|purchase|merchant|card payment|paystack|flutterwave|flw|coralpay|qpay|checkout|voucher|super voucher)\b/,
  },
];

/**
 * OPay moves money between the wallet and its own savings products
 * (OWealth, Spend & Save, Targets, Fixed). These are the customer's own money
 * and must not count as income or spending.
 */
export function isWalletProductMovement(description: string): boolean {
  const text = description.toLowerCase();
  if (/\binterest earned\b|\bredemption fee\b|\bfee\b/.test(text)) return false;
  return (
    /\bowealth\b/.test(text) ||
    /\bauto-?save to owealth\b/.test(text) ||
    /\bspend\s*&\s*save\b/.test(text) ||
    /^targets? (?:deposit|payout|withdrawal|redemption)\b/.test(text) ||
    /\bfixed (?:deposit|savings) (?:deposit|payout|withdrawal)\b/.test(text) ||
    /\bsafebox\b/.test(text)
  );
}

export function categorise(description: string, direction: Direction): Category {
  const text = description.toLowerCase();
  if (isWalletProductMovement(text)) return "Transfers";
  for (const rule of keywordRules) {
    if (rule.direction && rule.direction !== direction) continue;
    if (rule.pattern.test(text)) {
      // A shop that sends you money is income, not shopping.
      if (direction === "income" && !["Income", "Refunds", "Betting"].includes(rule.category)) break;
      return rule.category;
    }
  }
  if (direction === "income") return "Income";
  if (/\b(?:transfer|trf|xfer|internal transfer|own account)\b/.test(text)) return "Transfers";
  return "Other";
}

/** A short, stable key for "transactions like this one". */
export function similarityKey(description: string): string {
  const first = description.split("|")[0] ?? description;
  return first
    .toLowerCase()
    .replace(/\(.*?\)/g, (match) => (/(easemoni|transaction|from|refund)/.test(match) ? match : ""))
    .replace(/\d{4,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ruleMatches(rule: CategoryRule, transaction: Pick<Transaction, "description" | "direction">): boolean {
  if (rule.direction && rule.direction !== transaction.direction) return false;
  const pattern = rule.pattern.trim().toLowerCase();
  if (!pattern) return false;
  const description = transaction.description.toLowerCase().replace(/\s+/g, " ");
  return description.includes(pattern) || similarityKey(transaction.description).includes(pattern);
}

/**
 * Re-runs automatic categorisation on imported transactions (e.g. after an app update
 * improves the rules). Categories the user picked by hand and manual entries are kept,
 * as are internal-transfer and own-account flags already on a transaction.
 */
export function refreshCategories(transactions: Transaction[], rules: CategoryRule[]): { transactions: Transaction[]; changed: number } {
  let changed = 0;
  const refreshed = transactions.map((transaction) => {
    if (transaction.manual || transaction.categoryLocked) return transaction;
    const next: Transaction = { ...transaction };
    if (isWalletProductMovement(transaction.description)) {
      next.category = "Transfers";
      next.internalTransfer = true;
      next.ownAccountCandidate = false;
    } else if (transaction.internalTransfer || transaction.ownAccountCandidate) {
      next.category = "Transfers";
    } else {
      next.category = categorise(transaction.description, transaction.direction);
    }
    return next;
  });
  const withRules = applyCategoryRules(refreshed, rules);
  for (let index = 0; index < transactions.length; index += 1) {
    const before = transactions[index];
    const after = withRules[index];
    if (before.category !== after.category || Boolean(before.internalTransfer) !== Boolean(after.internalTransfer)) changed += 1;
  }
  return { transactions: withRules, changed };
}

/**
 * Applies the user's rules to transactions whose category has not been set by hand.
 * Later rules win over earlier ones, so a new rule can refine an older one.
 */
export function applyCategoryRules(transactions: Transaction[], rules: CategoryRule[]): Transaction[] {
  if (!rules.length) return transactions;
  return transactions.map((transaction) => {
    if (transaction.categoryLocked) return transaction;
    let next: Transaction | null = null;
    for (const rule of rules) {
      if (!ruleMatches(rule, transaction)) continue;
      next = { ...(next ?? transaction), category: rule.category };
      if (rule.markInternal) {
        next.internalTransfer = true;
        next.ownAccountCandidate = false;
      }
    }
    return next ?? transaction;
  });
}

/** Wallet and savings-app names that appear around a person's name in transfer lines. */
const platformTokens = new Set([
  "palmpay", "piggyvest", "pocketapp", "cowrywise", "risevest", "kuda", "opay", "moniepoint", "sub2me",
  "paystack", "flw", "transfer", "pos", "ltd", "limited",
]);

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, (match) => ` ${match.slice(1, -1)} `)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !platformTokens.has(token) && !/\d/.test(token));
}

/**
 * True when a "Transfer to/from NAME | bank | account" line names the account holder
 * (all of the counterparty's names appear in the holder's name, at least two of them)
 * or quotes the holder's own account number, or is a top-up from the holder's own card.
 */
export function isOwnAccountTransfer(description: string, accountHolderName?: string, accountNumber?: string): boolean {
  const text = description.trim();
  if (/^add money\b/i.test(text)) return Boolean(accountHolderName || accountNumber);
  const match = text.match(/^transfer\s+(?:to|from)\s+([^|]+)(.*)$/i);
  if (!match) return false;
  const [, counterparty, rest] = match;
  const digits = (accountNumber ?? "").replace(/\D/g, "");
  if (digits.length >= 8 && rest.replace(/\D/g, " ").split(/\s+/).some((part) => part === digits || part === `0${digits}`)) {
    return true;
  }
  if (!accountHolderName) return false;
  const holder = new Set(nameTokens(accountHolderName));
  const other = nameTokens(counterparty);
  if (other.length < 2 || holder.size < 2) return false;
  return other.every((token) => holder.has(token));
}
