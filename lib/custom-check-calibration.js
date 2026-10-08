/**
 * Calibrate a candidate's custom check against reviewer-labeled outputs.
 *
 * Shared by the simulator's "Test my check" button and by hidden graders, so
 * the candidate and the grader see identical judge behavior.
 */

import { createConcurrencyLimiter, normalizeConcurrency } from './concurrency.js';
import { scoreOutputDetailed } from './metrics/index.js';

/**
 * @typedef {object} CalibrationSample
 * @property {string} id
 * @property {string} [label]
 * @property {string} input
 * @property {string} output
 * @property {string} [expectedAnswer]
 * @property {'pass' | 'fail'} verdict reviewer verdict
 * @property {string} [note]
 */

/**
 * @param {{
 *   llm: import('./llm/types.js').LlmProvider,
 *   model?: string,
 *   criteria: string,
 *   samples: CalibrationSample[],
 *   maxConcurrency?: number,
 * }} opts
 */
export async function runCustomCheckCalibration(opts) {
  const criteria = typeof opts.criteria === 'string' ? opts.criteria.trim() : '';
  if (!criteria) {
    const err = new Error('Write your check criteria before testing it');
    err.code = 'EMPTY_CRITERIA';
    throw err;
  }
  const samples = Array.isArray(opts.samples) ? opts.samples : [];
  const { schedule } = createConcurrencyLimiter(normalizeConcurrency(opts.maxConcurrency));
  const startedAt = Date.now();

  const results = await Promise.all(samples.map((sample) => schedule(async () => {
    const detail = await scoreOutputDetailed(
      sample.output,
      sample.expectedAnswer,
      'custom-check',
      {
        llm: opts.llm,
        model: opts.model,
        criteria,
        input: sample.input,
      },
    );
    const verdict = detail.score == null ? null : (detail.score === 1 ? 'pass' : 'fail');
    return {
      id: sample.id,
      label: sample.label ?? sample.id,
      reviewerVerdict: sample.verdict,
      verdict,
      reason: detail.reason ?? '',
      ...(detail.error ? { error: detail.error } : {}),
      agree: verdict != null && verdict === sample.verdict,
    };
  })));

  const scored = results.filter((r) => r.verdict != null).length;
  const agreeing = results.filter((r) => r.agree).length;
  return {
    criteria,
    ...(opts.model ? { judgeModel: opts.model } : {}),
    samples: results,
    agreement: {
      agreeing,
      total: results.length,
      scored,
      rate: results.length > 0 ? agreeing / results.length : null,
    },
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}
