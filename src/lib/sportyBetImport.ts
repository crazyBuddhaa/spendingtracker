import type { BetCategory, BetImportResult, BetRecord, BetStatus } from "../types.ts";
import { betCategories } from "../types.ts";

function decodeQuotedPrintable(value: string): string {
  const source = value.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < source.length;) {
    if (source[index] === "=" && /^[\da-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
      index += 3;
    } else {
      const codePoint = source.codePointAt(index)!;
      const character = String.fromCodePoint(codePoint);
      bytes.push(...encoder.encode(character));
      index += character.length;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function extractHtmlPart(source: string): string {
  const boundaryMatch = source.match(/boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\r\n]+))/i);
  if (!boundaryMatch) return source;
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2] ?? boundaryMatch[3] ?? "").trim();
  if (!boundary) return source;

  const sections = source.split(`--${boundary}`);
  const htmlSection = sections.find((section) => /^Content-Type:\s*text\/html\b/im.test(section));
  if (!htmlSection) return source;
  const separator = htmlSection.search(/\r?\n\r?\n/);
  if (separator < 0) return "";
  const header = htmlSection.slice(0, separator);
  const body = htmlSection.slice(separator).replace(/^\r?\n\r?\n/, "");
  const encoding = header.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase();
  if (encoding === "base64") return decodeBase64(body);
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const code = entity[1]?.toLowerCase() === "x"
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

interface BetCard {
  dataOp: string;
  textParts: string[];
}

function extractCardBlocks(html: string): BetCard[] {
  const starts = /<div\b(?=[^>]*\bdata-op\s*=\s*["'](bet-history-card-[^"']+)["'])[^>]*>/gi;
  const cards: BetCard[] = [];
  let startMatch: RegExpExecArray | null;

  while ((startMatch = starts.exec(html))) {
    const dataOp = startMatch[1];
    const divTags = /<\/?div\b[^>]*>/gi;
    divTags.lastIndex = starts.lastIndex;
    let depth = 1;
    let end = -1;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = divTags.exec(html))) {
      if (/^<\/div/i.test(tagMatch[0])) depth -= 1;
      else if (!/\/\s*>$/.test(tagMatch[0])) depth += 1;
      if (depth === 0) {
        end = divTags.lastIndex;
        break;
      }
    }
    if (end < 0) break;

    const block = html.slice(startMatch.index, end)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, "\n");
    const textParts = decodeEntities(block)
      .split(/\r?\n/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    cards.push({ dataOp, textParts });
    starts.lastIndex = end;
  }

  return cards;
}

