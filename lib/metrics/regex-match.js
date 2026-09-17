import { normalizeText } from './types.js';

export default {
  id: 'regex-match',
  name: 'Regular expression match',
  description: 'Scores 1 when the output matches the regular expression in Expected Answer.',
  type: 'function',
  requiresExpectedAnswer: true,
  score(output, expected) {
    try {
      return new RegExp(normalizeText(expected), 'u').test(normalizeText(output)) ? 1 : 0;
    } catch {
      return 0;
    }
  },
};
