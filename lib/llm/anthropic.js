/**
 * Anthropic Messages API provider.
 *
 * Configured from ANTHROPIC_API_KEY and optional ANTHROPIC_BASE_URL /
 * ANTHROPIC_MODEL. Model ids may still use the Octavus-style
 * `anthropic/claude-…` prefix; it is stripped before the API call.
 */

import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

/**
 * Strip a leading `anthropic/` provider prefix from a model id.
 * @param {string} [modelId]
 * @returns {string}
 */
export function normalizeAnthropicModelId(modelId = '') {
  return String(modelId).trim().replace(/^anthropic\//, '');
}

/**
 * @param {import('@anthropic-ai/sdk').Message} message
 * @returns {string}
 */
export function extractMessageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('./types.js').LlmProvider}
 */
export function createAnthropicProvider(env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY is not configured');
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }

  const baseURL = typeof env.ANTHROPIC_BASE_URL === 'string' && env.ANTHROPIC_BASE_URL.trim()
    ? env.ANTHROPIC_BASE_URL.trim()
    : undefined;
  const model = normalizeAnthropicModelId(env.ANTHROPIC_MODEL) || DEFAULT_ANTHROPIC_MODEL;

  const client = new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  return {
    name: 'anthropic',
    model,
    /**
     * @param {import('./types.js').LlmCompleteRequest} req
     * @returns {Promise<import('./types.js').LlmCompleteResult>}
     */
    async complete(req) {
      const resolvedModel = normalizeAnthropicModelId(req.model) || model;
      /** @type {import('@anthropic-ai/sdk').MessageCreateParams} */
      const params = {
        model: resolvedModel,
        max_tokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
        messages: req.messages,
      };
      if (typeof req.system === 'string' && req.system) {
        params.system = req.system;
      }
      if (typeof req.temperature === 'number' && Number.isFinite(req.temperature)) {
        params.temperature = req.temperature;
      }

      const message = await client.messages.create(params);
      const requestId = message?._request_id;
      return {
        text: extractMessageText(message),
        requestId: typeof requestId === 'string' ? requestId : undefined,
      };
    },
  };
}
