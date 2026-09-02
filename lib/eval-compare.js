/**
 * Prompt evaluation / comparison across one or more test cases.
 * Supports a single prompt or A vs B (extensible to N). Built on runEvalBatch
 * so every run is an independent LLM complete() call.
 */

import { DEFAULT_METRIC_ID, summarizeScores } from './metrics/index.js';
import { normalizeRunCount, runEvalBatch } from './eval-run.js';

export const MIN_EVAL_CASES = 1;
export const MAX_EVAL_CASES = 5;

/**
 * @typedef {object} PromptVariant
 * @property {string} id
 * @property {string} [label]
 * @property {string} promptTemplate
 */

/**
 * @typedef {object} EvalCase
 * @property {string} [id]
 * @property {string} [label]
 * @property {string} input
 * @property {string} [expectedAnswer]
 */

/**
 * Decide a winner from aggregate means.
 * @param {Array<{ id: string, aggregate: { mean: number } | null }>} promptResults
 * @returns {{
 *   outcome: 'winner' | 'tie' | 'unscored',
 *   winnerId: string | null,
 *   means: Record<string, number | null>,
 * }}
 */
export function compareByMean(promptResults) {
  /** @type {Record<string, number | null>} */
  const means = {};
  for (const p of promptResults) {
    means[p.id] = p.aggregate && Number.isFinite(p.aggregate.mean)
      ? p.aggregate.mean
      : null;
  }

  const scored = promptResults.filter((p) => means[p.id] != null);
  if (scored.length < 2) {
    return { outcome: 'unscored', winnerId: null, means };
  }

  const max = Math.max(...scored.map((p) => /** @type {number} */ (means[p.id])));
  const leaders = scored.filter((p) => means[p.id] === max);
  if (leaders.length > 1) {
    return { outcome: 'tie', winnerId: null, means };
  }
  return { outcome: 'winner', winnerId: leaders[0].id, means };
}

/**
 * Normalize cases from either `cases[]` or legacy single `input`/`expectedAnswer`.
 * @param {{
 *   cases?: EvalCase[],
 *   input?: string,
 *   expectedAnswer?: string,
 * }} opts
 * @returns {Array<{ id: string, label: string, input: string, expectedAnswer: string }>}
 */
export function normalizeCases(opts = {}) {
  if (Array.isArray(opts.cases) && opts.cases.length > 0) {
    if (opts.cases.length > MAX_EVAL_CASES) {
      const err = new Error(`At most ${MAX_EVAL_CASES} test cases are allowed`);
      err.code = 'TOO_MANY_CASES';
      throw err;
    }
    return opts.cases.map((c, i) => {
      if (!c || typeof c !== 'object') {
        const err = new Error(`Case ${i + 1} must be an object`);
        err.code = 'INVALID_CASE';
        throw err;
      }
      if (c.input !== undefined && typeof c.input !== 'string') {
        const err = new Error(`Case ${i + 1} input must be a string`);
        err.code = 'INVALID_CASE';
        throw err;
      }
      if (c.expectedAnswer !== undefined && c.expectedAnswer !== null && typeof c.expectedAnswer !== 'string') {
        const err = new Error(`Case ${i + 1} expectedAnswer must be a string`);
        err.code = 'INVALID_CASE';
        throw err;
      }
      return {
        id: typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `case-${i + 1}`,
        label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : `Case ${i + 1}`,
        input: typeof c.input === 'string' ? c.input : '',
        expectedAnswer: typeof c.expectedAnswer === 'string' ? c.expectedAnswer : '',
      };
    });
  }

  return [
    {
      id: 'case-1',
      label: 'Case 1',
      input: typeof opts.input === 'string' ? opts.input : '',
      expectedAnswer: typeof opts.expectedAnswer === 'string' ? opts.expectedAnswer : '',
    },
  ];
}

/**
 * @param {PromptVariant[]} prompts
 */