function parseDate(dataOp: string, parts: string[]): string | null {
  const fromId = dataOp.match(/bet-history-card-(\d{6})/i)?.[1];
  if (fromId) {
    const year = 2000 + Number(fromId.slice(0, 2));
    const month = Number(fromId.slice(2, 4));
    const day = Number(fromId.slice(4, 6));
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
    october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  // Some saved pages open cards with a full "dd/mm/yyyy" date instead of
  // "12 Oct" + header rows; read it directly when present.
  const fullDate = parts.find((part) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(part));
  const isoDate = parts.find((part) => /^\d{4}-\d{2}-\d{2}/.test(part));
  if (fullDate && !months[(parts[1] ?? "").toLowerCase()]) {
    const [day, month, year] = fullDate.split("/").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  } else if (isoDate) {
    const [, month, day] = isoDate.split("-").map(Number);
    if (Number.isInteger(month) && Number.isInteger(day)) {
      return `${isoDate.slice(0, 4)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const day = Number(parts[0]);
  const month = months[(parts[1] ?? "").toLowerCase()];
  if (!Number.isInteger(day) || !month) return null;
  const pageDate = parts.find((part) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(part));
  const fromIso = parts.find((part) => /^\d{4}-\d{2}-\d{2}/.test(part));
  const year = pageDate
    ? Number(pageDate.split("/")[2])
    : fromIso
      ? Number(fromIso.slice(0, 4))
      : new Date().getFullYear();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const normalised = value.replace(/NGN|₦|,/gi, "").replace(/\s/g, "").trim();
  const amount = Number(normalised);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function parseStatus(parts: string[]): BetStatus {
  for (const part of parts.slice(2, 12)) {
    const value = part.toLowerCase().replace(/[\s_-]+/g, " ").trim();
    if (/\b(cash out|cashout|cashed out)\b/.test(value)) return "cashed-out";
    if (/\b(won|win|winner)\b/.test(value)) return "won";
    if (/\b(lost|lose|loss)\b/.test(value)) return "lost";
    if (/\b(void|refunded|refund)\b/.test(value)) return "void";
    if (/\b(open|pending|active|unsettled)\b/.test(value)) return "open";
  }
  return "other";
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function betFromCard(card: BetCard): BetRecord | null {
  const date = parseDate(card.dataOp, card.textParts);
  // Label words differ between saved pages ("Total stake" most commonly, plain
  // "Stake" on compact layouts); match either so single-stake cards survive.
  const stakeIndex = card.textParts.findIndex((part) => /^(total stake|stake)\b/i.test(part));
  const returnIndex = card.textParts.findIndex((part) => /^(total return|potential return|payout|total payout|winnings)\b/i.test(part));
  const stake = parseAmount(card.textParts[stakeIndex + 1]);
  const returnAmount = returnIndex >= 0 ? parseAmount(card.textParts[returnIndex + 1]) : 0;
  if (!date || stakeIndex < 0 || stake === null || returnAmount === null) return null;

  const betType = card.textParts.slice(2, stakeIndex).find((part) =>
    /^(single|multiple|system|combo|accumulator|bet builder)$/i.test(part),
  ) ?? "Other";
  const eventsSource = returnIndex >= 0 ? card.textParts.slice(returnIndex + 2) : card.textParts.slice(stakeIndex + 2);
  const events = eventsSource.filter((part) => /\s(?:v|vs\.?)\s/i.test(part));
  const hiddenEvents = Number(card.textParts.join(" ").match(/\band\s+(\d+)\s+other matches?\b/i)?.[1] ?? 0);
  const status = parseStatus(card.textParts);

  return {
    id: `sportybet-${stableHash(card.dataOp)}`,
    date,
    category: "Unclassified",
    betType,
    status,
    stake,
    returnAmount,
    events,
    hiddenEvents: Number.isFinite(hiddenEvents) ? hiddenEvents : 0,
    source: "SportyBet",
  };
}

export function parseSportyBetPage(source: string): BetImportResult {
  const html = extractHtmlPart(source);
  const cards = extractCardBlocks(html);
  if (cards.length === 0) {
    return {
      bets: [],
      warnings: ["No SportyBet bet-history cards were found. Choose a saved SportyBet page (.mhtml, .mht, or .html)."],
    };
  }

  const bets = cards.flatMap((card) => {
    const bet = betFromCard(card);
    return bet ? [bet] : [];
  });
  const skipped = cards.length - bets.length;
  return {
    bets,
    warnings: skipped
      ? [`${skipped} of ${cards.length} cards did not include a readable date, stake, and return and were skipped.`]
      : [],
  };
}

export function normaliseBets(value: unknown): BetRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): BetRecord[] => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.date !== "string" ||
      typeof entry.category !== "string" ||
      typeof entry.betType !== "string" ||
      typeof entry.status !== "string" ||
      typeof entry.stake !== "number" ||
      !Number.isFinite(entry.stake) ||
      entry.stake < 0 ||
      typeof entry.returnAmount !== "number" ||
      !Number.isFinite(entry.returnAmount) ||
      entry.returnAmount < 0 ||
      !Array.isArray(entry.events) ||
      typeof entry.source !== "string"
    ) {
      return [];
    }
    const category = (betCategories as readonly string[]).includes(entry.category)
      ? entry.category as BetCategory
      : "Unclassified";
    const statuses: BetStatus[] = ["won", "lost", "open", "void", "cashed-out", "other"];
    const status = statuses.includes(entry.status as BetStatus) ? entry.status as BetStatus : "other";
    return [{
      id: entry.id,
      date: entry.date,
      category,
      betType: entry.betType.slice(0, 40),
      status,
      stake: entry.stake,
      returnAmount: entry.returnAmount,
      events: entry.events.filter((event: unknown): event is string => typeof event === "string").slice(0, 100),
      hiddenEvents: Number.isInteger(entry.hiddenEvents) && entry.hiddenEvents > 0 ? entry.hiddenEvents : 0,
      source: entry.source.slice(0, 80),
    }];
  });
}
