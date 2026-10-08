/**
 * Run-to-run consistency: how often independent runs of the same prompt on the
 * same case give the same answer. Browser-safe.
 *
 * Runs are compared on labeled fields when a basis is given (for example
 * Category and Priority, so a free-text summary can vary), otherwise on the
 * whole output after trimming, lowercasing, and collapsing whitespace.
 */

import {
  normalizeFieldLabel,
  normalizeFieldValue,
  parseLabeledFields,
} from './metrics/field-match.js';

export const MAX_CONSISTENCY_FIELDS = 8;

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeConsistencyFields(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  /** @type {string[]} */
  const fields = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const label = item.trim().replace(/\s+/gu, ' ');
    const key = normalizeFieldLabel(label);
    if (!label || label.length > 40 || seen.has(key)) continue;
    seen.add(key);
    fields.push(label);
    if (fields.length >= MAX_CONSISTENCY_FIELDS) break;
  }
  return fields;
}

/**
 * The value runs are grouped by, or null when a compared field is missing or
 * empty. Unreadable runs never agree with anything: identical unusable outputs
 * are not a consistent answer.
 * @param {string} output
 * @param {string[]} fields
 * @returns {string | null}
 */
export function consistencyKey(output, fields) {
  if (fields.length === 0) {
    const whole = String(output ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
    return whole || null;
  }
  const parsed = parseLabeledFields(output);
  const parts = [];
  for (const label of fields) {
    const value = normalizeFieldValue(parsed.get(normalizeFieldLabel(label))?.value);
    if (!value) return null;
    parts.push(`${normalizeFieldLabel(label)}=${value}`);
  }
  return parts.join(' | ');
}

/**
 * @typedef {object} CaseConsistency
 * @property {string[]} basis labeled fields compared, or [] for the whole output
 * @property {number} runs successful runs compared
 * @property {number} agreeing runs matching the most common answer
 * @property {number | null} agreement agreeing / runs, null with fewer than 2 runs
 * @property {number} distinct number of different answers
 * @property {string} commonAnswer representative output of the most common answer
 * @property {number} unreadable runs missing a compared field (or empty)
 * @property {number} errors runs that failed and were not compared
 */

/**
 * @param {Array<{ status?: string, output?: string, error?: string | null }>} results
 * @param {string[]} [fields]
 * @returns {CaseConsistency}
 */
export function summarizeConsistency(results, fields = []) {
  const basis = normalizeConsistencyFields(fields);
  const ok = (Array.isArray(results) ? results : [])
    .filter((r) => r && r.status !== 'error' && !r.error);
  const errors = (Array.isArray(results) ? results.length : 0) - ok.length;

  /** @type {Map<string, { count: number, output: string }>} */
  const groups = new Map();
  let unreadable = 0;
  let firstUnreadableOutput = '';
  for (const r of ok) {
    const output = typeof r.output === 'string' ? r.output : '';
    const key = consistencyKey(output, basis);
    if (key == null) {
      if (unreadable === 0) firstUnreadableOutput = output;
      unreadable += 1;
      continue;
    }
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { count: 1, output });
  }

  let common = { count: 0, output: firstUnreadableOutput };
  for (const group of groups.values()) {
    if (group.count > common.count) common = group;
  }

  return {
    basis,
    runs: ok.length,
    agreeing: common.count,
    agreement: ok.length >= 2 ? common.count / ok.length : null,
    distinct: groups.size + unreadable,
    commonAnswer: common.output,
    unreadable,
    errors,
  };
}

/**
 * Overall stability for one prompt across cases with at least two runs.
 * @param {Array<CaseConsistency | null | undefined>} perCase
 * @returns {{ stability: number | null, consistentCases: number, comparedCases: number }}
 */
export function summarizeOverallConsistency(perCase) {
  const compared = (Array.isArray(perCase) ? perCase : [])
    .filter((c) => c && typeof c.agreement === 'number');
  if (compared.length === 0) {
    return { stability: null, consistentCases: 0, comparedCases: 0 };
  }
  const sum = compared.reduce((total, c) => total + /** @type {number} */ (c.agreement), 0);
  return {
    stability: sum / compared.length,
    consistentCases: compared.filter((c) => c.agreement === 1).length,
    comparedCases: compared.length,
  };
}

/**
 * Which fields to compare for one case: configured fields first, then the
 * labels written in Expected Answer when field-match is the metric.
 * @param {{ fields?: string[], metricId?: string | null, expectedAnswer?: string | null }} opts
 * @returns {string[]}
 */
export function resolveConsistencyFields(opts) {
  const configured = normalizeConsistencyFields(opts.fields);
  if (configured.length > 0) return configured;
  if (opts.metricId === 'field-match' && typeof opts.expectedAnswer === 'string') {
    return normalizeConsistencyFields(
      [...parseLabeledFields(opts.expectedAnswer).values()].map((field) => field.label),
    );
  }
  return [];
}
