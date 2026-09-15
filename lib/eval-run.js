/**
 * Independent prompt-evaluation runs against an LLM provider.
 *
 * Each run is a single complete() call with no conversation history, so
 * repeats stay independent. Optional expectedAnswer + metricId attach scores
 * without changing the provider path.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConcurrencyLimiter } from './concurrency.js';
import { renderPromptTemplate } from './prompt-render.js';
import {
  DEFAULT_METRIC_ID,
  scoreOutput,
  summarizeScores,
} from './metrics/index.js';

export const MIN_EVAL_RUNS = 1;
export const MAX_EVAL_RUNS = 5;

const DEFAULT_SYSTEM_PROMPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'eval-system-prompt.md',
);

/** @type {string | undefined} */
let cachedSystemPrompt;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeRunCount(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return MIN_EVAL_RUNS;
  return Math.min(MAX_EVAL_RUNS, Math.max(MIN_EVAL_RUNS, n));
}

/**
 * @param {string} [explicit]
 * @returns {Promise<string>}
 */
export async function resolveSystemPrompt(explicit) {
  if (typeof explicit === 'string') return explicit;
  if (cachedSystemPrompt !== undefined) return cachedSystemPrompt;
  cachedSystemPrompt = await fs.readFile(DEFAULT_SYSTEM_PROMPT_PATH, 'utf8');
  return cachedSystemPrompt;
}

/**
 * @typedef {object} EvalRunDeps
 * @property {import('./llm/types.js').LlmProvider} llm
 * @property {string} [model]
 * @property {number} [temperature]
 * @property {string} [systemPrompt]
 */

/**
 * @typedef {object} EvalResult
 * @property {number} run
 * @property {string} sessionId
 * @property {string} output
 * @property {string | null} error
 * @property {'ok' | 'error'} status
 * @property {number | null} score
 */

/**
 * Run one independent evaluation (one complete() call).
 *
 * @param {EvalRunDeps} deps
 * @param {{
 *   renderedPrompt: string,
 *   run: number,
 *   expectedAnswer?: string,
 *   metricId?: string,
 * }} opts
 * @returns {Promise<EvalResult>}
 */
export async function runSingleEval(deps, opts) {
  const sessionId = randomUUID();
  const system = await resolveSystemPrompt(deps.systemPrompt);
  const model = deps.model || deps.llm.model;

  try {
    const result = await deps.llm.complete({
      model,
      system,
      messages: [{ role: 'user', content: opts.renderedPrompt }],
      temperature: deps.temperature,
    });
    const output = typeof result?.text === 'string' ? result.text : '';
    const score = scoreOutput(output, opts.expectedAnswer, opts.metricId ?? DEFAULT_METRIC_ID);

    return {
      run: opts.run,
      sessionId,
      output,
      error: null,
      status: 'ok',
      score,
    };
  } catch (err) {
    return {
      run: opts.run,
      sessionId,
      output: '',
      error: err instanceof Error && err.message ? err.message : 'LLM request failed',
      status: 'error',
      score: null,
    };
  }
}

/**
 * Render a template and execute N independent LLM runs with bounded concurrency.
 *
 * @param {EvalRunDeps} deps
 * @param {{
 *   promptTemplate: string,
 *   input: string,
 *   runs?: number,
 *   expectedAnswer?: string,
 *   metricId?: string,
 *   maxConcurrency?: number,
 *   schedule?: <T>(fn: () => T | Promise<T>) => Promise<T>,
 * }} opts
 */
export async function runEvalBatch(deps, opts) {
  const promptTemplate = typeof opts.promptTemplate === 'string' ? opts.promptTemplate : '';
  const input = typeof opts.input === 'string' ? opts.input : '';
  const expectedAnswer = typeof opts.expectedAnswer === 'string' ? opts.expectedAnswer : '';
  const metricId = opts.metricId ?? DEFAULT_METRIC_ID;
  const runs = normalizeRunCount(opts.runs);
  const renderedPrompt = renderPromptTemplate(promptTemplate, input);
  const schedule = typeof opts.schedule === 'function'
    ? opts.schedule
    : createConcurrencyLimiter(opts.maxConcurrency).schedule;

  if (!renderedPrompt.trim()) {
    const err = new Error('promptTemplate (or input) must produce a non-empty prompt');
    err.code = 'EMPTY_PROMPT';
    throw err;
  }

  /** @type {EvalResult[]} */
  const results = await Promise.all(
    Array.from({ length: runs }, (_, i) =>
      schedule(() =>
        runSingleEval(deps, {
          renderedPrompt,
          run: i + 1,
          expectedAnswer,
          metricId,
        }),
      ),
    ),
  );

  const scoringEnabled = expectedAnswer.trim() !== '';
  const aggregate = scoringEnabled
    ? summarizeScores(results.map((r) => r.score))
    : null;

  return {
    renderedPrompt,
    runs,
    expectedAnswer: scoringEnabled ? expectedAnswer : null,
    metricId: scoringEnabled ? metricId : null,
    aggregate,
    results,
  };
}
