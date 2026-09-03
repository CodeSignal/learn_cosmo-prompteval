/**
 * Parse a session model ref (`provider/model-id`) into a routed provider.
 *
 * Browser-safe — no SDK imports. Prefix aliases:
 *   anthropic/…     → anthropic
 *   openai/…        → openai
 *   google/…        → gemini
 *   gemini/…        → gemini
 *   deepseek/…      → deepseek (OpenAI-compatible)
 *   ~deepseek/…     → deepseek (OpenAI-compatible)
 *   deepseek-ai/…   → deepseek (OpenAI-compatible)
 */

export const DEFAULT_MODEL_REF = 'anthropic/claude-sonnet-4-6';

/** @type {Record<string, { name: string, apiKeyName: string }>} */
const PROVIDERS = {
  anthropic: { name: 'anthropic', apiKeyName: 'ANTHROPIC_API_KEY' },
  openai: { name: 'openai', apiKeyName: 'OPENAI_API_KEY' },
  google: { name: 'gemini', apiKeyName: 'GOOGLE_API_KEY' },
  gemini: { name: 'gemini', apiKeyName: 'GOOGLE_API_KEY' },
  deepseek: { name: 'deepseek', apiKeyName: 'DEEPSEEK_API_KEY' },
  'deepseek-ai': { name: 'deepseek', apiKeyName: 'DEEPSEEK_API_KEY' },
};

/**
 * @typedef {object} ParsedModelRef
 * @property {string} provider
 * @property {string} modelId
 * @property {string} prefix
 * @property {string} modelPrefix
 * @property {string} raw
 * @property {string} apiKeyName
 */

/**
 * @param {string} raw
 * @param {string} [code]
 * @returns {Error}
 */
function modelRefError(raw, code = 'LLM_INVALID_MODEL') {
  const err = new Error(
    code === 'LLM_UNSUPPORTED_PROVIDER'
      ? `Unsupported model provider "${raw}"`
      : `Model must use provider/model-id format (e.g. openai/gpt-5.6-luna), got "${raw}"`,
  );
  err.code = code;
  return err;
}

/**
 * @param {unknown} [modelRef]
 * @returns {ParsedModelRef}
 */
export function parseModelRef(modelRef) {
  const raw = String(modelRef ?? '').trim() || DEFAULT_MODEL_REF;
  const slash = raw.indexOf('/');
  if (slash <= 0 || slash === raw.length - 1) {
    throw modelRefError(raw);
  }

  const modelPrefix = raw.slice(0, slash).trim();
  const prefix = modelPrefix.toLowerCase().replace(/^~/, '');
  const modelId = raw.slice(slash + 1).trim();
  if (!prefix || !modelId) {
    throw modelRefError(raw);
  }

  const provider = PROVIDERS[prefix];
  if (!provider) {
    throw modelRefError(prefix, 'LLM_UNSUPPORTED_PROVIDER');
  }

  return {
    provider: provider.name,
    modelId,
    prefix,
    modelPrefix,
    raw,
    apiKeyName: provider.apiKeyName,
  };
}

/**
 * Env var that must be set for the provider in a model ref.
 * @param {unknown} [modelRef]
 * @returns {string}
 */
export function requiredApiKeyName(modelRef = DEFAULT_MODEL_REF) {
  return parseModelRef(modelRef).apiKeyName;
}
