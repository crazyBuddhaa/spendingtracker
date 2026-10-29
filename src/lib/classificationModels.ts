import type { Category, CategoryRule, RecipientProfile, Transaction } from "../types.ts";
import { categoryList } from "../types.ts";
import { isWalletProductMovement, normaliseTransactionDescription, recogniseTransactionParty } from "./categorise.ts";
import { buildClassificationHistory, classifyTransaction } from "./transactionIntelligence.ts";

const MIN_TRAINING_EXAMPLES = 8;
const MIN_TEST_EXAMPLES = 5;
const MIN_TEST_EXAMPLES_FOR_SVM = 30;
const MEANINGFUL_IMPROVEMENT = 0.03;
const MAX_FEATURES = 400;
const MAX_VERIFIED_ROWS = 2_000;

export type ClassificationModelName = "rules" | "logistic-regression" | "decision-tree" | "linear-svm";

export interface ClassificationModelScore {
  accuracy: number;
  macroF1: number;
  count: number;
  accuracyDelta: number;
  macroF1Delta: number;
  meaningfulImprovement: boolean;
}

export interface ClassificationModelEvaluation {
  status: "ready" | "insufficient-data";
  reason?: string;
  verifiedCount: number;
  trainingCount: number;
  testCount: number;
  trainEndDate: string | null;
  testStartDate: string | null;
  ruleBaseline: ClassificationModelScore | null;
  logisticRegression: ClassificationModelScore | null;
  decisionTree: ClassificationModelScore | null;
  svm: {
    tested: boolean;
    reason: string;
    score: ClassificationModelScore | null;
  };
  recommendedModel: ClassificationModelName | null;
  modelsAreDeployed: false;
}

interface VectorizedExample {
  features: number[];
  category: Category;
}

interface Metrics {
  accuracy: number;
  macroF1: number;
  count: number;
}

