import { describe, it, expect, vi } from 'vitest';
import {
  collectAssistantText,
  normalizeRunCount,
  runEvalBatch,
  runSingleEval,
  MAX_EVAL_RUNS,
  MIN_EVAL_RUNS,
  EVAL_TRIGGER_NAME,
} from '../lib/eval-run.js';

describe('normalizeRunCount', () => {
  it('clamps to 1–10', () => {
    expect(normalizeRunCount(0)).toBe(MIN_EVAL_RUNS);
    expect(normalizeRunCount(99)).toBe(MAX_EVAL_RUNS);
    expect(normalizeRunCount('3')).toBe(3);
    expect(normalizeRunCount('nope')).toBe(MIN_EVAL_RUNS);
  });
});

describe('collectAssistantText', () => {
  it('concatenates text-delta events', async () => {
    async function* events() {
      yield { type: 'start' };
      yield { type: 'text-delta', delta: 'Hello' };
      yield { type: 'text-delta', delta: ' world' };
      yield { type: 'finish' };
    }
    await expect(collectAssistantText(events())).resolves.toEqual({
      output: 'Hello world',
      error: null,
    });
  });

  it('captures stream errors', async () => {
    async function* events() {
      yield { type: 'text-delta', delta: 'partial' };
      yield { type: 'error', message: 'boom' };
    }
    await expect(collectAssistantText(events())).resolves.toEqual({
      output: 'partial',
      error: 'boom',
    });
  });
});

describe('runSingleEval / runEvalBatch', () => {
  function makeDeps() {
    const execute = vi.fn(async function* () {
      yield { type: 'text-delta', delta: 'ok' };
    });
    const attach = vi.fn(() => ({ execute }));
    const createSession = vi.fn()
      .mockResolvedValueOnce('sess-1')
      .mockResolvedValueOnce('sess-2')
      .mockResolvedValueOnce('sess-3');

    return {
      deps: {
        baseUrl: 'https://example.test',
        apiKey: 'key',
        agentId: 'agent-eval',
        octavus: { agentSessions: { attach } },
        createSession,
      },
      execute,
      attach,
      createSession,
    };
  }

  it('creates a fresh session and fires run-prompt once', async () => {
    const { deps, execute, attach, createSession } = makeDeps();
    const result = await runSingleEval(deps, {
      renderedPrompt: 'Say hi',
      run: 1,
    });

    expect(createSession).toHaveBeenCalledWith({
      baseUrl: 'https://example.test',
      apiKey: 'key',
      agentId: 'agent-eval',
      input: {},
    });
    expect(attach).toHaveBeenCalledWith('sess-1');
    expect(execute).toHaveBeenCalledWith({
      type: 'trigger',
      triggerName: EVAL_TRIGGER_NAME,
      input: { PROMPT: 'Say hi' },
    });
    expect(result).toMatchObject({
      run: 1,
      sessionId: 'sess-1',
      output: 'ok',
      status: 'ok',
      error: null,
    });
  });

  it('runs N independent sessions sequentially', async () => {
    const { deps, createSession, attach } = makeDeps();
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
    expect(createSession).toHaveBeenCalledTimes(3);
    expect(attach.mock.calls.map((c) => c[0])).toEqual(['sess-1', 'sess-2', 'sess-3']);
    expect(new Set(batch.results.map((r) => r.sessionId)).size).toBe(3);
  });

  it('scores outputs when expectedAnswer is provided', async () => {
    const { deps, execute } = makeDeps();
    execute.mockImplementation(async function* () {
      yield { type: 'text-delta', delta: 'Paris' };
    });

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

  it('rejects an empty rendered prompt', async () => {
    const { deps } = makeDeps();
    await expect(
      runEvalBatch(deps, { promptTemplate: '   ', input: '', runs: 1 }),
    ).rejects.toMatchObject({ code: 'EMPTY_PROMPT' });
  });
});
