import { describe, it, expect } from 'vitest';
import { buildEvalReportMarkdown } from '../lib/eval-report.js';

describe('buildEvalReportMarkdown', () => {
  it('renders a single-prompt scored report', () => {
    const md = buildEvalReportMarkdown({
      model: 'anthropic/claude-haiku-4-5-20251001',
      provider: 'anthropic',
      promptA: 'Answer with only the capital.',
      generatedAt: '2026-09-08T12:00:00.000Z',
      result: {
        conditions: { metricId: 'exact-match', runs: 2, caseCount: 1 },
        comparison: { outcome: 'unscored', winnerId: null, means: { A: 1 } },
        prompts: [
          { id: 'A', label: 'Prompt', aggregate: { mean: 1, min: 1, max: 1, count: 2 } },
        ],
        cases: [
          {
            id: 'case-1',
            label: 'Case 1',
            input: 'France',
            expectedAnswer: 'Paris',
            comparison: { outcome: 'unscored', winnerId: null, means: { A: 1 } },
            prompts: [
              {
                id: 'A',
                label: 'Prompt',
                aggregate: { mean: 1, min: 1, max: 1, count: 2 },
                results: [
                  { run: 1, status: 'ok', score: 1, output: 'Paris', error: null },
                  { run: 2, status: 'ok', score: 1, output: 'Paris', error: null },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(md).toContain('# Prompt Evaluation Report');
    expect(md).toContain('Single prompt');
    expect(md).toContain('anthropic/claude-haiku-4-5-20251001');
    expect(md).toContain('exact-match');
    expect(md).toContain('France');
    expect(md).toContain('Paris');
    expect(md).toContain('| 1 | ok | 1.00 | Paris |');
  });

  it('renders an A/B winner summary', () => {
    const md = buildEvalReportMarkdown({
      model: 'google/gemini-3.6-flash',
      provider: 'gemini',
      promptA: 'Short answer.',
      promptB: 'Long answer.',
      generatedAt: '2026-09-08T12:00:00.000Z',
      result: {
        conditions: { metricId: 'contains', runs: 1, caseCount: 1 },
        comparison: { outcome: 'winner', winnerId: 'A', means: { A: 1, B: 0 } },
        prompts: [
          { id: 'A', label: 'Prompt A', aggregate: { mean: 1, min: 1, max: 1, count: 1 } },
          { id: 'B', label: 'Prompt B', aggregate: { mean: 0, min: 0, max: 0, count: 1 } },
        ],
        cases: [],
      },
    });

    expect(md).toContain('Prompt A vs Prompt B');
    expect(md).toContain('**Winner:** Prompt A');
    expect(md).toContain('### Prompt B');
  });
});
