/**
 * Working eval-session payload (eval-session.json).
 * Browser-safe: the client and server share the same normalizer.
 */

import { DEFAULT_METRIC_ID, isValidMetricId } from './metrics/index.js';
import { FALLBACK_DEFAULTS } from './session-config.js';

/**
 * @typedef {object} EvalSessionLimits
 * @property {number} [minRuns]
 * @property {number} [maxRuns]
 * @property {number} [maxCases]
 */

/**
 * @typedef {object} EvalSession
 * @property {string} promptA
 * @property {string} promptB
 * @property {boolean} compareMode
 * @property {Array<{ id: string, input: string, expectedAnswer: string }>} cases
 * @property {string} metricId
 * @property {number} runs
 * @property {object | null} lastResult
 */

/**
 * @param {unknown} value
 * @param {number} minRuns
 * @param {number} maxRuns
 * @returns {number}
 */
function clampRuns(value, minRuns, maxRuns) {
  const n = Number.parseInt(String(value ?? ''), 10);
  const fallback = Math.min(maxRuns, Math.max(minRuns, 2));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(maxRuns, Math.max(minRuns, n));
}

/**
 * @param {unknown} raw
 * @param {number} maxCases
 * @returns {Array<{ id: string, input: string, expectedAnswer: string }>}
 */
function normalizeSessionCases(raw, maxCases) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c, i) => ({
      id: typeof c.id === 'string' && c.id ? c.id : `case-${i}`,
      input: typeof c.input === 'string' ? c.input : '',
      expectedAnswer: typeof c.expectedAnswer === 'string' ? c.expectedAnswer : '',
    }))
    .slice(0, maxCases);
}

/**
 * @param {unknown} raw
 * @returns {object | null}
 */
function normalizeLastResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
}

/**
 * Normalize a raw eval-session object. Missing or invalid fields use empty defaults.
 * @param {unknown} raw
 * @param {EvalSessionLimits} [limits]
 * @returns {EvalSession}
 */
export function normalizeEvalSession(raw, limits = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const minRuns = limits.minRuns ?? FALLBACK_DEFAULTS.minRuns;
  const maxRuns = limits.maxRuns ?? FALLBACK_DEFAULTS.maxRuns;
  const maxCases = limits.maxCases ?? FALLBACK_DEFAULTS.maxCases;
  const metricId = isValidMetricId(src.metricId) ? src.metricId : DEFAULT_METRIC_ID;

  return {
    promptA: typeof src.promptA === 'string' ? src.promptA : '',
    promptB: typeof src.promptB === 'string' ? src.promptB : '',
    compareMode: src.compareMode === true,
    cases: normalizeSessionCases(src.cases, maxCases),
    metricId,
    runs: clampRuns(src.runs, minRuns, maxRuns),
    lastResult: normalizeLastResult(src.lastResult),
  };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * @param {unknown} comparison
 * @returns {boolean}
 */
function isRenderableComparison(comparison) {
  return isPlainObject(comparison) && isPlainObject(comparison.means);
}

/**
 * @param {unknown} prompt
 * @param {{ requireResults?: boolean }} [opts]
 * @returns {boolean}
 */
function isRenderablePrompt(prompt, opts = {}) {
  if (!isPlainObject(prompt) || typeof prompt.id !== 'string') return false;
  if (prompt.results !== undefined && !Array.isArray(prompt.results)) return false;
  if (opts.requireResults && !Array.isArray(prompt.results)) return false;
  return true;
}

/**
 * @param {unknown} testCase
 * @returns {boolean}
 */
function isRenderableCase(testCase) {
  return isPlainObject(testCase)
    && isRenderableComparison(testCase.comparison)
    && Array.isArray(testCase.prompts)
    && testCase.prompts.every((prompt) => isRenderablePrompt(prompt, { requireResults: true }));
}

/**
 * True when lastResult has the nested fields renderComparison / renderVerdict read.
 * @param {unknown} data
 * @returns {boolean}
 */
export function isRenderableResult(data) {
  return isPlainObject(data)
    && isPlainObject(data.conditions)
    && isRenderableComparison(data.comparison)
    && Array.isArray(data.prompts)
    && data.prompts.every((prompt) => isRenderablePrompt(prompt))
    && Array.isArray(data.cases)
    && data.cases.every(isRenderableCase);
}
