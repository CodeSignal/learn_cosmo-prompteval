/**
 * OpenAI Chat Completions API provider.
 *
 * Configured from OPENAI_API_KEY and optional OPENAI_BASE_URL, or from
 * DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL when used as the DeepSeek
 * OpenAI-compatible host. When both DeepSeek vars are unset, DeepSeek
 * traffic reuses the OpenAI key/URL (production proxy hack in
 * lib/llm/provider.js). OpenAI model ids may still use an `openai/`
 * prefix; it is stripped before the API call. DeepSeek preserves the
 * `deepseek/`, `~deepseek/`, or `deepseek-ai/` prefix supplied by the caller.
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
 * DeepSeek hosts expect the full prefixed model name, not a bare id.
 * Preserve whether the caller supplied `deepseek/`, `~deepseek/`, or
 * `deepseek-ai/`.
 * @param {string} [modelId]
 * @returns {string}
 */
export function normalizeDeepSeekModelId(modelId = '') {
  const value = String(modelId).trim();
  const match = value.match(/^(~deepseek|deepseek|deepseek-ai)\//i);
  if (match) return `${match[1]}/${value.slice(match[0].length)}`;
  return value ? `~deepseek/${value}` : '';
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

  /** Optional params a LiteLLM-style proxy accepted once listed in allowed_openai_params. */
  const allowedProxyParams = new Set();

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
      if (req.reasoningEffort) {
        params.reasoning_effort = req.reasoningEffort;
      }

      logLlmRequest({
        provider: name,
        model: resolvedModel,
        baseURL,
        temperature: params.temperature,
        messageCount: messages.length,
      });
      try {
        let completion;
        let attempt = allowedProxyParams.size > 0 && params.reasoning_effort !== undefined
          ? { ...params, allowed_openai_params: ['reasoning_effort'] }
          : params;
        // Reasoning models accept only the default temperature. A LiteLLM
        // proxy without drop_params rejects reasoning_effort for models it
        // doesn't know unless the request lists it in allowed_openai_params,
        // so allow it once (and remember that for this provider); any other
        // rejected optional parameter is dropped instead of failing the run.
        for (;;) {
          try {
            completion = await client.chat.completions.create(attempt);
            break;
          } catch (err) {
            const rejected = ['temperature', 'reasoning_effort']
              .find((name) => attempt[name] !== undefined && isUnsupportedParameterError(err, name));
            if (!rejected) throw err;
            if (!attempt.allowed_openai_params && isProxyAllowParamsHint(err)) {
              allowedProxyParams.add(rejected);
              attempt = { ...attempt, allowed_openai_params: [rejected] };
              continue;
            }
            const { [rejected]: _dropped, allowed_openai_params: _allowed, ...rest } = attempt;
            attempt = rest;
          }
        }
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

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isUnsupportedParameterError(err, name) {
  const status = /** @type {{ status?: number }} */ (err)?.status;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return status === 400
    && message.toLowerCase().includes(name)
    && /unsupported|not support|unrecognized|unknown parameter|does not support/iu.test(message);
}

/**
 * LiteLLM explains how to pass a parameter it doesn't know for a model.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isProxyAllowParamsHint(err) {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /allowed_openai_params/u.test(message);
}

export function isUnsupportedTemperatureError(err) {
  return isUnsupportedParameterError(err, 'temperature');
}
