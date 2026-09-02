/**
 * Resolve an LLM provider from environment variables.
 *
 * LLM_PROVIDER selects the adapter (default: anthropic). Additional
 * providers can be added to the switch without changing eval-run.
 */

import { createAnthropicProvider } from './anthropic.js';
import { createOpenAiProvider } from './openai.js';

/**
 * Env var that must be set for the selected provider.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function requiredApiKeyName(env = process.env) {
  const name = String(env.LLM_PROVIDER ?? 'anthropic').trim().toLowerCase() || 'anthropic';
  if (name === 'openai') return 'OPENAI_API_KEY';
  return 'ANTHROPIC_API_KEY';
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('./types.js').LlmProvider}
 */
export function createLlmProvider(env = process.env) {
  const name = String(env.LLM_PROVIDER ?? 'anthropic').trim().toLowerCase() || 'anthropic';

  switch (name) {
    case 'anthropic':
      return createAnthropicProvider(env);
    case 'openai':
      return createOpenAiProvider(env);
    default: {
      const err = new Error(`Unsupported LLM_PROVIDER "${name}"`);
      err.code = 'LLM_UNSUPPORTED_PROVIDER';
      throw err;
    }
  }
}
