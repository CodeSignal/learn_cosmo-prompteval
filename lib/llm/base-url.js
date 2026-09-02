/**
 * Optional HTTPS base URL. Blank or absent values stay undefined so the SDK
 * default is used. Any configured value must be an https URL.
 *
 * @param {unknown} value
 * @param {string} envName
 * @returns {string | undefined}
 */
export function optionalHttpsBaseUrl(value, envName) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    const err = new Error(`${envName} must be an https URL`);
    err.code = 'LLM_INSECURE_BASE_URL';
    throw err;
  }

  if (parsed.protocol !== 'https:') {
    const err = new Error(`${envName} must use HTTPS`);
    err.code = 'LLM_INSECURE_BASE_URL';
    throw err;
  }

  return trimmed;
}
