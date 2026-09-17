import { normalizeText } from './types.js';

export default {
  id: 'valid-json',
  name: 'Valid JSON',
  description: 'Scores 1 when the output is valid JSON. Expected Answer is not required.',
  type: 'function',
  requiresExpectedAnswer: false,
  score(output) {
    const text = normalizeText(output);
    if (!text) return 0;
    try {
      JSON.parse(text);
      return 1;
    } catch {
      return 0;
    }
  },
};