type DecisionNode =
  | { type: "leaf"; category: Category }
  | { type: "split"; feature: number; yes: DecisionNode; no: DecisionNode };

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function verifiedCategoryRows(transactions: Transaction[]): Transaction[] {
  const validCategories = new Set<string>(categoryList);
  return transactions
    .filter((transaction) =>
      (transaction.categoryLocked || transaction.manual)
      && validCategories.has(transaction.category)
      && isValidDate(transaction.date),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function sanitizedNarration(description: string): string {
  return description
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:reference|ref|rrn|session|trace|transaction\s*id|account\s*(?:no|number))\b[\s:#-]*[a-z0-9*_-]+/gi, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function featuresFor(transaction: Transaction): Set<string> {
  const narration = `${sanitizedNarration(transaction.description)} ${normaliseTransactionDescription(transaction.description)}`;
  const tokens = narration.match(/[a-z0-9]{2,}/g) ?? [];
  const features = new Set<string>([`direction:${transaction.direction}`]);
  for (let index = 0; index < tokens.length; index += 1) {
    features.add(`word:${tokens[index]}`);
    if (index > 0) features.add(`pair:${tokens[index - 1]}_${tokens[index]}`);
  }
  const party = recogniseTransactionParty(transaction.description);
  if (party) features.add(`party:${party.kind}`);
  if (transaction.internalTransfer || isWalletProductMovement(transaction.description)) features.add("flag:internal");
  if (transaction.ownAccountCandidate) features.add("flag:own-account");
  return features;
}

function buildVocabulary(trainingRows: Transaction[]): string[] {
  const documentFrequency = new Map<string, number>();
  for (const transaction of trainingRows) {
    for (const feature of featuresFor(transaction)) {
      documentFrequency.set(feature, (documentFrequency.get(feature) ?? 0) + 1);
    }
  }
  return [...documentFrequency.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_FEATURES)
    .map(([feature]) => feature);
}

function vectorize(transaction: Transaction, vocabulary: Map<string, number>): number[] {
  const indices: number[] = [];
  for (const feature of featuresFor(transaction)) {
    const index = vocabulary.get(feature);
    if (index !== undefined) indices.push(index);
  }
  return indices;
}

function softmax(scores: number[]): number[] {
  const maximum = Math.max(...scores);
  const exponentials = scores.map((score) => Math.exp(score - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function trainLogisticRegression(training: VectorizedExample[], classes: Category[], featureCount: number): (features: number[]) => Category {
  const weights = classes.map(() => new Float64Array(featureCount));
  const biases = new Float64Array(classes.length);
  const classIndex = new Map(classes.map((category, index) => [category, index]));
  const epochs = 80;
  const regularization = 0.002;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradients = classes.map(() => new Float64Array(featureCount));
    const biasGradients = new Float64Array(classes.length);
    for (const example of training) {
      const scores = classes.map((_, index) => {
        let score = biases[index];
        for (const feature of example.features) score += weights[index][feature];
        return score;
      });
      const probabilities = softmax(scores);
      const actual = classIndex.get(example.category)!;
      for (let index = 0; index < classes.length; index += 1) {
        const error = probabilities[index] - (index === actual ? 1 : 0);
        biasGradients[index] += error;
        for (const feature of example.features) weightGradients[index][feature] += error;
      }
    }
    const learningRate = 0.3 / Math.sqrt(epoch + 1);
    for (let index = 0; index < classes.length; index += 1) {
      biases[index] -= learningRate * biasGradients[index] / training.length;
      for (let feature = 0; feature < featureCount; feature += 1) {
        weights[index][feature] -= learningRate * (
          weightGradients[index][feature] / training.length + regularization * weights[index][feature]
        );
      }
    }
  }

  return (features) => {
    let best = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < classes.length; index += 1) {
      let score = biases[index];
      for (const feature of features) score += weights[index][feature];
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    }
    return classes[best];
  };
}

function entropy(counts: number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (!total) return 0;
  return counts.reduce((sum, count) => {
    if (!count) return sum;
    const probability = count / total;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function majorityCategory(rows: VectorizedExample[], classes: Category[]): Category {
  const counts = new Map<Category, number>();
  for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  return classes.reduce((best, category) =>
    (counts.get(category) ?? 0) > (counts.get(best) ?? 0) ? category : best,
  classes[0]);
}

function buildDecisionTree(
  rows: VectorizedExample[],
  classes: Category[],
  featureCount: number,
  depth = 0,
  usedFeatures = new Set<number>(),
): DecisionNode {
  const fallback = majorityCategory(rows, classes);
  const presentCategories = new Set(rows.map((row) => row.category));
  if (presentCategories.size <= 1 || depth >= 5 || rows.length < 6) {
    return { type: "leaf", category: fallback };
  }

  const parentCounts = classes.map((category) => rows.filter((row) => row.category === category).length);
  const parentEntropy = entropy(parentCounts);
  const minimumLeafSize = Math.max(2, Math.floor(rows.length * 0.05));
  let bestGain = 0.01;
  let bestFeature = -1;
  let bestYes: VectorizedExample[] = [];
  let bestNo: VectorizedExample[] = [];

  for (let feature = 0; feature < featureCount; feature += 1) {
    if (usedFeatures.has(feature)) continue;
    const yes = rows.filter((row) => row.features.includes(feature));
    const no = rows.filter((row) => !row.features.includes(feature));
    if (yes.length < minimumLeafSize || no.length < minimumLeafSize) continue;
    const yesCounts = classes.map((category) => yes.filter((row) => row.category === category).length);
    const noCounts = classes.map((category) => no.filter((row) => row.category === category).length);
    const gain = parentEntropy
      - (yes.length / rows.length) * entropy(yesCounts)
      - (no.length / rows.length) * entropy(noCounts);
    if (gain > bestGain) {
      bestGain = gain;
      bestFeature = feature;
      bestYes = yes;
      bestNo = no;
    }
  }

  if (bestFeature < 0) return { type: "leaf", category: fallback };
  const nextUsed = new Set(usedFeatures);
  nextUsed.add(bestFeature);
  return {
    type: "split",
    feature: bestFeature,
    yes: buildDecisionTree(bestYes, classes, featureCount, depth + 1, nextUsed),
    no: buildDecisionTree(bestNo, classes, featureCount, depth + 1, nextUsed),
  };
}

function predictDecisionTree(node: DecisionNode, features: number[]): Category {
  let current = node;
  const present = new Set(features);
  while (current.type === "split") current = present.has(current.feature) ? current.yes : current.no;
  return current.category;
}

function trainLinearSvm(training: VectorizedExample[], classes: Category[], featureCount: number): (features: number[]) => Category {
  const weights = classes.map(() => new Float64Array(featureCount));
  const biases = new Float64Array(classes.length);
  const epochs = 60;
  const regularization = 0.003;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradients = classes.map(() => new Float64Array(featureCount));
    const biasGradients = new Float64Array(classes.length);
    for (const example of training) {
      for (let classPosition = 0; classPosition < classes.length; classPosition += 1) {
        const sign = example.category === classes[classPosition] ? 1 : -1;
        let score = biases[classPosition];
        for (const feature of example.features) score += weights[classPosition][feature];
        if (sign * score >= 1) continue;
        biasGradients[classPosition] -= sign;
        for (const feature of example.features) weightGradients[classPosition][feature] -= sign;
      }
    }
    const learningRate = 0.18 / Math.sqrt(epoch + 1);
    for (let index = 0; index < classes.length; index += 1) {
      biases[index] -= learningRate * biasGradients[index] / training.length;
      for (let feature = 0; feature < featureCount; feature += 1) {
        weights[index][feature] -= learningRate * (
          weightGradients[index][feature] / training.length + regularization * weights[index][feature]
        );
      }
    }
  }

  return (features) => {
    let best = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < classes.length; index += 1) {
      let score = biases[index];
      for (const feature of features) score += weights[index][feature];
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    }
    return classes[best];
  };
}

function calculateMetrics(actual: Category[], predicted: Category[]): Metrics {
  let correct = 0;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] === predicted[index]) correct += 1;
  }
  const labels = [...new Set([...actual, ...predicted])];
  const macroF1 = labels.length
    ? labels.reduce((sum, label) => {
      let truePositive = 0;
      let falsePositive = 0;
      let falseNegative = 0;
      for (let index = 0; index < actual.length; index += 1) {
        if (actual[index] === label && predicted[index] === label) truePositive += 1;
        else if (actual[index] !== label && predicted[index] === label) falsePositive += 1;
        else if (actual[index] === label && predicted[index] !== label) falseNegative += 1;
      }
      const denominator = 2 * truePositive + falsePositive + falseNegative;
      return sum + (denominator ? (2 * truePositive) / denominator : 0);
    }, 0) / labels.length
    : 0;
  return {
    accuracy: correct / actual.length,
    macroF1,
    count: actual.length,
  };
}

function scoreAgainstRules(metrics: Metrics, baseline: Metrics): ClassificationModelScore {
  const accuracyDelta = metrics.accuracy - baseline.accuracy;
  const macroF1Delta = metrics.macroF1 - baseline.macroF1;
  return {
    ...metrics,
    accuracyDelta,
    macroF1Delta,
    meaningfulImprovement: metrics.count >= MIN_TEST_EXAMPLES_FOR_SVM
      && accuracyDelta >= MEANINGFUL_IMPROVEMENT
      && macroF1Delta >= MEANINGFUL_IMPROVEMENT,
  };
}

function emptyEvaluation(verifiedCount: number, reason: string): ClassificationModelEvaluation {
  return {
    status: "insufficient-data",
    reason,
    verifiedCount,
    trainingCount: 0,
    testCount: 0,
    trainEndDate: null,
    testStartDate: null,
    ruleBaseline: null,
    logisticRegression: null,
    decisionTree: null,
    svm: { tested: false, reason: "SVM was not tested because the comparison set is not ready.", score: null },
    recommendedModel: null,
    modelsAreDeployed: false,
  };
}

function compareScores(a: ClassificationModelScore, b: ClassificationModelScore): number {
  return b.accuracy - a.accuracy || b.macroF1 - a.macroF1;
}

/**
 * Evaluates the existing classifier against two locally trained candidates on a
 * chronological holdout of user-verified transactions. Nothing is persisted or
 * applied to transaction categories. SVM is trained only after a simple model
 * beats rules by at least 3 percentage points in accuracy and macro-F1 on 30+
 * holdout rows.
 */
export function evaluateClassificationModels(
  transactions: Transaction[],
  rules: CategoryRule[] = [],
  profiles: RecipientProfile[] = [],
): ClassificationModelEvaluation {
  const verified = verifiedCategoryRows(transactions).slice(-MAX_VERIFIED_ROWS);
  const uniqueDates = [...new Set(verified.map((transaction) => transaction.date))];
  if (verified.length < MIN_TRAINING_EXAMPLES + MIN_TEST_EXAMPLES || uniqueDates.length < 2) {
    return emptyEvaluation(verified.length, "Need at least 13 user-verified transactions on two or more dates for a chronological holdout.");
  }

  const splitIndex = Math.min(uniqueDates.length - 1, Math.max(1, Math.floor(uniqueDates.length * 0.8)));
  const testStartDate = uniqueDates[splitIndex];
  const trainingRows = verified.filter((transaction) => transaction.date < testStartDate);
  const testRows = verified.filter((transaction) => transaction.date >= testStartDate);
  const trainingCategories = new Set(trainingRows.map((transaction) => transaction.category));
  if (
    trainingRows.length < MIN_TRAINING_EXAMPLES
    || testRows.length < MIN_TEST_EXAMPLES
    || trainingCategories.size < 2
  ) {
    return emptyEvaluation(verified.length, "Need at least 8 verified training rows, 5 later holdout rows, and 2 categories in training.");
  }

  const categories = categoryList.filter((category) => trainingCategories.has(category));
  const vocabulary = buildVocabulary(trainingRows);
  if (!vocabulary.length) {
    return emptyEvaluation(verified.length, "Not enough repeated description features to train a useful model.");
  }
  const vocabularyIndex = new Map(vocabulary.map((feature, index) => [feature, index]));
  const training = trainingRows.map((transaction) => ({
    features: vectorize(transaction, vocabularyIndex),
    category: transaction.category,
  }));
  const test = testRows.map((transaction) => ({
    features: vectorize(transaction, vocabularyIndex),
    category: transaction.category,
  }));
  const actual = test.map((example) => example.category);
  const trainingHistory = buildClassificationHistory(trainingRows, profiles);
  const baselinePredictions = testRows.map((transaction) => classifyTransaction({
    ...transaction,
    category: "Other",
    categoryLocked: false,
    manual: false,
    rejectedSuggestion: undefined,
  }, rules, trainingHistory, profiles).category);
  const baseline = calculateMetrics(actual, baselinePredictions);

  const logisticPredict = trainLogisticRegression(training, categories, vocabulary.length);
  const logisticRegression = scoreAgainstRules(
    calculateMetrics(actual, test.map((example) => logisticPredict(example.features))),
    baseline,
  );

  const tree = buildDecisionTree(training, categories, vocabulary.length);
  const decisionTree = scoreAgainstRules(
    calculateMetrics(actual, test.map((example) => predictDecisionTree(tree, example.features))),
    baseline,
  );

  const simpleCandidates = [
    { name: "logistic-regression" as const, score: logisticRegression },
    { name: "decision-tree" as const, score: decisionTree },
  ];
  const bestSimple = [...simpleCandidates].sort((a, b) => compareScores(a.score, b.score))[0];
  const svmGatePassed = test.length >= MIN_TEST_EXAMPLES_FOR_SVM
    && bestSimple.score.accuracyDelta >= MEANINGFUL_IMPROVEMENT
    && bestSimple.score.macroF1Delta >= MEANINGFUL_IMPROVEMENT;
  let svm: ClassificationModelEvaluation["svm"] = {
    tested: false,
    reason: test.length < MIN_TEST_EXAMPLES_FOR_SVM
      ? `SVM skipped: it needs at least ${MIN_TEST_EXAMPLES_FOR_SVM} holdout rows for a meaningful comparison.`
      : "SVM skipped: neither simpler model improved both accuracy and macro-F1 by at least 3 percentage points over rules.",
    score: null,
  };
  let recommendedModel: ClassificationModelName = "rules";
  const meaningfulSimple = simpleCandidates
    .filter((candidate) => candidate.score.meaningfulImprovement)
    .sort((a, b) => compareScores(a.score, b.score));
  if (meaningfulSimple.length) recommendedModel = meaningfulSimple[0].name;

  if (svmGatePassed) {
    const svmPredict = trainLinearSvm(training, categories, vocabulary.length);
    const svmScore = scoreAgainstRules(
      calculateMetrics(actual, test.map((example) => svmPredict(example.features))),
      baseline,
    );
    svm = {
      tested: true,
      reason: "Tested because a simpler model cleared the pre-set improvement threshold.",
      score: svmScore,
    };
    if (
      svmScore.meaningfulImprovement
      && svmScore.accuracy - bestSimple.score.accuracy >= MEANINGFUL_IMPROVEMENT
      && svmScore.macroF1 - bestSimple.score.macroF1 >= MEANINGFUL_IMPROVEMENT
    ) recommendedModel = "linear-svm";
  }

  return {
    status: "ready",
    verifiedCount: verified.length,
    trainingCount: training.length,
    testCount: test.length,
    trainEndDate: trainingRows.at(-1)?.date ?? null,
    testStartDate,
    ruleBaseline: {
      ...baseline,
      accuracyDelta: 0,
      macroF1Delta: 0,
      meaningfulImprovement: false,
    },
    logisticRegression,
    decisionTree,
    svm,
    recommendedModel,
    modelsAreDeployed: false,
  };
}
