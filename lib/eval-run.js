/**
 * Independent prompt-evaluation runs against Octavus.
 *
 * Each run creates a fresh agent session and fires a single `run-prompt`
 * trigger, so conversation history never leaks across repeats. Optional
 * expectedAnswer + metricId attach scores without changing the Octavus path.
 */

import { createAgentSession } from './octavus-create.js';
import { renderPromptTemplate } from './prompt-render.js';
import {
  DEFAULT_METRIC_ID,
  scoreOutput,
  summarizeScores,
} from './metrics/index.js';

export const MIN_EVAL_RUNS = 1;
export const MAX_EVAL_RUNS = 5;
export const EVAL_TRIGGER_NAME = 'run-prompt';

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
 * Drain an Octavus execute() stream into concatenated assistant text.
 * @param {AsyncIterable<{ type: string, delta?: string, message?: string }>} events
 * @returns {Promise<{ output: string, error: string | null }>}
 */
export async function collectAssistantText(events) {
  let output = '';
  let error = null;

  for await (const event of events) {
    if (event?.type === 'text-delta' && typeof event.delta === 'string') {
      output += event.delta;
    } else if (event?.type === 'error') {
      error = typeof event.message === 'string' && event.message
        ? event.message
        : 'Octavus stream error';
    }
  }

  return { output, error };
}

/**
 * @typedef {object} EvalRunDeps
 * @property {string} baseUrl
 * @property {string} [apiKey]
 * @property {string} agentId
 * @property {{ agentSessions: { attach: (sessionId: string) => { execute: (req: object) => AsyncIterable<object> } } }} octavus
 * @property {(opts: object) => Promise<string>} [createSession]
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
 * Run one independent evaluation (new session + one trigger).
 *
 * @param {EvalRunDeps} deps
 * @param {{
 *   renderedPrompt: string,
 *   run: number,
 *   sessionInput?: Record<string, unknown>,
 *   expectedAnswer?: string,
 *   metricId?: string,
 * }} opts
 * @returns {Promise<EvalResult>}
 */
export async function runSingleEval(deps, opts) {
  const createSession = deps.createSession ?? createAgentSession;
  const sessionId = await createSession({
    baseUrl: deps.baseUrl,
    apiKey: deps.apiKey,
    agentId: deps.agentId,
    input: opts.sessionInput ?? {},
  });

  const session = deps.octavus.agentSessions.attach(sessionId);
  const events = session.execute({
    type: 'trigger',
    triggerName: EVAL_TRIGGER_NAME,
    input: { PROMPT: opts.renderedPrompt },
  });

  const { output, error } = await collectAssistantText(events);
  const status = error ? 'error' : 'ok';
  const score =
    status === 'ok'
      ? scoreOutput(output, opts.expectedAnswer, opts.metricId ?? DEFAULT_METRIC_ID)
      : null;

  return {
    run: opts.run,
    sessionId,
    output,
    error,
    status,
    score,
  };
}

/**
 * Render a template and execute N independent Octavus runs sequentially.
 *
 * @param {EvalRunDeps} deps
 * @param {{
 *   promptTemplate: string,
 *   input: string,
 *   runs?: number,
 *   sessionInput?: Record<string, unknown>,
 *   expectedAnswer?: string,
 *   metricId?: string,
 * }} opts
 */
export async function runEvalBatch(deps, opts) {
  const promptTemplate = typeof opts.promptTemplate === 'string' ? opts.promptTemplate : '';
  const input = typeof opts.input === 'string' ? opts.input : '';
  const expectedAnswer = typeof opts.expectedAnswer === 'string' ? opts.expectedAnswer : '';
  const metricId = opts.metricId ?? DEFAULT_METRIC_ID;
  const runs = normalizeRunCount(opts.runs);
  const renderedPrompt = renderPromptTemplate(promptTemplate, input);

  if (!renderedPrompt.trim()) {
    const err = new Error('promptTemplate (or input) must produce a non-empty prompt');
    err.code = 'EMPTY_PROMPT';
    throw err;
  }

  /** @type {EvalResult[]} */
  const results = [];
  for (let run = 1; run <= runs; run += 1) {
    results.push(
      await runSingleEval(deps, {
        renderedPrompt,
        run,
        sessionInput: opts.sessionInput,
        expectedAnswer,
        metricId,
      }),
    );
  }

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
