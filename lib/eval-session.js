/**
 * Working eval-session payload (eval-session.json).
 * Browser-safe: the client and server share the same normalizer.
 */

import {
  DEFAULT_ALLOWED_METRIC_IDS,
  DEFAULT_METRIC_ID,
  isValidMetricId,
} from './metrics/index.js';
import { findPromptPlaceholders } from './prompt-render.js';
import {
  DEFAULT_ASSESSMENT,
  DEFAULT_PROMPT_TEMPLATING,
  FALLBACK_DEFAULTS,
} from './session-config.js';

const MAX_EXCLUDED_CASE_IDS = 64;
/** Stored as typed; the configured limits are enforced where the text is used, with a clear error. */
const MAX_STORED_TEXT = 20000;

/**
 * @typedef {object} EvalSessionLimits
 * @property {number} [minRuns]
 * @property {number} [maxRuns]
 * @property {number} [maxCases]
 * @property {string[]} [allowedMetricIds]
 * @property {typeof DEFAULT_PROMPT_TEMPLATING} [promptTemplating]
 * @property {typeof DEFAULT_ASSESSMENT} [assessment]
 */

/**
 * @typedef {object} EvalSession
 * @property {string} model
 * @property {string} promptA
 * @property {string} promptB
 * @property {boolean} compareMode
 * @property {{ active: string[], instruction: string, context: string, constraints: string, outputFormat: string }} [promptComponents]
 * @property {Array<{ id: string, input: string, expectedAnswer: string, variables?: Record<string, string> }>} cases
 * @property {Array<{ id: string, input: string, idealOutput: string }>} [examples]
 * @property {string} metricId
 * @property {number} runs
 * @property {object | null} lastResult
 * @property {string} [stage] assessment level the session was last saved in
 * @property {string} [customCheckCriteria] assessment: the candidate's custom check
 * @property {string} [notes] assessment: the candidate's written findings
 * @property {string[]} [excludedCaseIds] assessment: cases left out of the next run
 * @property {object | null} [lastCalibration] assessment: last custom check calibration
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
 * @param {typeof DEFAULT_PROMPT_TEMPLATING} promptTemplating
 * @returns {Array<{ id: string, input: string, expectedAnswer: string, variables?: Record<string, string> }>}
 */
function normalizeSessionCases(raw, maxCases, promptTemplating) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c, i) => ({
      id: typeof c.id === 'string' && c.id ? c.id : `case-${i}`,
      input: typeof c.input === 'string' ? c.input : '',
      expectedAnswer: typeof c.expectedAnswer === 'string' ? c.expectedAnswer : '',
      ...(promptTemplating.enabled
        ? {
          variables: Object.fromEntries(promptTemplating.variableNames.map((name) => [
            name,
            typeof c.variables?.[name] === 'string' ? c.variables[name] : '',
          ])),
        }
        : {}),
    }))
    .slice(0, maxCases);
}

/**
 * @param {unknown} raw
 * @returns {Array<{ id: string, input: string, idealOutput: string }>}
 */
function normalizeSessionExamples(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((example) => example && typeof example === 'object' && !Array.isArray(example))
    .map((example, index) => ({
      id: typeof example.id === 'string' && example.id ? example.id : `example-${index}`,
      input: typeof example.input === 'string' ? example.input : '',
      idealOutput: typeof example.idealOutput === 'string' ? example.idealOutput : '',
    }))
    .slice(0, 5);
}

function normalizePromptComponents(raw, promptTemplating) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const available = promptTemplating.builder?.availableComponents ?? [];
  return {
    active: available.filter((id) => Array.isArray(src.active) && src.active.includes(id)),
    instruction: typeof src.instruction === 'string' ? src.instruction : '',
    context: typeof src.context === 'string' ? src.context : '',
    constraints: typeof src.constraints === 'string' ? src.constraints : '',
    outputFormat: typeof src.outputFormat === 'string' ? src.outputFormat : '',
  };
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
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeExcludedCaseIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id) => typeof id === 'string' && id && id.length <= 64))]
    .slice(0, MAX_EXCLUDED_CASE_IDS);
}

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function clipText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
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
  const assessment = limits.assessment ?? DEFAULT_ASSESSMENT;
  // In assessment mode, session cases are only the candidate's own; provided
  // cases are served from config and never stored here.
  const maxCases = assessment.enabled
    ? (assessment.allowCandidateCases ? assessment.maxCandidateCases : 0)
    : limits.maxCases ?? FALLBACK_DEFAULTS.maxCases;
  const allowedMetricIds = Array.isArray(limits.allowedMetricIds)
    ? limits.allowedMetricIds.filter(isValidMetricId)
    : DEFAULT_ALLOWED_METRIC_IDS;
  const fallbackMetricId = allowedMetricIds.includes(DEFAULT_METRIC_ID)
    ? DEFAULT_METRIC_ID
    : allowedMetricIds[0] ?? DEFAULT_METRIC_ID;
  const metricId = isValidMetricId(src.metricId) && allowedMetricIds.includes(src.metricId)
    ? src.metricId
    : fallbackMetricId;
  const promptTemplating = limits.promptTemplating ?? DEFAULT_PROMPT_TEMPLATING;
  const dynamicVariableNames = promptTemplating.dynamicFields
    ? [...new Set([
      ...findPromptPlaceholders(src.promptA),
      ...findPromptPlaceholders(src.promptB),
    ])].filter((name) => {
      if (['input', '__proto__', 'prototype', 'constructor'].includes(name)) return false;
      if (name === 'examples' && promptTemplating.allowExamples) return false;
      return true;
    })
    : promptTemplating.variableNames;
  const effectivePromptTemplating = {
    ...promptTemplating,
    variableNames: dynamicVariableNames,
  };

  return {
    model: typeof src.model === 'string' ? src.model.trim() : '',
    promptA: typeof src.promptA === 'string' ? src.promptA : '',
    promptB: typeof src.promptB === 'string' ? src.promptB : '',
    compareMode: src.compareMode === true,
    ...(promptTemplating.builder?.enabled
      ? { promptComponents: normalizePromptComponents(src.promptComponents, promptTemplating) }
      : {}),
    cases: normalizeSessionCases(src.cases, maxCases, effectivePromptTemplating),
    ...(promptTemplating.enabled && promptTemplating.allowExamples
      ? { examples: normalizeSessionExamples(src.examples) }
      : {}),
    metricId,
    runs: clampRuns(src.runs, minRuns, maxRuns),
    lastResult: normalizeLastResult(src.lastResult),
    ...(assessment.enabled
      ? {
        stage: typeof src.stage === 'string' ? src.stage.slice(0, 64) : '',
        customCheckCriteria: clipText(src.customCheckCriteria, MAX_STORED_TEXT),
        notes: clipText(src.notes, MAX_STORED_TEXT),
        excludedCaseIds: normalizeExcludedCaseIds(src.excludedCaseIds),
        lastCalibration: normalizeLastResult(src.lastCalibration),
      }
      : {}),
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
