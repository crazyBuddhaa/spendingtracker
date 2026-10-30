import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBetPaymentMatches, summariseBettingCorrelation } from "./bettingCorrelation.ts";
import { linkKey, normaliseBettingLinks } from "./bettingLinks.ts";

function tx(overrides = {}) {
  return {
    id: overrides.id ?? `tx-${Math.random().toString(36).slice(2)}`,
    date: "2026-10-01",
    description: "Betting | REF | SPORTYBET",
    amount: 2500,
    direction: "expense",
    category: "Betting",
    source: "opay.csv",
    ...overrides,
  };
}

function bet(overrides = {}) {
  return {
    id: overrides.id ?? `bet-${Math.random().toString(36).slice(2)}`,
    date: "2026-10-01",
    category: "Football",
    betType: "Single",
    status: "lost",
    stake: 2500,
    returnAmount: 0,
    events: ["Example match"],
    hiddenEvents: 0,
    source: "SportyBet",
    ...overrides,
  };
}

describe("findBetPaymentMatches", () => {
  it("pairs a stake when date, operator, and amount all agree", () => {
    const matches = findBetPaymentMatches([tx()], [bet()]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].side, "stake");
    assert.equal(matches[0].method, "exact");
    assert.equal(matches[0].dateDeltaDays, 0);
    assert.equal(matches[0].operator, "SportyBet");
  });

  it("allows a posting-window stake with a shifted date", () => {
    const matches = findBetPaymentMatches(
      [tx({ date: "2026-10-03" })],
      [bet({ date: "2026-10-02" })],
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].method, "operator-window");
    assert.equal(matches[0].dateDeltaDays, 1);
  });

  it("falls back to date-amount when the bank row names no operator", () => {
    const matches = findBetPaymentMatches(
      [tx({ description: "Betting | 8140000000" })],
      [bet()],
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].method, "date-amount");
    assert.equal(matches[0].operator, "SportyBet", "the bet side still names the bookmaker");
  });

  it("rejects rows whose named operators disagree", () => {
    const matches = findBetPaymentMatches([tx({ description: "Bet | REF | BET9JA" })], [bet()]);
    assert.deepEqual(matches, []);
  });

  it("skips ambiguous equal stakes instead of guessing", () => {
    const duplicates = [bet(), bet({ id: "bet-2" })];
    assert.deepEqual(findBetPaymentMatches([tx()], duplicates), []);
    const farBet = bet({ date: "2026-10-20" });
    assert.equal(findBetPaymentMatches([tx()], [bet(), farBet]).length, 1);
  });

  it("uses each bank row at most once per call", () => {
    const matches = findBetPaymentMatches(
      [tx({ date: "2026-10-05", amount: 1000 })],
      [bet({ date: "2026-10-03", stake: 1000 }), bet({ date: "2026-10-07", stake: 1000 })],
      { stakeWindowDays: 3 },
    );
    assert.equal(matches.length, 0, "two equally valid bets make the row ambiguous");
  });

  it("matches winnings credits to the bet return, including next-day postings", () => {
    const wonBet = bet({ status: "won", returnAmount: 8500, stake: 5000 });
    const credit = tx({
      id: "credit-1",
      date: "2026-10-02",
      direction: "income",
      category: "Other",
      description: "Transfer from SPORTYBET | winnings",
      amount: 8500,
    });
    const matches = findBetPaymentMatches([credit], [wonBet]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].side, "return");
    assert.equal(matches[0].method, "operator-window");
    assert.equal(matches[0].dateDeltaDays, 1);
  });

  it("ignores transfers to self and other noise", () => {
    assert.deepEqual(findBetPaymentMatches([tx({ internalTransfer: true })], [bet()]), []);
    assert.deepEqual(findBetPaymentMatches([tx({ ownAccountCandidate: true })], [bet()]), []);
    assert.deepEqual(findBetPaymentMatches([tx({ category: "Shopping", description: "Woolworths" })], [bet()]), []);
  });
});

describe("summariseBettingCorrelation", () => {
  const stake1 = tx({ id: "s1", date: "2026-10-01", amount: 2500 });
  const stake2 = tx({ id: "s2", date: "2026-10-02", amount: 1000 });
  const credit = tx({
    id: "c1", date: "2026-10-02", amount: 4000, direction: "income",
    description: "SPORTYBET winnings payout",
  });

  it("reports coverage from confirmed links on both sides", () => {
    const summary = summariseBettingCorrelation(
      [stake1, stake2, credit],
      [
        bet({ id: "b1", stake: 2500 }),
        bet({ id: "b2", date: "2026-10-05", stake: 700, returnAmount: 4000 }),
      ],
      [
        { id: "l1", betId: "b1", transactionId: "s1", side: "stake", method: "exact", amount: 2500, date: "2026-10-01", linkedOn: "2026-10-30" },
        { id: "l2", betId: "b2", transactionId: "c1", side: "return", method: "operator-window", amount: 4000, date: "2026-10-02", linkedOn: "2026-10-30" },
      ],
    );
    assert.equal(summary.bankStakes.total, 3500);
    assert.equal(summary.linkedStakes.total, 2500);
    assert.equal(summary.bankStakeCoverage, 71.4);
    assert.equal(summary.ledgerStakes.total, 3200);
    assert.equal(summary.ledgerStakeCoverage, 78.1);
    assert.equal(summary.unmatchedBankStakeTotal, 1000);
    assert.equal(summary.bankReturns.total, 4000);
    assert.equal(summary.bankReturnCoverage, 100);
    assert.equal(summary.ledgerReturns.total, 4000);
    assert.equal(summary.unmatchedLedgerReturnTotal, 0);
  });

  it("stays empty and silent with no data or links", () => {
    const summary = summariseBettingCorrelation([], [], []);
    assert.equal(summary.bankStakes.total, 0);
    assert.equal(summary.linkedStakes.count, 0);
    assert.equal(summary.bankStakeCoverage, null);
    assert.equal(summary.unmatchedBankStakeTotal, 0);
    assert.equal(summary.unmatchedLedgerReturnTotal, 0);
  });
});

describe("normaliseBettingLinks", () => {
  it("keeps links and drops broken rows without repair", () => {
    const links = normaliseBettingLinks([
      { id: "l1", betId: "b1|", transactionId: "s1", side: "stake", method: "exact", amount: 2500, date: "2026-10-01", linkedOn: "2026-10-30", operator: "SportyBet" },
      { id: "l2", betId: "b2", transactionId: "s2", side: "teleport", method: "exact", amount: 2500, date: "2026-10-01", linkedOn: "2026-10-30" },
      { id: "l3", betId: "b3", transactionId: "s3", side: "return", method: "exact", amount: -4, date: "2026-10-01", linkedOn: "2026-10-30" },
      "nope",
      { id: "l4", betId: "b4", transactionId: "s4", side: "return", method: "operator-window", amount: 400, date: "2026-10-04", linkedOn: "2026-10-30" },
    ]);
    assert.deepEqual(links.map((link) => link.id), ["l1", "l4"]);
    assert.deepEqual(normaliseBettingLinks(null), []);
    assert.deepEqual(normaliseBettingLinks("nope"), []);
  });

  it("dedupes on the bet|transaction pair key", () => {
    assert.equal(linkKey("b1", "s1"), "b1|s1");
  });
});
