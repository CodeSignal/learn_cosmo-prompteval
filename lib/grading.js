/**
 * Helpers for hidden assessment tests. They re-run the candidate's own work
 * (prompt, custom check criteria) on hidden data with the same rendering,
 * metrics, and judge the simulator uses, and never trust scores the browser
 * reported. Topic-specific data and thresholds live in the task's tests.
 */

import path from 'path';
import { readJsonFile } from './helpers.js';
import { runPromptComparison } from './eval-compare.js';
import { runCustomCheckCalibration } from './custom-check-calibration.js';
import {
  normalizeFieldLabel,
  normalizeFieldValue,
  parseLabeledFields,
} from './metrics/field-match.js';

/**
 * The candidate's latest saved work. submission.json is written by the server
 * on every save; eval-session.json is the fallback for older workspaces.
 * @param {string} rootDir directory that contains server.js
 * @returns {Promise<{ promptA: string, examples: Array<{ input: string, idealOutput: string }>, cases: any[], criteria: string, notes: string, model: string, history: { evaluations: any[], calibrations: any[] } }>}
 */
export async function loadCandidateWork(rootDir) {
  const submission = await readJsonFile(path.join(rootDir, '.codesignal', 'submission.json'), null);
  if (submission && typeof submission.prompt?.template === 'string') {
    return {
      promptA: submission.prompt.template,
      examples: submission.prompt.examples ?? [],
      cases: submission.candidateCases ?? [],
      criteria: submission.customCheck?.criteria ?? '',
      notes: submission.notes ?? '',
      model: submission.model ?? '',
      history: {
        evaluations: submission.history?.evaluations ?? [],
        calibrations: submission.history?.calibrations ?? [],
      },
    };
  }
  const session = await readJsonFile(path.join(rootDir, 'eval-session.json'), {});
  return {
    promptA: typeof session.promptA === 'string' ? session.promptA : '',
    examples: Array.isArray(session.examples) ? session.examples : [],
    cases: Array.isArray(session.cases) ? session.cases : [],
    criteria: typeof session.customCheckCriteria === 'string' ? session.customCheckCriteria : '',
    notes: typeof session.notes === 'string' ? session.notes : '',
    model: typeof session.model === 'string' ? session.model : '',
    history: { evaluations: [], calibrations: [] },
  };
}

/**
 * @typedef {object} LabelField
 * @property {string} label
 * @property {'list' | 'enum' | 'text'} type
 * @property {string[]} [allowed] allowed values (list items or enum values)
 * @property {string[]} [exclusive] list values that must appear alone (e.g. NONE)
 * @property {number} [maxWords] text fields only
 */

/**
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  return String(text ?? '').trim().split(/\s+/u).filter(Boolean).length;
}

/**
 * Strict machine-readability check: the non-empty lines must be exactly the
 * schema's labeled lines, in order, with allowed values.
 * @param {string} output
 * @param {LabelField[]} schema
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkLabelFormat(output, schema) {
  const problems = [];
  const lines = String(output ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== schema.length) {
    problems.push(`expected ${schema.length} lines, got ${lines.length}`);
  }
  schema.forEach((field, i) => {
    const line = lines[i] ?? '';
    const prefix = `${field.label}:`;
    if (!line.startsWith(prefix)) {
      problems.push(`line ${i + 1} must start with "${prefix}"`);
      return;
    }
    const value = line.slice(prefix.length).trim();
    if (!value) {
      problems.push(`${field.label} is empty`);
      return;
    }
    if (field.type === 'enum' && !field.allowed?.includes(value)) {
      problems.push(`${field.label} "${value}" is not one of ${field.allowed?.join(', ')}`);
    }
    if (field.type === 'list') {
      const items = value.split(',').map((item) => item.trim());
      const unknown = items.filter((item) => !field.allowed?.includes(item) && !field.exclusive?.includes(item));
      if (unknown.length > 0) problems.push(`${field.label} has unknown values: ${unknown.join(', ')}`);
      if (items.some((item) => field.exclusive?.includes(item)) && items.length > 1) {
        problems.push(`${field.label} mixes ${field.exclusive?.join('/')} with other values`);
      }
      if (new Set(items).size !== items.length) problems.push(`${field.label} repeats a value`);
    }
    if (field.type === 'text' && field.maxWords && countWords(value) > field.maxWords) {
      problems.push(`${field.label} has ${countWords(value)} words (max ${field.maxWords})`);
    }
  });
  return { ok: problems.length === 0, problems };
}

/**
 * @param {string} output
 * @param {string} label
 * @returns {string | null} normalized value (lowercase, sorted list) or null
 */
