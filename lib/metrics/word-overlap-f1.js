import { clampScore, normalizeText } from './types.js';

/**
 * Split into lowercase word tokens (letters/digits). Punctuation is ignored.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeWords(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return [];
  return normalized.match(/[a-z0-9]+/gi)?.map((t) => t.toLowerCase()) ?? [];
}

/**
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function toCounts(tokens) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/**
 * Multiset overlap size: sum of min(count in A, count in B) per token.
 * @param {Map<string, number>} a
 * @param {Map<string, number>} b
 * @returns {number}
 */
function overlapSize(a, b) {
  let n = 0;
  for (const [token, countA] of a) {
    const countB = b.get(token);
    if (countB) n += Math.min(countA, countB);
  }
  return n;
}

/**
 * Word-overlap F1: balances how much of the expected answer appears in the
 * output (recall) vs how much of the output is relevant (precision).
 */
export default {
  id: 'word-overlap-f1',
  name: 'Word overlap (F1)',
  description:
    'Token F1 over words: rewards partial matches when wording differs but key words overlap.',
  score(output, expected) {
    const outTokens = tokenizeWords(output);
    const expTokens = tokenizeWords(expected);
    if (expTokens.length === 0 && outTokens.length === 0) return 1;
    if (expTokens.length === 0 || outTokens.length === 0) return 0;

    const overlap = overlapSize(toCounts(outTokens), toCounts(expTokens));
    const precision = overlap / outTokens.length;
    const recall = overlap / expTokens.length;
    if (precision + recall === 0) return 0;
    return clampScore((2 * precision * recall) / (precision + recall));
  },
};
