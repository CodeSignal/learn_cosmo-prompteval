/**
 * Shared JSDoc contract for LLM providers.
 *
 * New providers (OpenAI, etc.) should implement `LlmProvider.complete`.
 */

/**
 * @typedef {object} LlmMessage
 * @property {'user' | 'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {object} LlmCompleteRequest
 * @property {string} model
 * @property {string} [system]
 * @property {LlmMessage[]} messages
 * @property {number} [temperature]
 * @property {'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'} [reasoningEffort] OpenAI reasoning models only; other providers ignore it
 */

/**
 * @typedef {object} LlmCompleteResult
 * @property {string} text
 * @property {string} [requestId]
 */

/**
 * @typedef {object} LlmProvider
 * @property {string} name
 * @property {string} model
 * @property {(req: LlmCompleteRequest) => Promise<LlmCompleteResult>} complete
 */

export {};
