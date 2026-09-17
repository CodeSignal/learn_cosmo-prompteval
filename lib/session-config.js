/**
 * Local session config for the Prompt Evaluation Simulator.
 *
 * session.config.json is machine-local (not checked in). It is not a secrets
 * file — provider keys stay in .env. `model` is a provider/model-id ref
 * (e.g. openai/gpt-5.6-luna) and must be listed in `allowedModels`.
 * This module is browser-safe.
 */

import { normalizeConcurrency } from './concurrency.js';
import { DEFAULT_MODEL_REF, parseModelRef } from './llm/model-ref.js';
import {
  DEFAULT_ALLOWED_METRIC_IDS,
  isValidMetricId,
} from './metrics/index.js';
import { findPromptPlaceholders } from './prompt-render.js';

export { DEFAULT_MODEL_REF };
export { DEFAULT_ALLOWED_METRIC_IDS };

/** Catalog used when `allowedModels` is missing or empty after filtering. */
export const DEFAULT_ALLOWED_MODELS = [
  DEFAULT_MODEL_REF,
  'openai/gpt-5.6-luna',
  'google/gemini-3.6-flash',
  '~deepseek/deepseek-v4-flash-latest',
];

/** UI limits when session.config.json is missing or omits `defaults`. Keep aligned with MIN/MAX_EVAL_* in eval-run and eval-compare. */
export const FALLBACK_DEFAULTS = {
  runs: 2,
  minRuns: 1,
  maxRuns: 5,
  minCases: 1,
  maxCases: 5,
};

export const DEFAULT_PROMPT_TEMPLATING = {
  enabled: false,
  templateEditable: false,
  showPreview: false,
  allowExamples: false,
  fields: [],
  variableNames: [],
  dynamicFields: false,
  strictFields: false,
  builder: {
    enabled: false,
    availableComponents: [],
    defaultComponents: [],
    allowMultipleInputs: false,
    showExpectedAnswer: false,
  },
};

const TEMPLATE_VARIABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const OPTIONAL_PROMPT_COMPONENTS = ['context', 'examples', 'constraints', 'outputFormat'];
const RESERVED_TEMPLATE_VARIABLES = new Set([
  'examples',
  '__proto__',
  'prototype',
  'constructor',
]);

function defaultFieldLabel(name) {
  return name
    .replace(/_/gu, ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function normalizeTemplateFields(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const fields = [];
  for (const item of raw) {
    const source = typeof item === 'string' ? { name: item } : item;
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (
      !TEMPLATE_VARIABLE_RE.test(name)
      || RESERVED_TEMPLATE_VARIABLES.has(name)
      || seen.has(name)
    ) {
      continue;
    }
    seen.add(name);
    fields.push({
      name,
      label: typeof source.label === 'string' && source.label.trim()
        ? source.label.trim()
        : defaultFieldLabel(name),
      multiline: source.multiline !== false,
    });
    if (fields.length >= 8) break;
  }
  return fields;
}

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
 * @param {string[]} variableNames
 * @param {boolean} templatingEnabled
 * @returns {Array<{ input: string, expectedAnswer: string, variables?: Record<string, string> }>}
 */
function normalizeCases(raw, variableNames = [], templatingEnabled = false) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c) => ({
      input: typeof c.input === 'string' ? c.input : '',
      expectedAnswer: typeof c.expectedAnswer === 'string' ? c.expectedAnswer : '',
      ...(templatingEnabled
        ? {
          variables: Object.fromEntries(variableNames.map((name) => [
            name,
            typeof c.variables?.[name] === 'string' ? c.variables[name] : '',
          ])),
        }
        : {}),
    }));
}

/**
 * @param {unknown} raw
 * @returns {typeof DEFAULT_PROMPT_TEMPLATING}
 */
export function normalizePromptTemplating(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const enabled = src.enabled === true;
  const builderSrc = src.builder && typeof src.builder === 'object' && !Array.isArray(src.builder)
    ? src.builder
    : {};
  const builderEnabled = enabled && builderSrc.enabled === true;
  const dynamicFields = enabled && src.dynamicFields === true;
  const availableComponents = builderEnabled
    ? OPTIONAL_PROMPT_COMPONENTS.filter((id) => (
      !Array.isArray(builderSrc.availableComponents)
      || builderSrc.availableComponents.includes(id)
    ))
    : [];
  const defaultComponents = availableComponents.filter((id) => (
    Array.isArray(builderSrc.defaultComponents)
    && builderSrc.defaultComponents.includes(id)
  ));
  const fields = normalizeTemplateFields(src.fields);
  const enabledFields = enabled
    ? (fields.length > 0
      ? fields
      : (dynamicFields ? [] : [{ name: 'input', label: 'Input', multiline: true }]))
    : [];
  return {
    enabled,
    templateEditable: enabled && src.templateEditable === true,
    showPreview: enabled && src.showPreview !== false,
    allowExamples: enabled && (
      src.allowExamples === true
      || availableComponents.includes('examples')
    ),
    fields: enabledFields,
    variableNames: enabledFields
      .map((field) => field.name)
      .filter((name) => name !== 'input'),
    dynamicFields,
    strictFields: dynamicFields && src.strictFields === true,
    builder: {
      enabled: builderEnabled,
      availableComponents,
      defaultComponents,
      allowMultipleInputs: builderEnabled && builderSrc.allowMultipleInputs === true,
      showExpectedAnswer: builderEnabled && builderSrc.showExpectedAnswer !== false,
    },
  };
}

