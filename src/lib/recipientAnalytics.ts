import type { RecipientProfile, Transaction } from "../types.ts";
import { resolveTransactionParty } from "./recipientProfiles.ts";

export interface TypicalFareRange {
  key: string;
  name: string;
  count: number;
  medianAmount: number;
  lowerAmount: number;
  upperAmount: number;
  lastDate: string;
}

/** Returns an interpolated percentile for an already sorted, non-empty list. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Estimate ordinary Transport spend bands from observed payments. Route data is not
 * present in statements, so this intentionally reports a payee-level historical range.
 */
export function detectTypicalFareRanges(
  transactions: Transaction[],
  profiles: RecipientProfile[] = [],
): TypicalFareRange[] {
  const groups = new Map<string, { name: string; amounts: number[]; lastDate: string }>();
  for (const transaction of transactions) {
    if (transaction.direction !== "expense" || transaction.internalTransfer || transaction.ownAccountCandidate || transaction.category !== "Transport") continue;
    const party = resolveTransactionParty(transaction.description, profiles);
    if (!party || !Number.isFinite(transaction.amount) || transaction.amount <= 0) continue;
    const group = groups.get(party.key) ?? { name: party.name, amounts: [], lastDate: "" };
    group.amounts.push(transaction.amount);
    if (transaction.date > group.lastDate) group.lastDate = transaction.date;
    groups.set(party.key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.amounts.length >= 3)
    .map(([key, group]) => {
      const sorted = [...group.amounts].sort((a, b) => a - b);
      return {
        key,
        name: group.name,
        count: sorted.length,
        medianAmount: roundAmount(percentile(sorted, 0.5)),
        lowerAmount: roundAmount(percentile(sorted, 0.2)),
        upperAmount: roundAmount(percentile(sorted, 0.8)),
        lastDate: group.lastDate,
      };
    })
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}

export interface TimeBasedRecipientPattern {
  key: string;
  name: string;
  count: number;
  days: number;
  typicalTime: string;
  windowMinutes: number;
  lastDate: string;
  transactionIds: string[];
}

export interface PossibleJourneyPair {
  key: string;
  firstRecipient: string;
  secondRecipient: string;
  count: number;
  days: number;
  typicalGapMinutes: number;
  lastDate: string;
  transactionIds: string[];
}

export interface MultiRecipientJourney {
  key: string;
  recipients: string[];
  count: number;
  days: number;
  typicalDurationMinutes: number;
  lastDate: string;
  transactionIds: string[];
}

interface TimedRecipientEvent {
  date: string;
  minute: number;
  key: string;
  name: string;
  transactionId: string;
}

interface JourneyStop {
  key: string;
  name: string;
  firstMinute: number;
  minute: number;
  transactionIds: string[];
}

interface JourneyEpisode {
  date: string;
  stops: JourneyStop[];
}

const MINUTES_PER_DAY = 24 * 60;
const RECIPIENT_PATTERN_WINDOW_MINUTES = 60;
const JOURNEY_MAX_GAP_MINUTES = 90;
const JOURNEY_MAX_DURATION_MINUTES = 240;

function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

function minuteOfDay(time: string | undefined): number | null {
  const match = time?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function timeLabel(minute: number): string {
  const rounded = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function circularDistance(first: number, second: number): number {
  return Math.abs((((first - second) % MINUTES_PER_DAY) + MINUTES_PER_DAY * 1.5) % MINUTES_PER_DAY - MINUTES_PER_DAY / 2);
}

function timedRecipientEvents(
  transactions: Transaction[],
  profiles: RecipientProfile[],
): TimedRecipientEvent[] {
  const events: TimedRecipientEvent[] = [];
  for (const transaction of transactions) {
    if (
      transaction.direction !== "expense" ||
      transaction.internalTransfer ||
      transaction.ownAccountCandidate ||
      !isValidIsoDate(transaction.date)
    ) continue;
    const minute = minuteOfDay(transaction.time);
    if (minute === null) continue;
    const party = resolveTransactionParty(transaction.description, profiles);
    if (!party || party.kind !== "recipient") continue;
    events.push({
      date: transaction.date,
      minute,
      key: party.key,
      name: party.name,
      transactionId: transaction.id,
    });
  }
  return events;
}

/**
 * Find recipients paid at a similar time on multiple dates. These are timing
 * patterns only; they never modify categories or transaction records.
 */
export function detectTimeBasedRecipientPatterns(
  transactions: Transaction[],
  profiles: RecipientProfile[] = [],
): TimeBasedRecipientPattern[] {
  const groups = new Map<string, TimedRecipientEvent[]>();
  for (const event of timedRecipientEvents(transactions, profiles)) {
    const group = groups.get(event.key) ?? [];
    group.push(event);
    groups.set(event.key, group);
  }

  const patterns: TimeBasedRecipientPattern[] = [];
  for (const [key, events] of groups) {
    if (events.length < 3) continue;
    const radians = events.map((event) => event.minute * 2 * Math.PI / MINUTES_PER_DAY);
    const x = radians.reduce((sum, angle) => sum + Math.cos(angle), 0);
    const y = radians.reduce((sum, angle) => sum + Math.sin(angle), 0);
    if (Math.hypot(x, y) / events.length < 0.2) continue;
    const center = (Math.atan2(y, x) * MINUTES_PER_DAY / (2 * Math.PI) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const matching = events.filter((event) => circularDistance(event.minute, center) <= RECIPIENT_PATTERN_WINDOW_MINUTES);
    const days = new Set(matching.map((event) => event.date));
    if (matching.length < 3 || matching.length / events.length < 0.7 || days.size < 2) continue;
    patterns.push({
      key,
      name: matching.at(-1)!.name,
      count: matching.length,
      days: days.size,
      typicalTime: timeLabel(center),
      windowMinutes: RECIPIENT_PATTERN_WINDOW_MINUTES,
      lastDate: matching.reduce((last, event) => event.date > last ? event.date : last, ""),
      transactionIds: matching.map((event) => event.transactionId),
    });
  }
  return patterns.sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}

function buildJourneyEpisodes(events: TimedRecipientEvent[]): JourneyEpisode[] {
  const byDate = new Map<string, TimedRecipientEvent[]>();
  for (const event of events) {
    const day = byDate.get(event.date) ?? [];
    day.push(event);
    byDate.set(event.date, day);
  }

  const episodes: JourneyEpisode[] = [];
  for (const [date, dayEvents] of byDate) {
    dayEvents.sort((a, b) => a.minute - b.minute || a.transactionId.localeCompare(b.transactionId));
    let stops: JourneyStop[] = [];
    const finish = () => {
      if (stops.length >= 2) episodes.push({ date, stops });
      stops = [];
    };
    for (const event of dayEvents) {
      const first = stops[0];
      const previous = stops.at(-1);
      if (
        !previous ||
        event.minute - previous.minute > JOURNEY_MAX_GAP_MINUTES ||
        event.minute - first.firstMinute > JOURNEY_MAX_DURATION_MINUTES
      ) {
        finish();
        stops = [{
          key: event.key,
          name: event.name,
          firstMinute: event.minute,
          minute: event.minute,
          transactionIds: [event.transactionId],
        }];
      } else if (previous.key === event.key) {
        previous.minute = event.minute;
        previous.transactionIds.push(event.transactionId);
      } else {
        stops.push({
          key: event.key,
          name: event.name,
          firstMinute: event.minute,
          minute: event.minute,
          transactionIds: [event.transactionId],
        });
      }
    }
    finish();
  }
  return episodes;
}

/**
 * Detect repeated, ordered pairs of different recipients paid within one
 * short same-day episode. A result needs to recur on at least two dates.
 */
export function detectPossibleJourneyPairs(
  transactions: Transaction[],
  profiles: RecipientProfile[] = [],
): PossibleJourneyPair[] {
  const groups = new Map<string, {
    firstRecipient: string;
    secondRecipient: string;
    byDate: Map<string, { gap: number; transactionIds: string[] }>;
  }>();
  for (const episode of buildJourneyEpisodes(timedRecipientEvents(transactions, profiles))) {
    for (let index = 1; index < episode.stops.length; index += 1) {
      const first = episode.stops[index - 1];
      const second = episode.stops[index];
      if (first.key === second.key) continue;
      const key = JSON.stringify([first.key, second.key]);
      const group = groups.get(key) ?? {
        firstRecipient: first.name,
        secondRecipient: second.name,
        byDate: new Map(),
      };
      if (!group.byDate.has(episode.date)) {
        group.byDate.set(episode.date, {
          gap: second.minute - first.minute,
          transactionIds: [...first.transactionIds, ...second.transactionIds],
        });
      }
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .filter(([, group]) => group.byDate.size >= 2)
    .map(([key, group]) => {
      const dates = [...group.byDate.keys()].sort();
      return {
        key,
        firstRecipient: group.firstRecipient,
        secondRecipient: group.secondRecipient,
        count: dates.length,
        days: dates.length,
        typicalGapMinutes: Math.round(median([...group.byDate.values()].map((item) => item.gap))),
        lastDate: dates.at(-1)!,
        transactionIds: [...new Set([...group.byDate.values()].flatMap((item) => item.transactionIds))],
      };
    })
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.firstRecipient.localeCompare(b.firstRecipient));
}

/**
 * Find recurring ordered sequences of three or more distinct recipients paid
 * in a short same-day episode. Location and route are not available in statements.
 */
export function detectMultiRecipientJourneys(
  transactions: Transaction[],
  profiles: RecipientProfile[] = [],
): MultiRecipientJourney[] {
  const groups = new Map<string, {
    recipients: string[];
    byDate: Map<string, { duration: number; transactionIds: string[] }>;
  }>();
  for (const episode of buildJourneyEpisodes(timedRecipientEvents(transactions, profiles))) {
    if (episode.stops.length < 3 || new Set(episode.stops.map((stop) => stop.key)).size < 3) continue;
    const key = JSON.stringify(episode.stops.map((stop) => stop.key));
    const group = groups.get(key) ?? {
      recipients: episode.stops.map((stop) => stop.name),
      byDate: new Map(),
    };
    if (!group.byDate.has(episode.date)) {
      group.byDate.set(episode.date, {
        duration: episode.stops.at(-1)!.minute - episode.stops[0].firstMinute,
        transactionIds: episode.stops.flatMap((stop) => stop.transactionIds),
      });
    }
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.byDate.size >= 2)
    .map(([key, group]) => {
      const dates = [...group.byDate.keys()].sort();
      return {
        key,
        recipients: group.recipients,
        count: dates.length,
        days: dates.length,
        typicalDurationMinutes: Math.round(median([...group.byDate.values()].map((item) => item.duration))),
        lastDate: dates.at(-1)!,
        transactionIds: [...new Set([...group.byDate.values()].flatMap((item) => item.transactionIds))],
      };
    })
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.recipients.join(" → ").localeCompare(b.recipients.join(" → ")));
}

