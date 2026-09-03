/**
 * Resolve an LLM provider from a session model ref (`provider/model-id`).
 *
 * The prefix selects the adapter; the remainder is the API model id
 * (DeepSeek keeps a `~deepseek/` prefix on the wire).
 * API keys and base URLs still come from the environment.
 */

import { createAnthropicProvider } from './anthropic.js';
import { createGeminiProvider } from './gemini.js';
import { parseModelRef, requiredApiKeyName as catalogApiKeyName } from './model-ref.js';
import { createOpenAiProvider } from './openai.js';

export { DEFAULT_MODEL_REF, parseModelRef } from './model-ref.js';

/**
 * True when an env var is actually configured (not missing, empty, or whitespace).
 * @param {unknown} value
 * @returns {boolean}
 */
function envVarIsSet(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * PRODUCTION HACK — CodeSignal prod proxy.
 *
 * In production, DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL are left empty on
 * purpose. The OpenAI base URL is not api.openai.com; it is an internal
 * proxy that routes by model name, including `~deepseek/…`.
 *
 * This fallback is safe ONLY when both DeepSeek vars are unset/blank. If
 * either is set, the operator meant a dedicated DeepSeek (or OpenRouter)
 * endpoint and we must not silently send that traffic to OPENAI_*.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function shouldFallbackDeepSeekToOpenAi(env = process.env) {
  return !envVarIsSet(env.DEEPSEEK_API_KEY) && !envVarIsSet(env.DEEPSEEK_BASE_URL);
}

/**
 * Env var that must be set for the provider in a model ref.
 * DeepSeek uses OPENAI_API_KEY under the production-hack fallback above.
 *
 * @param {unknown} [modelRef]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function requiredApiKeyName(modelRef, env = process.env) {
  const parsed = parseModelRef(modelRef);
  if (parsed.provider === 'deepseek' && shouldFallbackDeepSeekToOpenAi(env)) {
    return 'OPENAI_API_KEY';
  }
  return catalogApiKeyName(modelRef);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} modelId
 * @returns {import('./types.js').LlmProvider}
 */
function createDeepSeekProvider(env, modelId) {
  // PRODUCTION HACK: see shouldFallbackDeepSeekToOpenAi(). Dedicated DeepSeek
  // credentials win; otherwise reuse the OpenAI proxy key/URL.
  const fallback = shouldFallbackDeepSeekToOpenAi(env);
  return createOpenAiProvider(env, modelId, {
    name: 'deepseek',
    apiKeyEnv: fallback ? 'OPENAI_API_KEY' : 'DEEPSEEK_API_KEY',
    baseUrlEnv: fallback ? 'OPENAI_BASE_URL' : 'DEEPSEEK_BASE_URL',
  });
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [modelRef]
 * @returns {import('./types.js').LlmProvider}
 */
export function createLlmProvider(env = process.env, modelRef) {
  const parsed = parseModelRef(modelRef);

  switch (parsed.provider) {
    case 'anthropic':
      return createAnthropicProvider(env, parsed.modelId);
    case 'openai':
      return createOpenAiProvider(env, parsed.modelId);
    case 'deepseek':
      return createDeepSeekProvider(env, parsed.modelId);
    case 'gemini':
      return createGeminiProvider(env, parsed.modelId);
    default: {
      const err = new Error(`Unsupported model provider "${parsed.prefix}"`);
      err.code = 'LLM_UNSUPPORTED_PROVIDER';
      throw err;
    }
  }
}
