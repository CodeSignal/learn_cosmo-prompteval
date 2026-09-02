/**
 * Server-side LLM request logging. Never include API keys.
 *
 * @param {object} details
 * @param {string} details.provider
 * @param {string} details.model
 * @param {string} [details.baseURL]
 * @param {number} [details.temperature]
 * @param {number} [details.max_tokens]
 * @param {number} [details.messageCount]
 */
export function logLlmRequest(details) {
  const settings = {
    provider: details.provider,
    model: details.model,
  };
  if (details.baseURL) settings.baseURL = details.baseURL;
  if (typeof details.temperature === 'number') settings.temperature = details.temperature;
  if (typeof details.max_tokens === 'number') settings.max_tokens = details.max_tokens;
  if (typeof details.messageCount === 'number') settings.messageCount = details.messageCount;
  console.log(`[llm] request ${JSON.stringify(settings)}`);
}

/**
 * Pull safe fields from Anthropic / OpenAI SDK errors. Never include headers
 * or request bodies (those can carry API keys).
 * @param {unknown} err
 * @returns {{ message: string, status?: number, code?: string | number, type?: string, requestId?: string }}
 */
export function summarizeLlmError(err) {
  /** @type {{ message: string, status?: number, code?: string | number, type?: string, requestId?: string }} */
  const out = {
    message: err instanceof Error && err.message ? err.message : 'LLM request failed',
  };
  if (!err || typeof err !== 'object') return out;

  const status = /** @type {{ status?: unknown, statusCode?: unknown }} */ (err);
  if (typeof status.status === 'number') out.status = status.status;
  else if (typeof status.statusCode === 'number') out.status = status.statusCode;

  const extra = /** @type {{ code?: unknown, type?: unknown, requestID?: unknown, request_id?: unknown }} */ (err);
  if (typeof extra.code === 'string' || typeof extra.code === 'number') out.code = extra.code;
  if (typeof extra.type === 'string') out.type = extra.type;
  if (typeof extra.requestID === 'string') out.requestId = extra.requestID;
  else if (typeof extra.request_id === 'string') out.requestId = extra.request_id;
  return out;
}

/**
 * @param {object} details
 * @param {string} details.provider
 * @param {string} details.model
 * @param {string} [details.baseURL]
 * @param {unknown} err
 */
export function logLlmFailure(details, err) {
  const settings = {
    provider: details.provider,
    model: details.model,
    ...summarizeLlmError(err),
  };
  if (details.baseURL) settings.baseURL = details.baseURL;
  console.error(`[llm] error ${JSON.stringify(settings)}`);
}
