import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectMultiRecipientJourneys,
  detectPossibleJourneyPairs,
  detectTimeBasedRecipientPatterns,
} from "./recipientAnalytics.ts";

const tx = (overrides) => ({
  id: overrides.id,
  date: "2026-10-01",
  description: "Transfer to Someone | Bank | REF 123",
  amount: 1000,
  direction: "expense",
  category: "Transfers",
  source: "Test",
  ...overrides,
});

const profiles = [
  { id: "a", kind: "recipient", name: "Recipient A", aliases: ["Alias A"] },
  { id: "b", kind: "recipient", name: "Recipient B", aliases: ["Alias B"] },
  { id: "c", kind: "recipient", name: "Recipient C", aliases: ["Alias C"] },
  { id: "jane", kind: "recipient", name: "Jane Doe", aliases: ["JANE A DOE"] },
];

describe("recipient time and journey patterns", () => {
  it("recognises a recipient's recurring time across midnight and joins profile aliases", () => {
    const transactions = [
      tx({ id: "j1", date: "2026-10-01", time: "23:50:00", description: "Transfer to JANE A DOE | Bank | 1" }),
      tx({ id: "j2", date: "2026-10-02", time: "00:05:00", description: "Transfer to Jane Doe | Bank | 2" }),
      tx({ id: "j3", date: "2026-10-03", time: "23:55:00", description: "Transfer to JANE A DOE | Bank | 3" }),
      tx({ id: "outlier", date: "2026-10-04", time: "12:00:00", description: "Transfer to Jane Doe | Bank | 4" }),
      tx({ id: "missing-time", date: "2026-10-05", description: "Transfer to Jane Doe | Bank | 5" }),
      tx({ id: "income", date: "2026-10-06", time: "23:55:00", direction: "income", description: "Transfer from Jane Doe | Bank | 6" }),
      tx({ id: "invalid-date", date: "2026-02-31", time: "23:55:00", description: "Transfer to Jane Doe | Bank | 7" }),
    ];

    const [pattern] = detectTimeBasedRecipientPatterns(transactions, profiles);
    assert.equal(pattern.name, "Jane Doe");
    assert.equal(pattern.count, 3);
    assert.equal(pattern.days, 3);
    assert.equal(pattern.typicalTime, "23:55");
    assert.deepEqual(pattern.transactionIds.sort(), ["j1", "j2", "j3"]);
  });

  it("recognises repeated ordered recipient pairs, but excludes one-off and internal transfers", () => {
    const transactions = [
      tx({ id: "a1", date: "2026-10-01", time: "09:00", description: "Transfer to Alias A | Bank | 1" }),
      tx({ id: "b1", date: "2026-10-01", time: "09:45", description: "Transfer to Alias B | Bank | 2" }),
      tx({ id: "a2", date: "2026-10-02", time: "10:00", description: "Transfer to Recipient A | Bank | 3" }),
      tx({ id: "b2", date: "2026-10-02", time: "10:30", description: "Transfer to Recipient B | Bank | 4" }),
      tx({ id: "one-off", date: "2026-10-03", time: "10:00", description: "Transfer to Recipient C | Bank | 5" }),
      tx({ id: "internal-a", date: "2026-10-04", time: "09:00", internalTransfer: true, description: "Transfer to Alias A | Bank | 6" }),
      tx({ id: "internal-b", date: "2026-10-04", time: "09:30", internalTransfer: true, description: "Transfer to Alias B | Bank | 7" }),
    ];

    const [pair] = detectPossibleJourneyPairs(transactions, profiles);
    assert.equal(pair.firstRecipient, "Recipient A");
    assert.equal(pair.secondRecipient, "Recipient B");
    assert.equal(pair.days, 2);
    assert.equal(pair.count, 2);
    assert.equal(pair.typicalGapMinutes, 38);
    assert.deepEqual(pair.transactionIds.sort(), ["a1", "a2", "b1", "b2"]);
  });

  it("recognises a repeated multi-recipient sequence and reports its typical duration", () => {
    const transactions = [
      tx({ id: "a1", date: "2026-10-01", time: "09:00", description: "Transfer to Alias A | Bank | 1" }),
      tx({ id: "b1", date: "2026-10-01", time: "09:20", description: "Transfer to Alias B | Bank | 2" }),
      tx({ id: "c1", date: "2026-10-01", time: "10:15", description: "Transfer to Alias C | Bank | 3" }),
      tx({ id: "a2", date: "2026-10-02", time: "11:00", description: "Transfer to Recipient A | Bank | 4" }),
      tx({ id: "b2", date: "2026-10-02", time: "11:30", description: "Transfer to Recipient B | Bank | 5" }),
      tx({ id: "c2", date: "2026-10-02", time: "12:00", description: "Transfer to Recipient C | Bank | 6" }),
    ];

    const [journey] = detectMultiRecipientJourneys(transactions, profiles);
    assert.deepEqual(journey.recipients, ["Recipient A", "Recipient B", "Recipient C"]);
    assert.equal(journey.days, 2);
    assert.equal(journey.typicalDurationMinutes, 68);
    assert.equal(journey.transactionIds.length, 6);
  });

  it("does not treat a single-day or widely spaced sequence as a recurring journey", () => {
    const transactions = [
      tx({ id: "a1", date: "2026-10-01", time: "08:00", description: "Transfer to Alias A | Bank | 1" }),
      tx({ id: "b1", date: "2026-10-01", time: "12:00", description: "Transfer to Alias B | Bank | 2" }),
      tx({ id: "c1", date: "2026-10-01", time: "12:20", description: "Transfer to Alias C | Bank | 3" }),
    ];

    assert.deepEqual(detectPossibleJourneyPairs(transactions, profiles), []);
    assert.deepEqual(detectMultiRecipientJourneys(transactions, profiles), []);
  });
});
