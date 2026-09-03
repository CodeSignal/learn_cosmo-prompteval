/**
 * OpenAI Chat Completions API provider.
 *
 * Configured from OPENAI_API_KEY and optional OPENAI_BASE_URL, or from
 * DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL when used as the DeepSeek
 * OpenAI-compatible host. When both DeepSeek vars are unset, DeepSeek
 * traffic reuses the OpenAI key/URL (production proxy hack in
 * lib/llm/provider.js). OpenAI model ids may still use an `openai/`
 * prefix; it is stripped before the API call. DeepSeek needs the full
 * `~deepseek/…` model name on the wire.
 */

import OpenAI from 'openai';
import { optionalBaseUrl } from './base-url.js';
import { logLlmFailure, logLlmRequest } from './log.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o';

/**
 * Strip a leading `openai/` prefix from a model id.
 * @param {string} [modelId]
 * @returns {string}
 */
export function normalizeOpenAiModelId(modelId = '') {
  return String(modelId).trim().replace(/^openai\//i, '');
}

/**
 * DeepSeek hosts expect the full `~deepseek/…` model name, not a bare id.
 * `deepseek/…` is accepted as an alias and rewritten to `~deepseek/…`.
 * @param {string} [modelId]
 * @returns {string}
 */
export function normalizeDeepSeekModelId(modelId = '') {
  const rest = String(modelId).trim().replace(/^(~deepseek|deepseek)\//i, '');
  return rest ? `~deepseek/${rest}` : '';
}

/**
 * @param {import('openai').OpenAI.Chat.ChatCompletion} completion
 * @returns {string}
 */
export function extractCompletionText(completion) {
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

/**
 * The SDK appends `/chat/completions` to `baseURL`, so a base URL copied from a
 * curl endpoint would double that path. Accept either form.
 * @param {string | undefined} baseURL
 * @returns {string | undefined}
 */
function apiRootBaseUrl(baseURL) {
  if (!baseURL) return undefined;
  return baseURL.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') || undefined;
}

/**
 * @typedef {object} OpenAiCompatOptions
 * @property {string} [name]
 * @property {string} [apiKeyEnv]
 * @property {string} [baseUrlEnv]
 * @property {boolean} [requireBaseUrl]
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [modelId]
 * @param {OpenAiCompatOptions} [options]
 * @returns {import('./types.js').LlmProvider}
 */
export function createOpenAiProvider(env = process.env, modelId, options = {}) {
  const name = options.name || 'openai';
  const apiKeyEnv = options.apiKeyEnv || 'OPENAI_API_KEY';
  const baseUrlEnv = options.baseUrlEnv || 'OPENAI_BASE_URL';
  const apiKey = env[apiKeyEnv];
  if (!apiKey) {
    const err = new Error(`${apiKeyEnv} is not configured`);
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }

  const baseURL = apiRootBaseUrl(optionalBaseUrl(env[baseUrlEnv], baseUrlEnv));
  if (options.requireBaseUrl && !baseURL) {
    const err = new Error(`${baseUrlEnv} is not configured`);
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }
  const normalizeModelId = name === 'deepseek' ? normalizeDeepSeekModelId : normalizeOpenAiModelId;
  const model = normalizeModelId(modelId) || (name === 'deepseek' ? '' : DEFAULT_OPENAI_MODEL);

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  return {
    name,
    model,
    /**
     * @param {import('./types.js').LlmCompleteRequest} req
     * @returns {Promise<import('./types.js').LlmCompleteResult>}
     */
    async complete(req) {
      const resolvedModel = normalizeModelId(req.model) || model;
      /** @type {import('openai').OpenAI.Chat.ChatCompletionMessageParam[]} */
      const messages = [];
      if (typeof req.system === 'string' && req.system) {
        messages.push({ role: 'system', content: req.system });
      }
      if (Array.isArray(req.messages)) {
        messages.push(...req.messages);
      }

      /** @type {import('openai').OpenAI.Chat.ChatCompletionCreateParamsNonStreaming} */
      const params = {
        model: resolvedModel,
        messages,
      };
      if (typeof req.temperature === 'number' && Number.isFinite(req.temperature)) {
        params.temperature = req.temperature;
      }

      logLlmRequest({
        provider: name,
        model: resolvedModel,
        baseURL,
        temperature: params.temperature,
        messageCount: messages.length,
      });
      try {
        const completion = await client.chat.completions.create(params);
        return {
          text: extractCompletionText(completion),
          requestId: typeof completion?.id === 'string' ? completion.id : undefined,
        };
      } catch (err) {
        logLlmFailure({ provider: name, model: resolvedModel, baseURL }, err);
        throw err;
      }
    },
  };
}
