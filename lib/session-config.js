/**
 * Local session config for the Prompt Evaluation Simulator.
 *
 * session.config.json is machine-local (not checked in). It is not a secrets
 * file — provider keys stay in .env. `model` is a provider/model-id ref
 * (e.g. openai/gpt-5.6-luna) and must be listed in `allowedModels`.
 * This module is browser-safe.
 */

import { DEFAULT_MODEL_REF, parseModelRef } from './llm/model-ref.js';

export { DEFAULT_MODEL_REF };

/** Catalog used when `allowedModels` is missing or empty after filtering. */
export const DEFAULT_ALLOWED_MODELS = [
  DEFAULT_MODEL_REF,
  'openai/gpt-5.6-luna',
  'google/gemini-3.6-flash',
  '~deepseek/deepseek-v4-flash-latest',
];

/** UI limits when session.config.json is missing or omits `defaults`. Keep aligned with MIN/MAX_EVAL_* in eval-run and eval-compare. */
export const FALLBACK_DEFAULTS = {
  minRuns: 1,
  maxRuns: 5,
  minCases: 1,
  maxCases: 5,
};

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function parseOptionalInt(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clampInt(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Resolve a min/max pair. Invalid or inverted bounds fall back to the built-in range.
 * @param {unknown} rawMin
 * @param {unknown} rawMax
 * @param {number} fallbackMin
 * @param {number} fallbackMax
 * @returns {{ min: number, max: number }}
 */
function resolveBoundPair(rawMin, rawMax, fallbackMin, fallbackMax) {
  const parsedMin = parseOptionalInt(rawMin);
  const parsedMax = parseOptionalInt(rawMax);
  const min = parsedMin === undefined
    ? fallbackMin
    : clampInt(parsedMin, fallbackMin, fallbackMax);
  const max = parsedMax === undefined
    ? fallbackMax
    : clampInt(parsedMax, fallbackMin, fallbackMax);
  if (min > max) return { min: fallbackMin, max: fallbackMax };
  return { min, max };
}

/**
 * @param {unknown} raw
 * @returns {{ input: string, expectedAnswer: string }[]}
 */
function normalizeCases(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c) => ({
      input: typeof c.input === 'string' ? c.input : '',
      expectedAnswer: typeof c.expectedAnswer === 'string' ? c.expectedAnswer : '',
    }));
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeAllowedModels(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_ALLOWED_MODELS];
  const seen = new Set();
  /** @type {string[]} */
  const models = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    try {
      parseModelRef(trimmed);
    } catch {
      continue;
    }
    seen.add(trimmed);
    models.push(trimmed);
  }
  return models.length > 0 ? models : [...DEFAULT_ALLOWED_MODELS];
}

/**
 * @param {unknown} modelRef
 * @returns {{ provider: string, modelId: string } | null}
 */
function tryParseModelRef(modelRef) {
  if (typeof modelRef !== 'string' || !modelRef.trim()) return null;
  try {
    const parsed = parseModelRef(modelRef);
    return { provider: parsed.provider, modelId: parsed.modelId };
  } catch {
    return null;
  }
}

/**
 * @param {string} model
 * @param {string[]} allowedModels
 */
export function assertAllowedModel(model, allowedModels) {
  if (!findAllowedModel(model, allowedModels)) {
    const err = new Error(`Model "${model}" is not in allowedModels`);
    err.code = 'LLM_MODEL_NOT_ALLOWED';
    throw err;
  }
}

/**
 * Return the raw allowlist entry equivalent to a requested model ref.
 * @param {string} model
 * @param {string[]} allowedModels
 * @returns {string | undefined}
 */
export function findAllowedModel(model, allowedModels) {
  const requested = tryParseModelRef(model);
  if (!Array.isArray(allowedModels) || !requested) return undefined;
  return allowedModels.find((item) => {
    const parsed = tryParseModelRef(item);
    return parsed != null
      && parsed.provider === requested.provider
      && parsed.modelId === requested.modelId;
  });
}

/**
 * @param {unknown} rawModel
 * @param {string[]} allowedModels
 * @returns {string}
 */
function resolveConfiguredModel(rawModel, allowedModels) {
  const model = typeof rawModel === 'string' && rawModel.trim()
    ? rawModel.trim()
    : '';
  if (model) return model;
  if (allowedModels.includes(DEFAULT_MODEL_REF)) return DEFAULT_MODEL_REF;
  return allowedModels[0];
}

/**
 * Normalize a raw session.config.json object into a complete payload.
 * Missing or invalid fields use empty initial-session values and FALLBACK_DEFAULTS.
 * `model` is only defaulted when omitted; a provided value is kept even if it is
 * not in `allowedModels` so eval can reject the mismatch.
 * @param {unknown} raw
 * @returns {{
 *   model: string,
 *   allowedModels: string[],
 *   allowUserModelSelection: boolean,
 *   defaults: { minRuns: number, maxRuns: number, minCases: number, maxCases: number },
 *   initialSession: { promptA: string, promptB: string, cases: { input: string, expectedAnswer: string }[] },
 * }}
 */
export function normalizeSessionConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const allowedModels = normalizeAllowedModels(src.allowedModels);
  const model = resolveConfiguredModel(src.model, allowedModels);
  const defaultsSrc = src.defaults && typeof src.defaults === 'object' && !Array.isArray(src.defaults)
    ? src.defaults
    : {};
  const sessionSrc = src.initialSession && typeof src.initialSession === 'object' && !Array.isArray(src.initialSession)
    ? src.initialSession
    : {};

  const runs = resolveBoundPair(
    defaultsSrc.minRuns,
    defaultsSrc.maxRuns,
    FALLBACK_DEFAULTS.minRuns,
    FALLBACK_DEFAULTS.maxRuns,
  );
  const caseBounds = resolveBoundPair(
    defaultsSrc.minCases,
    defaultsSrc.maxCases,
    FALLBACK_DEFAULTS.minCases,
    FALLBACK_DEFAULTS.maxCases,
  );

  return {
    model,
    allowedModels,
    allowUserModelSelection: src.allowUserModelSelection === true,
    defaults: {
      minRuns: runs.min,
      maxRuns: runs.max,
      minCases: caseBounds.min,
      maxCases: caseBounds.max,
    },
    initialSession: {
      promptA: typeof sessionSrc.promptA === 'string' ? sessionSrc.promptA : '',
      promptB: typeof sessionSrc.promptB === 'string' ? sessionSrc.promptB : '',
      cases: normalizeCases(sessionSrc.cases).slice(0, caseBounds.max),
    },
  };
}
