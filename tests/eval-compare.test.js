import { describe, it, expect, vi } from 'vitest';
import {
  compareByMean,
  normalizeCases,
  runPromptComparison,
  MAX_EVAL_CASES,
} from '../lib/eval-compare.js';

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

describe('normalizeCases', () => {
  it('falls back to a single legacy input/expectedAnswer case', () => {
    expect(normalizeCases({ input: 'France', expectedAnswer: 'Paris' })).toEqual([
      { id: 'case-1', label: 'Case 1', input: 'France', expectedAnswer: 'Paris' },
    ]);
  });

  it('normalizes an explicit cases array', () => {
    expect(
      normalizeCases({
        cases: [
          { input: 'France', expectedAnswer: 'Paris' },
          { id: 'jp', label: 'Japan case', input: 'Japan', expectedAnswer: 'Tokyo' },
        ],
      }),
    ).toEqual([
      { id: 'case-1', label: 'Case 1', input: 'France', expectedAnswer: 'Paris' },
      { id: 'jp', label: 'Japan case', input: 'Japan', expectedAnswer: 'Tokyo' },
    ]);
  });

  it('rejects too many cases', () => {
    const cases = Array.from({ length: MAX_EVAL_CASES + 1 }, (_, i) => ({ input: String(i) }));
    expect(() => normalizeCases({ cases })).toThrow(/At most/);
  });
});

describe('runPromptComparison', () => {
  function mockBatch({ renderedPrompt, mean, output, score }) {
    return {
      renderedPrompt,
      runs: 1,
      expectedAnswer: 'Paris',
      metricId: 'exact-match',
      aggregate: { mean, min: mean, max: mean, count: 1 },
      results: [
        { run: 1, sessionId: 's', output, error: null, status: 'ok', score },
      ],
    };
  }

  it('runs each prompt under shared conditions via runBatch (single case)', async () => {
    const runBatch = vi
      .fn()
      .mockResolvedValueOnce(mockBatch({ renderedPrompt: 'A: France', mean: 1, output: 'Paris', score: 1 }))
      .mockResolvedValueOnce(mockBatch({ renderedPrompt: 'B: France', mean: 0, output: 'The capital is Paris.', score: 0 }));

    const result = await runPromptComparison(
      { llm: { complete: vi.fn() } },
      {
        prompts: [
          { id: 'A', label: 'Prompt A', promptTemplate: 'A: {{input}}' },
          { id: 'B', label: 'Prompt B', promptTemplate: 'B: {{input}}' },
        ],
        input: 'France',
        expectedAnswer: 'Paris',
        metricId: 'exact-match',
        runs: 1,
        runBatch,
      },
    );

    expect(runBatch).toHaveBeenCalledTimes(2);
    expect(result.conditions).toEqual({
      metricId: 'exact-match',
      runs: 1,
      caseCount: 1,
    });
    expect(result.cases).toHaveLength(1);
    expect(result.comparison).toEqual({
      outcome: 'winner',
      winnerId: 'A',
      means: { A: 1, B: 0 },
    });
    expect(result.prompts[0].aggregate.mean).toBe(1);
  });

  it('aggregates overall means across multiple cases', async () => {
    const runBatch = vi.fn()
      // case 1: A=1, B=0
      .mockResolvedValueOnce(mockBatch({ renderedPrompt: 'A1', mean: 1, output: 'Paris', score: 1 }))
      .mockResolvedValueOnce(mockBatch({ renderedPrompt: 'B1', mean: 0, output: 'x', score: 0 }))
      // case 2: A=1, B=1
      .mockResolvedValueOnce(mockBatch({ renderedPrompt: 'A2', mean: 1, output: 'Tokyo', score: 1 }))
      .mockResolvedValueOnce(mockBatch({ renderedPrompt: 'B2', mean: 1, output: 'Tokyo', score: 1 }));

    const result = await runPromptComparison(
      { llm: { complete: vi.fn() } },
      {
        prompts: [
          { id: 'A', label: 'Prompt A', promptTemplate: 'A {{input}}' },
          { id: 'B', label: 'Prompt B', promptTemplate: 'B {{input}}' },
        ],
        cases: [
          { input: 'France', expectedAnswer: 'Paris' },
          { input: 'Japan', expectedAnswer: 'Tokyo' },
        ],
        metricId: 'exact-match',
        runs: 1,
        runBatch,
      },
    );

    expect(runBatch).toHaveBeenCalledTimes(4);
    expect(result.conditions.caseCount).toBe(2);
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0].comparison.winnerId).toBe('A');
    expect(result.prompts.find((p) => p.id === 'A').aggregate.mean).toBe(1);
    expect(result.prompts.find((p) => p.id === 'B').aggregate.mean).toBe(0.5);
    expect(result.comparison.winnerId).toBe('A');
  });

  it('supports a single prompt evaluation', async () => {
    const runBatch = vi
      .fn()
      .mockResolvedValueOnce(mockBatch({ renderedPrompt: 'A: France', mean: 1, output: 'Paris', score: 1 }));

    const result = await runPromptComparison(
      { llm: { complete: vi.fn() } },
      {
        prompts: [{ id: 'A', label: 'Prompt', promptTemplate: 'A: {{input}}' }],
        input: 'France',
        expectedAnswer: 'Paris',
        metricId: 'exact-match',
        runs: 1,
        runBatch,
      },
    );

    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].aggregate.mean).toBe(1);
    expect(result.comparison.outcome).toBe('unscored');
  });

  it('rejects an empty prompts list', async () => {
    await expect(
      runPromptComparison(
        { llm: { complete: vi.fn() } },
        { prompts: [], runBatch: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'NEED_PROMPTS' });
  });
});
