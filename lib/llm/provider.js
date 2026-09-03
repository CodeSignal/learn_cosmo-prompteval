/**
 * Resolve an LLM provider from a session model ref (`provider/model-id`).
 *
 * The prefix selects the adapter; the remainder is the API model id
 * (DeepSeek keeps a `~deepseek/` prefix on the wire).
 * API keys and base URLs still come from the environment.
 */

import { createAnthropicProvider } from './anthropic.js';
import { createGeminiProvider } from './gemini.js';
import { parseModelRef } from './model-ref.js';
import { createOpenAiProvider } from './openai.js';

export { DEFAULT_MODEL_REF, parseModelRef, requiredApiKeyName } from './model-ref.js';

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
      return createOpenAiProvider(env, parsed.modelId, {
        name: 'deepseek',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        baseUrlEnv: 'DEEPSEEK_BASE_URL',
      });
    case 'gemini':
      return createGeminiProvider(env, parsed.modelId);
    default: {
      const err = new Error(`Unsupported model provider "${parsed.prefix}"`);
      err.code = 'LLM_UNSUPPORTED_PROVIDER';
      throw err;
    }
  }
}