export function fieldValue(output, label) {
  const field = parseLabeledFields(output).get(normalizeFieldLabel(label));
  return field ? normalizeFieldValue(field.value) : null;
}

/**
 * Run the candidate's prompt on hidden cases.
 * @param {{
 *   llm: import('./llm/types.js').LlmProvider,
 *   promptA: string,
 *   examples?: Array<{ input: string, idealOutput: string }>,
 *   promptTemplating?: ReturnType<typeof import('./session-config.js').normalizePromptTemplating>,
 *   cases: Array<{ id: string, input: string, expected: Record<string, string> }>,
 *   runs: number,
 *   fields: string[],
 *   temperature?: number,
 *   reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
 *   maxConcurrency?: number,
 * }} opts
 */
export async function gradePrompt(opts) {
  const result = await runPromptComparison(
    {
      llm: opts.llm,
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
    },
    {
      prompts: [{ id: 'A', label: 'Candidate prompt', promptTemplate: opts.promptA }],
      cases: opts.cases.map((c) => ({
        id: c.id,
        input: c.input,
        expectedAnswer: Object.entries(c.expected).map(([label, value]) => `${label}: ${value}`).join('\n'),
      })),
      examples: opts.examples ?? [],
      // Render exactly as the level's session.config.json does in the simulator.
      promptTemplating: opts.promptTemplating,
      metricId: 'field-match',
      runs: opts.runs,
      consistency: { fields: opts.fields },
      maxConcurrency: opts.maxConcurrency ?? 8,
    },
  );
  return result.cases.map((c, i) => {
    const prompt = c.prompts[0];
    const expected = opts.cases[i].expected;
    const outputs = prompt.results.map((r) => (r.status === 'ok' ? r.output : ''));
    const fieldAccuracy = Object.fromEntries(Object.entries(expected).map(([label, value]) => {
      const want = normalizeFieldValue(value);
      const hits = outputs.filter((o) => fieldValue(o, label) === want).length;
      return [label, outputs.length ? hits / outputs.length : 0];
    }));
    return {
      id: c.id,
      outputs,
      errors: prompt.results.filter((r) => r.status === 'error').length,
      meanScore: prompt.aggregate?.mean ?? 0,
      fieldAccuracy,
      consistency: prompt.consistency,
      commonAnswer: prompt.consistency?.commonAnswer ?? '',
      commonAnswerCorrect: Object.entries(expected).every(([label, value]) => (
        fieldValue(prompt.consistency?.commonAnswer ?? '', label) === normalizeFieldValue(value)
      )),
    };
  });
}

/**
 * Apply the candidate's custom check to hidden reviewer-labeled samples.
 * Balanced accuracy (mean of pass and fail recall) so "always FAIL" or
 * "always PASS" criteria cannot score well on a mixed set.
 * @param {{
 *   llm: import('./llm/types.js').LlmProvider,
 *   model?: string,
 *   criteria: string,
 *   samples: import('./custom-check-calibration.js').CalibrationSample[],
 *   maxConcurrency?: number,
 *   maxCriteriaLength?: number,
 * }} opts
 */
export async function gradeCustomCheck(opts) {
  const criteria = String(opts.criteria ?? '');
  const tooLong = opts.maxCriteriaLength != null && criteria.trim().length > opts.maxCriteriaLength;
  if (!criteria.trim() || tooLong) {
    return { agreement: 0, balancedAccuracy: 0, passRecall: 0, failRecall: 0, samples: [], tooLong };
  }
  const calibration = await runCustomCheckCalibration(opts);
  const recall = (verdict) => {
    const group = calibration.samples.filter((s) => s.reviewerVerdict === verdict);
    return group.length ? group.filter((s) => s.agree).length / group.length : 1;
  };
  const passRecall = recall('pass');
  const failRecall = recall('fail');
  return {
    agreement: calibration.agreement.rate ?? 0,
    balancedAccuracy: (passRecall + failRecall) / 2,
    passRecall,
    failRecall,
    samples: calibration.samples,
  };
}
