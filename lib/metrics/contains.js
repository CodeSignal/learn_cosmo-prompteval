import { clampScore, normalizeText } from './types.js';

/**
 * Score 1 when the output contains the expected answer as a substring
 * (case-sensitive, after trimming both sides).
 */
export default {
  id: 'contains',
  name: 'Contains',
  description: 'Score 1 when the output contains the expected answer as a substring (case-sensitive).',
  score(output, expected) {
    const a = normalizeText(output);
    const b = normalizeText(expected);
    if (b === '') return 0;
    return clampScore(a.includes(b) ? 1 : 0);
  },
};
