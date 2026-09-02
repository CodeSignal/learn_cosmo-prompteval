/**
 * Local session config for the Prompt Evaluation Simulator.
 *
 * session.config.json is machine-local (not checked in). It is not a secrets
 * file — provider keys stay in .env. This module is browser-safe.
 */

/** UI limits when session.config.json is missing or omits `defaults`. Keep aligned with MIN/MAX_EVAL_* in eval-run and eval-compare. */
export const FALLBACK_DEFAULTS = {
  minRuns: 1,
  maxRuns: 5,
  minCases: 1,
  maxCases: 5,
};

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function parseOptionalInt(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clampInt(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Resolve a min/max pair. Invalid or inverted bounds fall back to the built-in range.
 * @param {unknown} rawMin
 * @param {unknown} rawMax
 * @param {number} fallbackMin
 * @param {number} fallbackMax
 * @returns {{ min: number, max: number }}
 */
function resolveBoundPair(rawMin, rawMax, fallbackMin, fallbackMax) {
  const parsedMin = parseOptionalInt(rawMin);
  const parsedMax = parseOptionalInt(rawMax);
  const min = parsedMin === undefined
    ? fallbackMin
    : clampInt(parsedMin, fallbackMin, fallbackMax);
  const max = parsedMax === undefined
    ? fallbackMax
    : clampInt(parsedMax, fallbackMin, fallbackMax);
  if (min > max) return { min: fallbackMin, max: fallbackMax };
  return { min, max };
}

/**
 * @param {unknown} raw
 * @returns {{ input: string, expectedAnswer: string }[]}
 */
function normalizeCases(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c) => ({
      input: typeof c.input === 'string' ? c.input : '',
      expectedAnswer: typeof c.expectedAnswer === 'string' ? c.expectedAnswer : '',
    }));
}

/**
 * Normalize a raw session.config.json object into a complete payload.
 * Missing or invalid fields use empty initial-session values and FALLBACK_DEFAULTS.
 * @param {unknown} raw
 * @returns {{
 *   defaults: { minRuns: number, maxRuns: number, minCases: number, maxCases: number },
 *   initialSession: { promptA: string, promptB: string, cases: { input: string, expectedAnswer: string }[] },
 * }}
 */
export function normalizeSessionConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const defaultsSrc = src.defaults && typeof src.defaults === 'object' && !Array.isArray(src.defaults)
    ? src.defaults
    : {};
  const sessionSrc = src.initialSession && typeof src.initialSession === 'object' && !Array.isArray(src.initialSession)
    ? src.initialSession
    : {};

  const runs = resolveBoundPair(
    defaultsSrc.minRuns,
    defaultsSrc.maxRuns,
    FALLBACK_DEFAULTS.minRuns,
    FALLBACK_DEFAULTS.maxRuns,
  );
  const caseBounds = resolveBoundPair(
    defaultsSrc.minCases,
    defaultsSrc.maxCases,
    FALLBACK_DEFAULTS.minCases,
    FALLBACK_DEFAULTS.maxCases,
  );

  return {
    defaults: {
      minRuns: runs.min,
      maxRuns: runs.max,
      minCases: caseBounds.min,
      maxCases: caseBounds.max,
    },
    initialSession: {
      promptA: typeof sessionSrc.promptA === 'string' ? sessionSrc.promptA : '',
      promptB: typeof sessionSrc.promptB === 'string' ? sessionSrc.promptB : '',
      cases: normalizeCases(sessionSrc.cases),
    },
  };
}
