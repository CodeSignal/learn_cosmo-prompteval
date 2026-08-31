/**
 * Prompt comparison (A vs B, extensible to N variants).
 *
 * Built on runEvalBatch so each prompt still gets independent fresh-session
 * runs under shared conditions. Multi-test-case evaluation can later loop
 * cases outside this helper (or pass an array of cases) without changing
 * the per-prompt batch contract.
 */

import { DEFAULT_METRIC_ID } from './metrics/index.js';
import { normalizeRunCount, runEvalBatch } from './eval-run.js';

/**
 * @typedef {object} PromptVariant
 * @property {string} id
 * @property {string} [label]
 * @property {string} promptTemplate
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
 * Run the same evaluation conditions across multiple prompt templates.
 *
 * @param {import('./eval-run.js').EvalRunDeps} deps
 * @param {{
 *   prompts: PromptVariant[],
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
  if (prompts.length < 2) {
    const err = new Error('At least two prompts are required for comparison');
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

  const input = typeof opts.input === 'string' ? opts.input : '';
  const expectedAnswer = typeof opts.expectedAnswer === 'string' ? opts.expectedAnswer : '';
  const metricId = opts.metricId ?? DEFAULT_METRIC_ID;
  const runs = normalizeRunCount(opts.runs);
  const runBatch = opts.runBatch ?? runEvalBatch;

  // Shared conditions object — later this can become { cases: [...] }.
  const conditions = {
    input,
    expectedAnswer: expectedAnswer.trim() !== '' ? expectedAnswer : null,
    metricId: expectedAnswer.trim() !== '' ? metricId : null,
    runs,
  };

  /** @type {Array<object>} */
  const promptResults = [];
  for (const p of prompts) {
    const batch = await runBatch(deps, {
      promptTemplate: p.promptTemplate,
      input,
      expectedAnswer,
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
  }

  return {
    conditions,
    prompts: promptResults,
    comparison: compareByMean(promptResults),
  };
}
