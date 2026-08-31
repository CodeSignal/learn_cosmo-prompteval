import { clampScore, normalizeText } from './types.js';

/** Exact match ignoring letter case (after trimming). */
export default {
  id: 'exact-match-ci',
  name: 'Case-insensitive Exact Match',
  description: 'Score 1 when the output matches the expected answer ignoring case (after trimming).',
  score(output, expected) {
    const a = normalizeText(output).toLowerCase();
    const b = normalizeText(expected).toLowerCase();
    if (b === '') return 0;
    return clampScore(a === b ? 1 : 0);
  },
};
