/**
 * OpenAI Chat Completions API provider.
 *
 * Configured from OPENAI_API_KEY and optional OPENAI_BASE_URL.
 * Model ids may still use an `openai/` prefix; it is stripped before
 * the API call.
 */

import OpenAI from 'openai';
import { optionalBaseUrl } from './base-url.js';
import { logLlmFailure, logLlmRequest } from './log.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o';

/**
 * Strip a leading `openai/` provider prefix from a model id.
 * @param {string} [modelId]
 * @returns {string}
 */
export function normalizeOpenAiModelId(modelId = '') {
  return String(modelId).trim().replace(/^openai\//, '');
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
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [modelId]
 * @returns {import('./types.js').LlmProvider}
 */
export function createOpenAiProvider(env = process.env, modelId) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }

  const baseURL = optionalBaseUrl(env.OPENAI_BASE_URL, 'OPENAI_BASE_URL');
  const model = normalizeOpenAiModelId(modelId) || DEFAULT_OPENAI_MODEL;

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  return {
    name: 'openai',
    model,
    /**
     * @param {import('./types.js').LlmCompleteRequest} req
     * @returns {Promise<import('./types.js').LlmCompleteResult>}
     */
    async complete(req) {
      const resolvedModel = normalizeOpenAiModelId(req.model) || model;
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
        provider: 'openai',
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
        logLlmFailure({ provider: 'openai', model: resolvedModel, baseURL }, err);
        throw err;
      }
    },
  };
}
