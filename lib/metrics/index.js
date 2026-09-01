/**
 * Metric registry — add new evaluators here (e.g. semantic similarity later).
 */

import exactMatch from './exact-match.js';
import exactMatchCi from './exact-match-ci.js';
import contains from './contains.js';
import stringSimilarity from './string-similarity.js';
import wordOverlapF1 from './word-overlap-f1.js';

/** @type {import('./types.js').Metric[]} */
const METRICS = [
  exactMatch,
  exactMatchCi,
  contains,
  stringSimilarity,
  wordOverlapF1,
];

/** @type {Map<string, import('./types.js').Metric>} */
const BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export const DEFAULT_METRIC_ID = exactMatch.id;

/**
 * @returns {Array<{ id: string, name: string, description: string }>}
 */
export function listMetrics() {
  return METRICS.map(({ id, name, description }) => ({ id, name, description }));
}

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
  if (typeof expectedAnswer !== 'string' || expectedAnswer.trim() === '') {
    return null;
  }
  const metric = getMetric(metricId) ?? getMetric(DEFAULT_METRIC_ID);
  if (!metric) return null;
  return metric.score(output, expectedAnswer);
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
