/**
 * Metric registry — add new evaluators here (e.g. semantic similarity later).
 */

import exactMatch from './exact-match.js';
import exactMatchCi from './exact-match-ci.js';
import contains from './contains.js';
import stringSimilarity from './string-similarity.js';
import wordOverlapF1 from './word-overlap-f1.js';
import regexMatch from './regex-match.js';
import validJson from './valid-json.js';
import llmJudge, { LLM_JUDGE_SYSTEM_PROMPT, parseJudgeScore } from './llm-judge.js';

/** @type {import('./types.js').Metric[]} */
const METRICS = [
  exactMatch,
  exactMatchCi,
  contains,
  stringSimilarity,
  wordOverlapF1,
  regexMatch,
  validJson,
  llmJudge,
];

/** @type {Map<string, import('./types.js').Metric>} */
const BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export const DEFAULT_METRIC_ID = exactMatch.id;
export const DEFAULT_ALLOWED_METRIC_IDS = [
  exactMatch.id,
  exactMatchCi.id,
  contains.id,
  stringSimilarity.id,
  wordOverlapF1.id,
];

/**
 * @param {string} id
 * @returns {import('./types.js').Metric | null}
 */
export function getMetric(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidMetricId(id) {
  return typeof id === 'string' && BY_ID.has(id);
}

/**
 * Score one output. Returns null when scoring is skipped (no expected answer).
 *
 * @param {string} output
 * @param {string | null | undefined} expectedAnswer
 * @param {string} metricId
 * @returns {number | null}
 */
export function scoreOutput(output, expectedAnswer, metricId) {
  const metric = getMetric(metricId) ?? getMetric(DEFAULT_METRIC_ID);
  if (!metric) return null;
  if (metric.type === 'llm') return null;
  if (
    metric.requiresExpectedAnswer !== false
    && (typeof expectedAnswer !== 'string' || expectedAnswer.trim() === '')
  ) {
    return null;
  }
  return metric.score(output, expectedAnswer);
}

/**
 * Score an output with either a synchronous checker or an LLM judge.
 *
 * @param {string} output
 * @param {string | null | undefined} expectedAnswer
 * @param {string} metricId
 * @param {{ llm?: import('../llm/types.js').LlmProvider, model?: string }} [deps]
 * @returns {Promise<number | null>}
 */
export async function scoreOutputAsync(output, expectedAnswer, metricId, deps = {}) {
  const metric = getMetric(metricId) ?? getMetric(DEFAULT_METRIC_ID);
  if (!metric || metric.type !== 'llm') {
    return scoreOutput(output, expectedAnswer, metricId);
  }
  if (typeof expectedAnswer !== 'string' || expectedAnswer.trim() === '' || !deps.llm) {
    return null;
  }

  try {
    const result = await deps.llm.complete({
      model: deps.model || deps.llm.model,
      system: LLM_JUDGE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Expected answer:\n${expectedAnswer}\n\nCandidate output:\n${output}`,
      }],
      temperature: 0,
    });
    return parseJudgeScore(result?.text);
  } catch {
    return null;
  }
}

/**
 * @param {string} metricId
 * @param {string | null | undefined} expectedAnswer
 * @returns {boolean}
 */
export function isScoringEnabled(metricId, expectedAnswer) {
  const metric = getMetric(metricId) ?? getMetric(DEFAULT_METRIC_ID);
  return metric?.requiresExpectedAnswer === false
    || (typeof expectedAnswer === 'string' && expectedAnswer.trim() !== '');
}

/**
 * Aggregate finite scores into mean / min / max.
 * Returns null when there are no scored runs.
 *
 * @param {Array<number | null | undefined>} scores
 * @returns {{ mean: number, min: number, max: number, count: number } | null}
 */
export function summarizeScores(scores) {
  const values = scores.filter((s) => typeof s === 'number' && Number.isFinite(s));
  if (values.length === 0) return null;

  let sum = 0;
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return {
    mean: sum / values.length,
    min,
    max,
    count: values.length,
  };
}

export { METRICS };
