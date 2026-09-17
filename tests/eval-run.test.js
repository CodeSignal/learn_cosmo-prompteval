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

  it('runs N independent completions', async () => {
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
    expect(batch.results.map((r) => r.run)).toEqual([1, 2, 3]);
  });

  it('caps in-flight complete() calls at maxConcurrency', async () => {
    let started = 0;
    let release = () => {};
    const hang = new Promise((resolve) => {
      release = resolve;
    });
    const complete = vi.fn().mockImplementation(async () => {
      started += 1;
      await hang;
      return { text: 'ok' };
    });
    const deps = {
      llm: { name: 'anthropic', model: 'claude-sonnet-4-6', complete },
      systemPrompt: 'You are being evaluated.',
    };

    const pending = runEvalBatch(deps, {
      promptTemplate: 'Echo: {{input}}',
      input: 'ping',
      runs: 3,
      maxConcurrency: 2,
    });

    await vi.waitFor(() => expect(started).toBe(2));
    release();
    const batch = await pending;
    expect(complete).toHaveBeenCalledTimes(3);
    expect(batch.results.map((r) => r.run)).toEqual([1, 2, 3]);
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

  it('runs a function checker without an expected answer', async () => {
    const { deps, complete } = makeDeps();
    complete.mockResolvedValue({ text: '{"capital":"Paris"}' });

    const batch = await runEvalBatch(deps, {
      promptTemplate: 'Return JSON',
      input: '',
      runs: 1,
      metricId: 'valid-json',
    });

    expect(batch.metricId).toBe('valid-json');
    expect(batch.results[0].score).toBe(1);
    expect(batch.aggregate?.mean).toBe(1);
  });

  it('uses an independent LLM call to judge semantic correctness', async () => {
    const { deps, complete } = makeDeps();
    complete
      .mockResolvedValueOnce({ text: 'The capital is Paris.' })
      .mockResolvedValueOnce({ text: '0.95' });

    const result = await runSingleEval(deps, {
      renderedPrompt: 'Capital of France?',
      run: 1,
      expectedAnswer: 'Paris',
      metricId: 'llm-judge',
    });

    expect(result.score).toBe(0.95);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0]).toMatchObject({
      temperature: 0,
      messages: [{
        role: 'user',
        content: expect.stringContaining('Expected answer:\nParis'),
      }],
    });
  });

  it('uses a separately configured provider for LLM judging', async () => {
    const generationComplete = vi.fn().mockResolvedValue({ text: 'Paris, France.' });
    const judgeComplete = vi.fn().mockResolvedValue({ text: '0.9' });
    const deps = {
      llm: {
        name: 'openai',
        model: 'generation-model',
        complete: generationComplete,
      },
      judgeLlm: {
        name: 'anthropic',
        model: 'judge-model',
        complete: judgeComplete,
      },
      judgeModel: 'judge-model',
      systemPrompt: 'You are being evaluated.',
    };

    const result = await runSingleEval(deps, {
      renderedPrompt: 'Capital of France?',
      run: 1,
      expectedAnswer: 'Paris',
      metricId: 'llm-judge',
    });

    expect(result.score).toBe(0.9);
    expect(generationComplete).toHaveBeenCalledOnce();
    expect(judgeComplete).toHaveBeenCalledOnce();
    expect(judgeComplete.mock.calls[0][0].model).toBe('judge-model');
  });

  it('renders named variables and shared examples before evaluation', async () => {
    const { deps, complete } = makeDeps();
    await runEvalBatch(deps, {
      promptTemplate: 'You are a {{role}}.\n\n{{examples}}\n\nQuestion: {{input}}',
      input: 'Where is my refund?',
      templateVariables: { role: 'support agent' },
      examples: [{ input: 'I was charged twice.', idealOutput: 'billing' }],
      strictTemplating: true,
      runs: 1,
    });

    const message = complete.mock.calls[0][0].messages[0].content;
    expect(message).toContain('You are a support agent.');
    expect(message).toContain('Example 1\nInput: I was charged twice.\nIdeal output: billing');
    expect(message).toContain('Question: Where is my refund?');
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
