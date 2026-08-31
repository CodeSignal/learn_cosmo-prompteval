import { clampScore, normalizeText } from './types.js';

/**
 * Classic Levenshtein edit distance (insert / delete / substitute).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  /** @type {number[]} */
  let prev = new Array(b.length + 1);
  /** @type {number[]} */
  let curr = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/**
 * Simple string similarity: 1 − (editDistance / maxLength).
 * Returns a continuous score in [0, 1] — useful when exact match is too strict.
 */
export default {
  id: 'string-similarity',
  name: 'Simple string similarity',
  description:
    'Levenshtein-based similarity: 1 means identical (after trimming), 0 means maximally different.',
  score(output, expected) {
    const a = normalizeText(output);
    const b = normalizeText(expected);
    if (b === '' && a === '') return 1;
    if (b === '' || a === '') return 0;
    const maxLen = Math.max(a.length, b.length);
    const distance = levenshteinDistance(a, b);
    return clampScore(1 - distance / maxLen);
  },
};
