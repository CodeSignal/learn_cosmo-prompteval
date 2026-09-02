/**
 * Optional HTTP(S) base URL. Blank or absent values stay undefined so the SDK
 * default is used. Any configured value must be an http or https URL.
 *
 * @param {unknown} value
 * @param {string} envName
 * @returns {string | undefined}
 */
export function optionalBaseUrl(value, envName) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    const err = new Error(`${envName} must be an http or https URL`);
    err.code = 'LLM_INVALID_BASE_URL';
    throw err;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error(`${envName} must be an http or https URL`);
    err.code = 'LLM_INVALID_BASE_URL';
    throw err;
  }

  return trimmed;
}
