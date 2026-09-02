import { describe, it, expect, vi } from 'vitest';
import {
  normalizeRunCount,
  runEvalBatch,
  runSingleEval,
  MAX_EVAL_RUNS,
  MIN_EVAL_RUNS,
} from '../lib/eval-run.js';

describe('normalizeRunCount', () => {
  it('clamps to 1–5', () => {
    expect(normalizeRunCount(0)).toBe(MIN_EVAL_RUNS);
    expect(normalizeRunCount(99)).toBe(MAX_EVAL_RUNS);
    expect(normalizeRunCount('3')).toBe(3);
    expect(normalizeRunCount('nope')).toBe(MIN_EVAL_RUNS);
  });
});

describe('runSingleEval / runEvalBatch', () => {
  function makeDeps() {
    const complete = vi.fn().mockResolvedValue({ text: 'ok', requestId: 'req-1' });
    return {
      deps: {
        llm: { name: 'anthropic', model: 'claude-sonnet-4-6', complete },
        systemPrompt: 'You are being evaluated.',
      },
      complete,
    };
  }

  it('calls llm.complete once with the rendered prompt', async () => {
    const { deps, complete } = makeDeps();
    const result = await runSingleEval(deps, {
      renderedPrompt: 'Say hi',
      run: 1,
    });

    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-6',
      system: 'You are being evaluated.',
      messages: [{ role: 'user', content: 'Say hi' }],
      temperature: undefined,
    });
    expect(result).toMatchObject({
      run: 1,
      output: 'ok',
      status: 'ok',
      error: null,
    });
    expect(result.sessionId).toEqual(expect.any(String));
    expect(result.sessionId.length).toBeGreaterThan(0);
  });

  it('runs N independent completions sequentially', async () => {
    const { deps, complete } = makeDeps();
    const batch = await runEvalBatch(deps, {
      promptTemplate: 'Echo: {{input}}',
      input: 'ping',
      runs: 3,
    });

    expect(batch.renderedPrompt).toBe('Echo: ping');
    expect(batch.runs).toBe(3);
    expect(batch.results).toHaveLength(3);
    expect(batch.aggregate).toBeNull();
    expect(batch.metricId).toBeNull();
    expect(complete).toHaveBeenCalledTimes(3);
    expect(new Set(batch.results.map((r) => r.sessionId)).size).toBe(3);
  });

  it('scores outputs when expectedAnswer is provided', async () => {
    const { deps, complete } = makeDeps();
    complete.mockResolvedValue({ text: 'Paris' });

    const batch = await runEvalBatch(deps, {
      promptTemplate: 'Capital of {{input}}?',
      input: 'France',
      runs: 2,
      expectedAnswer: 'Paris',
      metricId: 'exact-match',
    });

    expect(batch.expectedAnswer).toBe('Paris');
    expect(batch.metricId).toBe('exact-match');
    expect(batch.results.every((r) => r.score === 1)).toBe(true);
    expect(batch.aggregate).toEqual({
      mean: 1,
      min: 1,
      max: 1,
      count: 2,
    });
  });

  it('records an error status when complete() rejects', async () => {
    const { deps, complete } = makeDeps();
    complete.mockRejectedValueOnce(new Error('rate limited'));

    const result = await runSingleEval(deps, {
      renderedPrompt: 'Say hi',
      run: 1,
    });

    expect(result).toMatchObject({
      run: 1,
      output: '',
      status: 'error',
      error: 'rate limited',
      score: null,
    });
  });

  it('rejects an empty rendered prompt', async () => {
    const { deps } = makeDeps();
    await expect(
      runEvalBatch(deps, { promptTemplate: '   ', input: '', runs: 1 }),
    ).rejects.toMatchObject({ code: 'EMPTY_PROMPT' });
  });
});
