import { clampScore, normalizeText } from './types.js';

/** Exact character match after trimming (case-sensitive). */
export default {
  id: 'exact-match',
  name: 'Exact Match',
  description: 'Score 1 only when the output matches the expected answer exactly (after trimming).',
  score(output, expected) {
    const a = normalizeText(output);
    const b = normalizeText(expected);
    if (b === '') return 0;
    return clampScore(a === b ? 1 : 0);
  },
};
