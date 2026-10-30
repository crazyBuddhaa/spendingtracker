/**
 * Shared bookmaker/operator recognition. Used by the betting importer (to label
 * sources), the correlation engine (to align bank rows with bet rows), and the
 * financial indicators. Names are detected on alphanumeric-only text; add new
 * bookmakers here rather than at every call site.
 */

const OPERATORS: Array<[string, string[]]> = [
  ["SportyBet", ["sportybet", "sporty"]],
  ["Bet9ja", ["bet9ja"]],
  ["BetKing", ["betking"]],
  ["MSport", ["msport"]],
  ["1XBET", ["1xbet", "onexbet"]],
  ["Betway", ["betway"]],
  ["Betano", ["betano"]],
  ["Paripesa", ["paripesa"]],
  ["BetLion", ["betlion"]],
  ["BangBet", ["bangbet"]],
  ["SureBet", ["surebet"]],
  ["Betwinner", ["betwinner"]],
  ["iLot", ["ilot"]],
  ["NairaBet", ["nairabet"]],
  ["NaijaBet", ["naijabet"]],
  ["LuckyBet", ["luckybet"]],
  ["MozzartBet", ["mozzartbet", "mozzart"]],
  ["Melbet", ["melbet"]],
  ["BetPawa", ["betpawa"]],
  ["Footballing", ["footballing", "footballinternet", "football.com"]],
];

/** Canonical bookmaker name from free text, or null when none is recognised. */
export function operatorFromText(value: string): string | null {
  const text = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!text) return null;
  return OPERATORS.find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0] ?? null;
}
