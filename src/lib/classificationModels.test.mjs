import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateClassificationModels } from "./classificationModels.ts";

function dateFromOffset(startDate, offset) {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function labelledTransaction(overrides = {}) {
  return {
    id: "tx",
    date: "2026-01-01",
    description: "quartzalpha",
    amount: 500,
    direction: "expense",
    category: "Health",
    source: "Test",
    categoryLocked: true,
    ...overrides,
  };
}

function separatedCategories(dayCount) {
  const labels = [
    { token: "quartzalpha", category: "Health" },
    { token: "willowbeta", category: "Education" },
    { token: "cobaltgamma", category: "Business" },
  ];
  return Array.from({ length: dayCount }, (_, day) => labels.map(({ token, category }) =>
    labelledTransaction({
      id: `${day}-${token}`,
      date: dateFromOffset("2026-01-01", day),
      description: `statement narration ${token} variant ${day}`,
      category,
    }),
  )).flat();
}

describe("private classification model evaluation", () => {
  it("uses only locked categories and evaluates on a chronological, date-separated holdout", () => {
    const transactions = [
      ...separatedCategories(12),
      labelledTransaction({
        id: "unverified",
        date: "2026-02-01",
        description: "quartzalpha",
        categoryLocked: false,
        category: "Shopping",
      }),
    ];

    const result = evaluateClassificationModels(transactions);

    assert.equal(result.status, "ready");
    assert.equal(result.verifiedCount, 36);
    assert.equal(result.trainingCount, 27);
    assert.equal(result.testCount, 9);
    assert.ok(result.trainEndDate < result.testStartDate);
    assert.equal(result.logisticRegression.accuracy, 1);
    assert.equal(result.decisionTree.accuracy, 1);
    assert.equal(result.ruleBaseline.accuracy, 0);
    assert.equal(result.svm.tested, false);
    assert.match(result.svm.reason, /at least 30 holdout rows/);
    assert.equal(result.recommendedModel, "rules");
    assert.equal(result.modelsAreDeployed, false);
  });

  it("runs SVM only after a simpler model clears the held-out improvement gate", () => {
    const result = evaluateClassificationModels(separatedCategories(60));

    assert.equal(result.status, "ready");
    assert.equal(result.testCount, 36);
    assert.equal(result.logisticRegression.meaningfulImprovement, true);
    assert.equal(result.decisionTree.meaningfulImprovement, true);
    assert.equal(result.svm.tested, true);
    assert.match(result.svm.reason, /simpler model cleared/);
    assert.equal(result.modelsAreDeployed, false);
  });

  it("reports insufficient verified history instead of scoring automatic categories as truth", () => {
    const unverified = Array.from({ length: 40 }, (_, index) => labelledTransaction({
      id: `auto-${index}`,
      date: dateFromOffset("2026-01-01", index),
      categoryLocked: false,
    }));

    const result = evaluateClassificationModels(unverified);

    assert.equal(result.status, "insufficient-data");
    assert.equal(result.verifiedCount, 0);
    assert.equal(result.ruleBaseline, null);
    assert.equal(result.recommendedModel, null);
    assert.equal(result.modelsAreDeployed, false);
  });

  it("keeps custom rules in the baseline and lets the last matching rule win", () => {
    const transactions = separatedCategories(12);
    const rules = [
      { id: "one", pattern: "quartzalpha", category: "Shopping", createdAt: "2026-01-01" },
      { id: "two", pattern: "quartzalpha", category: "Health", createdAt: "2026-01-02" },
    ];

    const result = evaluateClassificationModels(transactions, rules);

    assert.equal(result.status, "ready");
    assert.ok(result.ruleBaseline.accuracy > 0.3);
  });
});
