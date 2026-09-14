/**
 * Bounded in-flight pool for independent async work (eval LLM calls).
 */

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 50;
export const DEFAULT_CONCURRENCY = 4;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeConcurrency(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, n));
}

/**
 * @param {unknown} max
 * @returns {{ concurrency: number, schedule: <T>(fn: () => T | Promise<T>) => Promise<T> }}
 */
export function createConcurrencyLimiter(max) {
  const concurrency = normalizeConcurrency(max);
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];

  /**
   * @template T
   * @param {() => T | Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function schedule(fn) {
    while (active >= concurrency) {
      await new Promise((resolve) => {
        queue.push(resolve);
      });
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    }
  }

  return { concurrency, schedule };
}
