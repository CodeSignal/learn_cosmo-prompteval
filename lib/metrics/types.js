/**
 * Metric interface (milestone 2+).
 *
 * Each metric exports:
 *   { id, name, description, score(output, expected) => number }
 *
 * Scores are always in [0, 1]. Register new evaluators (e.g. semantic
 * similarity) by adding a module and listing it in index.js — no other
 * plumbing changes required.
 */

/**
 * @typedef {object} Metric
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {(output: string, expected: string) => number} score
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Clamp a numeric score into [0, 1].
 * @param {number} n
 * @returns {number}
 */
export function clampScore(n) {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}
