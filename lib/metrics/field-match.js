import { clampScore, normalizeText } from './types.js';

const FIELD_LINE_RE = /^\s*([A-Za-z][A-Za-z0-9 _/&()-]{0,40}?)\s*:\s*(.*)$/u;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFieldLabel(value) {
  return normalizeText(value).replace(/\s+/gu, ' ').toLowerCase();
}

/**
 * Compare field values ignoring case, extra spaces, a trailing period, and the
 * order of comma-separated items ("Milk, Eggs" equals "eggs, milk").
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFieldValue(value) {
  return normalizeText(value)
    .split(',')
    .map((item) => item.trim().replace(/\s+/gu, ' ').replace(/\.$/u, '').toLowerCase())
    .filter(Boolean)
    .sort()
    .join(', ');
}

/**
 * Read `Label: value` lines. The first line for each label wins.
 * @param {unknown} text
 * @returns {Map<string, { label: string, value: string }>}
 */
export function parseLabeledFields(text) {
  /** @type {Map<string, { label: string, value: string }>} */
  const fields = new Map();
  for (const line of String(text ?? '').split(/\r?\n/u)) {
    const match = line.match(FIELD_LINE_RE);
    if (!match) continue;
    const key = normalizeFieldLabel(match[1]);
    if (!fields.has(key)) {
      fields.set(key, { label: match[1].trim(), value: match[2].trim() });
    }
  }
  return fields;
}

/**
 * Per-field comparison used by the metric and shown to graders.
 * @param {string} output
 * @param {string} expected
 * @returns {Array<{ label: string, expected: string, actual: string | null, match: boolean }>}
 */
export function compareLabeledFields(output, expected) {
  const outputFields = parseLabeledFields(output);
  return [...parseLabeledFields(expected).entries()].map(([key, field]) => {
    const actual = outputFields.get(key)?.value ?? null;
    return {
      label: field.label,
      expected: field.value,
      actual,
      match: actual != null && normalizeFieldValue(actual) === normalizeFieldValue(field.value),
    };
  });
}

/**
 * Score only the labeled lines written in Expected Answer. Lines the expected
 * answer does not mention (for example a free-text summary) are ignored.
 */
export default {
  id: 'field-match',
  name: 'Field match',
  description: 'Checks each "Label: value" line from Expected Answer against the same line in the output.',
  score(output, expected) {
    const comparisons = compareLabeledFields(output, expected);
    if (comparisons.length === 0) {
      const b = normalizeFieldValue(expected);
      if (b === '') return 0;
      return clampScore(normalizeFieldValue(output) === b ? 1 : 0);
    }
    const matched = comparisons.filter((c) => c.match).length;
    return clampScore(matched / comparisons.length);
  },
};
