import { describe, it, expect, vi } from 'vitest';
import { compareByMean, runPromptComparison } from '../lib/eval-compare.js';

describe('compareByMean', () => {
  it('picks the higher mean as winner', () => {
    expect(
      compareByMean([
        { id: 'A', aggregate: { mean: 0.5, min: 0, max: 1, count: 2 } },
        { id: 'B', aggregate: { mean: 0.9, min: 0.8, max: 1, count: 2 } },
      ]),
    ).toEqual({
      outcome: 'winner',
      winnerId: 'B',
      means: { A: 0.5, B: 0.9 },
    });
  });

  it('ties when means are equal', () => {
    expect(
      compareByMean([
        { id: 'A', aggregate: { mean: 1, min: 1, max: 1, count: 2 } },
        { id: 'B', aggregate: { mean: 1, min: 1, max: 1, count: 2 } },
      ]),
    ).toEqual({
      outcome: 'tie',
      winnerId: null,
      means: { A: 1, B: 1 },
    });
  });

  it('returns unscored when aggregates are missing', () => {
    expect(
      compareByMean([
        { id: 'A', aggregate: null },
        { id: 'B', aggregate: null },
      ]),
    ).toEqual({
      outcome: 'unscored',
      winnerId: null,
      means: { A: null, B: null },
    });
  });
});

describe('runPromptComparison', () => {
  it('runs each prompt under shared conditions via runBatch', async () => {
    const runBatch = vi
      .fn()
      .mockResolvedValueOnce({
        renderedPrompt: 'A: France',
        runs: 2,
        expectedAnswer: 'Paris',
        metricId: 'exact-match',
        aggregate: { mean: 1, min: 1, max: 1, count: 2 },
        results: [
          { run: 1, sessionId: 's1', output: 'Paris', error: null, status: 'ok', score: 1 },
          { run: 2, sessionId: 's2', output: 'Paris', error: null, status: 'ok', score: 1 },
        ],
      })
      .mockResolvedValueOnce({
        renderedPrompt: 'B: France',
        runs: 2,
        expectedAnswer: 'Paris',
        metricId: 'exact-match',
        aggregate: { mean: 0, min: 0, max: 0, count: 2 },
        results: [
          { run: 1, sessionId: 's3', output: 'The capital is Paris.', error: null, status: 'ok', score: 0 },
          { run: 2, sessionId: 's4', output: 'Paris, France', error: null, status: 'ok', score: 0 },
        ],
      });

    const result = await runPromptComparison(
      { baseUrl: 'x', agentId: 'y', octavus: { agentSessions: { attach: vi.fn() } } },
      {
        prompts: [
          { id: 'A', label: 'Prompt A', promptTemplate: 'A: {{input}}' },
          { id: 'B', label: 'Prompt B', promptTemplate: 'B: {{input}}' },
        ],
        input: 'France',
        expectedAnswer: 'Paris',
        metricId: 'exact-match',
        runs: 2,
        runBatch,
      },
    );

    expect(runBatch).toHaveBeenCalledTimes(2);
    expect(runBatch.mock.calls[0][1]).toMatchObject({
      promptTemplate: 'A: {{input}}',
      input: 'France',
      expectedAnswer: 'Paris',
      metricId: 'exact-match',
      runs: 2,
    });
    expect(runBatch.mock.calls[1][1].promptTemplate).toBe('B: {{input}}');
    expect(result.conditions).toEqual({
      input: 'France',
      expectedAnswer: 'Paris',
      metricId: 'exact-match',
      runs: 2,
    });
    expect(result.comparison).toEqual({
      outcome: 'winner',
      winnerId: 'A',
      means: { A: 1, B: 0 },
    });
    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[0].id).toBe('A');
    expect(result.prompts[1].results).toHaveLength(2);
  });

  it('rejects fewer than two prompts', async () => {
    await expect(
      runPromptComparison(
        { baseUrl: 'x', agentId: 'y', octavus: { agentSessions: { attach: vi.fn() } } },
        { prompts: [{ id: 'A', promptTemplate: 'x' }], runBatch: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'NEED_PROMPTS' });
  });
});
