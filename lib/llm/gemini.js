/**
 * Google Gemini generateContent provider.
 *
 * Configured from GOOGLE_API_KEY and optional GOOGLE_BASE_URL /
 * GOOGLE_MODEL. Model ids may still use a `google/` or `gemini/`
 * prefix; it is stripped before the API call.
 */

import { GoogleGenAI } from '@google/genai';
import { logLlmFailure, logLlmRequest } from './log.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Strip a leading `google/` or `gemini/` provider prefix from a model id.
 * @param {string} [modelId]
 * @returns {string}
 */
export function normalizeGeminiModelId(modelId = '') {
  return String(modelId).trim().replace(/^(google|gemini)\//, '');
}

/**
 * @param {{ text?: string, candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>, responseId?: string }} response
 * @returns {string}
 */
export function extractGenerateText(response) {
  if (typeof response?.text === 'string' && response.text) return response.text;
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('');
}

/**
 * Map our chat roles onto Gemini content roles (`user` / `model`).
 * @param {import('./types.js').LlmMessage[]} messages
 * @returns {Array<{ role: 'user' | 'model', parts: Array<{ text: string }> }>}
 */
export function toGeminiContents(messages = []) {
  return messages
    .filter((m) => m && typeof m.content === 'string')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('./types.js').LlmProvider}
 */
export function createGeminiProvider(env = process.env) {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) {
    const err = new Error('GOOGLE_API_KEY is not configured');
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }

  const baseURL = typeof env.GOOGLE_BASE_URL === 'string' && env.GOOGLE_BASE_URL.trim()
    ? env.GOOGLE_BASE_URL.trim()
    : undefined;
  const model = normalizeGeminiModelId(env.GOOGLE_MODEL) || DEFAULT_GEMINI_MODEL;

  const client = new GoogleGenAI({
    apiKey,
    ...(baseURL ? { httpOptions: { baseUrl: baseURL } } : {}),
  });

  return {
    name: 'gemini',
    model,
    /**
     * @param {import('./types.js').LlmCompleteRequest} req
     * @returns {Promise<import('./types.js').LlmCompleteResult>}
     */
    async complete(req) {
      const resolvedModel = normalizeGeminiModelId(req.model) || model;
      const contents = toGeminiContents(req.messages);
      /** @type {Record<string, unknown>} */
      const config = {};
      if (typeof req.system === 'string' && req.system) {
        config.systemInstruction = req.system;
      }
      if (typeof req.temperature === 'number' && Number.isFinite(req.temperature)) {
        config.temperature = req.temperature;
      }

      logLlmRequest({
        provider: 'gemini',
        model: resolvedModel,
        baseURL,
        temperature: config.temperature,
        messageCount: contents.length,
      });
      try {
        const response = await client.models.generateContent({
          model: resolvedModel,
          contents,
          ...(Object.keys(config).length > 0 ? { config } : {}),
        });
        return {
          text: extractGenerateText(response),
          requestId: typeof response?.responseId === 'string' ? response.responseId : undefined,
        };
      } catch (err) {
        logLlmFailure({ provider: 'gemini', model: resolvedModel, baseURL }, err);
        throw err;
      }
    },
  };
}