function validatePrompts(prompts) {
  if (!Array.isArray(prompts) || prompts.length < 1) {
    const err = new Error('At least one prompt is required');
    err.code = 'NEED_PROMPTS';
    throw err;
  }

  for (const p of prompts) {
    if (!p || typeof p.id !== 'string' || !p.id.trim()) {
      const err = new Error('Each prompt must have a string id');
      err.code = 'INVALID_PROMPT';
      throw err;
    }
    if (typeof p.promptTemplate !== 'string') {
      const err = new Error(`promptTemplate for "${p.id}" must be a string`);
      err.code = 'INVALID_PROMPT';
      throw err;
    }
  }

  const ids = prompts.map((p) => p.id);
  if (new Set(ids).size !== ids.length) {
    const err = new Error('Prompt ids must be unique');
    err.code = 'INVALID_PROMPT';
    throw err;
  }
}

/**
 * Run prompts across one or more test cases under shared metric/runs.
 *
 * @param {import('./eval-run.js').EvalRunDeps} deps
 * @param {{
 *   prompts: PromptVariant[],
 *   cases?: EvalCase[],
 *   input?: string,
 *   expectedAnswer?: string,
 *   metricId?: string,
 *   runs?: number,
 *   sessionInput?: Record<string, unknown>,
 *   runBatch?: typeof runEvalBatch,
 * }} opts
 */
export async function runPromptComparison(deps, opts) {
  const prompts = Array.isArray(opts.prompts) ? opts.prompts : [];
  validatePrompts(prompts);

  const cases = normalizeCases(opts);
  const metricId = opts.metricId ?? DEFAULT_METRIC_ID;
  const runs = normalizeRunCount(opts.runs);
  const runBatch = opts.runBatch ?? runEvalBatch;

  const anyExpected = cases.some((c) => c.expectedAnswer.trim() !== '');
  const conditions = {
    metricId: anyExpected ? metricId : null,
    runs,
    caseCount: cases.length,
  };

  /** @type {Array<object>} */
  const caseResults = [];
  /** @type {Record<string, number[]>} */
  const overallScoresByPrompt = Object.fromEntries(prompts.map((p) => [p.id, []]));

  for (const testCase of cases) {
    /** @type {Array<object>} */
    const promptResults = [];
    for (const p of prompts) {
      const batch = await runBatch(deps, {
        promptTemplate: p.promptTemplate,
        input: testCase.input,
        expectedAnswer: testCase.expectedAnswer,
        metricId,
        runs,
        sessionInput: opts.sessionInput,
      });
      promptResults.push({
        id: p.id,
        label: p.label || p.id,
        promptTemplate: p.promptTemplate,
        ...batch,
      });
      for (const r of batch.results) {
        if (typeof r.score === 'number' && Number.isFinite(r.score)) {
          overallScoresByPrompt[p.id].push(r.score);
        }
      }
    }

    caseResults.push({
      id: testCase.id,
      label: testCase.label,
      input: testCase.input,
      expectedAnswer: testCase.expectedAnswer.trim() !== '' ? testCase.expectedAnswer : null,
      prompts: promptResults,
      comparison: compareByMean(promptResults),
    });
  }

  const overallPrompts = prompts.map((p) => {
    const aggregate = summarizeScores(overallScoresByPrompt[p.id]);
    const caseSummaries = caseResults.map((c) => {
      const match = c.prompts.find((pr) => pr.id === p.id);
      return {
        caseId: c.id,
        caseLabel: c.label,
        mean: match?.aggregate?.mean ?? null,
        aggregate: match?.aggregate ?? null,
      };
    });
    return {
      id: p.id,
      label: p.label || p.id,
      promptTemplate: p.promptTemplate,
      aggregate,
      caseSummaries,
    };
  });

  return {
    conditions,
    cases: caseResults,
    prompts: overallPrompts,
    comparison: compareByMean(overallPrompts),
  };
}