/**
 * @param {unknown} raw
 * @returns {Array<{ input: string, idealOutput: string }>}
 */
function normalizeExamples(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((example) => example && typeof example === 'object' && !Array.isArray(example))
    .map((example) => ({
      input: typeof example.input === 'string' ? example.input : '',
      idealOutput: typeof example.idealOutput === 'string' ? example.idealOutput : '',
    }))
    .slice(0, 5);
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
 * Metrics omitted from this allowlist remain unavailable in the UI and API.
 * Missing configuration preserves the original Course 1 metric set.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeAllowedMetricIds(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_ALLOWED_METRIC_IDS];
  const ids = [...new Set(raw
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => isValidMetricId(item)))];
  return ids.length > 0 ? ids : [...DEFAULT_ALLOWED_METRIC_IDS];
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
 *   allowedMetricIds: string[],
 *   llmJudgeModel: string | null,
 *   allowUserModelSelection: boolean,
 *   allowCompare: boolean,
 *   maxConcurrency: number,
 *   features: { promptTemplating: typeof DEFAULT_PROMPT_TEMPLATING },
 *   defaults: { runs: number, minRuns: number, maxRuns: number, minCases: number, maxCases: number },
 *   initialSession: {
 *     promptA: string,
 *     promptB: string,
 *     promptComponents?: { active: string[], instruction: string, context: string, constraints: string, outputFormat: string },
 *     cases: Array<{ input: string, expectedAnswer: string, variables?: Record<string, string> }>,
 *     examples?: Array<{ input: string, idealOutput: string }>,
 *   },
 * }}
 */
export function normalizeSessionConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const allowedModels = normalizeAllowedModels(src.allowedModels);
  const allowedMetricIds = normalizeAllowedMetricIds(src.allowedMetricIds);
  const model = resolveConfiguredModel(src.model, allowedModels);
  const rawJudgeModel = typeof src.llmJudgeModel === 'string'
    ? src.llmJudgeModel.trim()
    : '';
  const llmJudgeModel = tryParseModelRef(rawJudgeModel) ? rawJudgeModel : null;
  const promptTemplating = normalizePromptTemplating(src.features?.promptTemplating);
  const defaultsSrc = src.defaults && typeof src.defaults === 'object' && !Array.isArray(src.defaults)
    ? src.defaults
    : {};
  const sessionSrc = src.initialSession && typeof src.initialSession === 'object' && !Array.isArray(src.initialSession)
    ? src.initialSession
    : {};
  const promptA = typeof sessionSrc.promptA === 'string' ? sessionSrc.promptA : '';
  const promptB = typeof sessionSrc.promptB === 'string' ? sessionSrc.promptB : '';
  const dynamicVariableNames = promptTemplating.dynamicFields
    ? [...new Set([
      ...findPromptPlaceholders(promptA),
      ...findPromptPlaceholders(promptB),
    ])].filter((name) => name !== 'input' && !RESERVED_TEMPLATE_VARIABLES.has(name))
    : promptTemplating.variableNames;

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
  const defaultRuns = clampInt(
    parseOptionalInt(defaultsSrc.runs) ?? FALLBACK_DEFAULTS.runs,
    runs.min,
    runs.max,
  );
  const componentSrc = sessionSrc.promptComponents
    && typeof sessionSrc.promptComponents === 'object'
    && !Array.isArray(sessionSrc.promptComponents)
    ? sessionSrc.promptComponents
    : {};
  const activeComponents = promptTemplating.builder.availableComponents.filter((id) => (
    Array.isArray(componentSrc.active)
      ? componentSrc.active.includes(id)
      : promptTemplating.builder.defaultComponents.includes(id)
  ));

  return {
    model,
    allowedModels,
    allowedMetricIds,
    llmJudgeModel,
    allowUserModelSelection: src.allowUserModelSelection === true,
    allowCompare: src.allowCompare === true,
    maxConcurrency: normalizeConcurrency(src.maxConcurrency),
    features: { promptTemplating },
    defaults: {
      runs: defaultRuns,
      minRuns: runs.min,
      maxRuns: runs.max,
      minCases: caseBounds.min,
      maxCases: caseBounds.max,
    },
    initialSession: {
      promptA,
      promptB,
      ...(promptTemplating.builder.enabled
        ? {
          promptComponents: {
            active: activeComponents,
            instruction: typeof componentSrc.instruction === 'string'
              ? componentSrc.instruction
              : '',
            context: typeof componentSrc.context === 'string' ? componentSrc.context : '',
            constraints: typeof componentSrc.constraints === 'string'
              ? componentSrc.constraints
              : '',
            outputFormat: typeof componentSrc.outputFormat === 'string'
              ? componentSrc.outputFormat
              : '',
          },
        }
        : {}),
      cases: normalizeCases(
        sessionSrc.cases,
        dynamicVariableNames,
        promptTemplating.enabled,
      ).slice(0, caseBounds.max),
      ...(promptTemplating.enabled && promptTemplating.allowExamples
        ? { examples: normalizeExamples(sessionSrc.examples) }
        : {}),
    },
  };
}
