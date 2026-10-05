/**
 * Assessment mode for session.config.json. Browser-safe.
 *
 * Assessment tasks are graded, so the parts a candidate must not change live
 * here, on the server: provided cases and their expected answers, reference
 * materials, calibration samples for the custom check, and call budgets. The
 * candidate's own work (prompt, extra cases, check criteria, notes) stays in
 * eval-session.json and carries across levels of a progressive task.
 * Missing or disabled configuration keeps every Course behavior unchanged.
 */

import { CUSTOM_CHECK_MAX_CRITERIA_LENGTH } from './metrics/custom-check.js';
import { normalizeConsistencyFields } from './consistency.js';

/** Hard limits that assessment mode may raise the Course 1–5 ranges to. */
export const ASSESSMENT_LIMITS = {
  maxRuns: 10,
  maxCases: 20,
  maxProvidedCases: 20,
  maxCandidateCases: 20,
  maxMaterials: 10,
  maxCalibrationSamples: 20,
  maxCallsPerEvaluation: 400,
};

export const DEFAULT_MAX_CALLS_PER_EVALUATION = 120;
export const DEFAULT_NOTES_MAX_LENGTH = 4000;
const MAX_TEXT_LENGTH = 20000;

export const DEFAULT_ASSESSMENT = {
  enabled: false,
  stage: '',
  stageLabel: '',
  lede: '',
  materials: [],
  providedCases: [],
  allowCandidateCases: true,
  maxCandidateCases: 10,
  maxCallsPerEvaluation: DEFAULT_MAX_CALLS_PER_EVALUATION,
  maxPromptLength: null,
  temperature: null,
  reasoningEffort: null,
  customCheck: {
    enabled: false,
    label: 'Custom check',
    placeholder: '',
    maxCriteriaLength: CUSTOM_CHECK_MAX_CRITERIA_LENGTH,
    calibrationSamples: [],
  },
  consistency: {
    enabled: false,
    fields: [],
  },
  notes: {
    enabled: false,
    label: 'Notes',
    placeholder: '',
    maxLength: DEFAULT_NOTES_MAX_LENGTH,
  },
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;
/** Values OpenAI reasoning models accept (GPT-6 adds none/xhigh/max; GPT-5 used minimal). */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value, max = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function label(value, fallback) {
  const s = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  return s || fallback;
}

function positiveInt(value, fallback, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, n);
}

/**
 * Keep unique, safe ids; generate `${prefix}-${n}` for missing or duplicate ones.
 * @template {{ id: string }} T
 * @param {T[]} items
 * @param {string} prefix
 * @returns {T[]}
 */
function withUniqueIds(items, prefix) {
  const seen = new Set();
  return items.map((item, index) => {
    let id = ID_RE.test(item.id) && !seen.has(item.id) ? item.id : `${prefix}-${index + 1}`;
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    return { ...item, id };
  });
}

function normalizeMaterials(raw) {
  if (!Array.isArray(raw)) return [];
  return withUniqueIds(raw
    .filter(isPlainObject)
    .slice(0, ASSESSMENT_LIMITS.maxMaterials)
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : '',
      title: label(item.title, `Reference ${index + 1}`),
      body: text(item.body),
    })), 'material');
}

function normalizeProvidedCases(raw) {
  if (!Array.isArray(raw)) return [];
  return withUniqueIds(raw
    .filter(isPlainObject)
    .slice(0, ASSESSMENT_LIMITS.maxProvidedCases)
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : '',
      label: label(item.label, `Provided ${index + 1}`),
      input: text(item.input),
      expectedAnswer: text(item.expectedAnswer),
      ...(isPlainObject(item.variables)
        ? {
          variables: Object.fromEntries(Object.entries(item.variables)
            .filter(([name, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) && typeof value === 'string')
            .map(([name, value]) => [name, text(value)])),
        }
        : {}),
    })), 'provided');
}

function normalizeCalibrationSamples(raw) {
  if (!Array.isArray(raw)) return [];
  return withUniqueIds(raw
    .filter((item) => isPlainObject(item) && (item.verdict === 'pass' || item.verdict === 'fail'))
    .slice(0, ASSESSMENT_LIMITS.maxCalibrationSamples)
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : '',
      label: label(item.label, `Sample ${index + 1}`),
      input: text(item.input),
      output: text(item.output),
      expectedAnswer: text(item.expectedAnswer),
      verdict: item.verdict,
      note: text(item.note, 500),
    })), 'sample');
}

/**
 * @param {unknown} raw
 * @returns {typeof DEFAULT_ASSESSMENT}
 */
export function normalizeAssessmentConfig(raw) {
  const src = isPlainObject(raw) ? raw : {};
  if (src.enabled !== true) {
    return structuredClone(DEFAULT_ASSESSMENT);
  }
  const customCheckSrc = isPlainObject(src.customCheck) ? src.customCheck : {};
  const consistencySrc = isPlainObject(src.consistency) ? src.consistency : {};
  const notesSrc = isPlainObject(src.notes) ? src.notes : {};
  const temperature = typeof src.temperature === 'number'
    && Number.isFinite(src.temperature)
    && src.temperature >= 0
    && src.temperature <= 2
    ? src.temperature
    : null;

  return {
    enabled: true,
    stage: typeof src.stage === 'string' ? src.stage.trim().slice(0, 64) : '',
    stageLabel: text(src.stageLabel, 200).trim(),
    lede: text(src.lede, 1000).trim(),
    materials: normalizeMaterials(src.materials),
    providedCases: normalizeProvidedCases(src.providedCases),
    allowCandidateCases: src.allowCandidateCases !== false,
    maxCandidateCases: positiveInt(
      src.maxCandidateCases,
      DEFAULT_ASSESSMENT.maxCandidateCases,
      ASSESSMENT_LIMITS.maxCandidateCases,
    ),
    maxCallsPerEvaluation: positiveInt(
      src.maxCallsPerEvaluation,
      DEFAULT_MAX_CALLS_PER_EVALUATION,
      ASSESSMENT_LIMITS.maxCallsPerEvaluation,
    ),
    maxPromptLength: src.maxPromptLength == null
      ? null
      : positiveInt(src.maxPromptLength, null, MAX_TEXT_LENGTH),
    temperature,
    reasoningEffort: REASONING_EFFORTS.includes(src.reasoningEffort) ? src.reasoningEffort : null,
    customCheck: {
      enabled: customCheckSrc.enabled === true,
      label: label(customCheckSrc.label, DEFAULT_ASSESSMENT.customCheck.label),
      placeholder: text(customCheckSrc.placeholder, 2000),
      maxCriteriaLength: CUSTOM_CHECK_MAX_CRITERIA_LENGTH,
      calibrationSamples: normalizeCalibrationSamples(customCheckSrc.calibrationSamples),
    },
    consistency: {
      enabled: consistencySrc.enabled === true,
      fields: normalizeConsistencyFields(consistencySrc.fields),
    },
    notes: {
      enabled: notesSrc.enabled === true,
      label: label(notesSrc.label, DEFAULT_ASSESSMENT.notes.label),
      placeholder: text(notesSrc.placeholder, 2000),
      maxLength: positiveInt(notesSrc.maxLength, DEFAULT_NOTES_MAX_LENGTH, MAX_TEXT_LENGTH),
    },
  };
}
