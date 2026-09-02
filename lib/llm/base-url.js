/**
 * Optional HTTPS base URL. Blank or absent values stay undefined so the SDK
 * default is used. Any configured value must be an https URL. When
 * `allowedHosts` is set, the hostname must match one of those exact hosts
 * or a `*.suffix` / `*-suffix` pattern.
 *
 * @param {unknown} value
 * @param {string} envName
 * @param {{ allowedHosts?: string[] }} [options]
 * @returns {string | undefined}
 */
export function optionalHttpsBaseUrl(value, envName, options = {}) {
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

  const allowedHosts = options.allowedHosts;
  if (Array.isArray(allowedHosts) && allowedHosts.length > 0) {
    const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();
    if (!hostMatchesAllowlist(hostname, allowedHosts)) {
      const err = new Error(`${envName} must be an approved HTTPS endpoint`);
      err.code = 'LLM_UNAPPROVED_BASE_URL';
      throw err;
    }
  }

  return trimmed;
}

/**
 * @param {string} hostname
 * @param {string[]} allowedHosts
 * @returns {boolean}
 */
function hostMatchesAllowlist(hostname, allowedHosts) {
  return allowedHosts.some((rule) => {
    const allowed = String(rule).trim().toLowerCase();
    if (!allowed) return false;
    if (allowed.startsWith('*.') || allowed.startsWith('*-')) {
      const suffix = allowed.slice(1);
      return hostname === allowed.slice(2) || hostname.endsWith(suffix);
    }
    return hostname === allowed;
  });
}
