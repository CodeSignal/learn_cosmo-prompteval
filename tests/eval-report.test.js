import { describe, it, expect } from 'vitest';
import {
  buildEvalReportHistoryMarkdown,
  buildEvalReportMarkdown,
} from '../lib/eval-report.js';

describe('buildEvalReportMarkdown', () => {
  it('renders a single-prompt scored report', () => {
    const md = buildEvalReportMarkdown({
      model: 'anthropic/claude-haiku-4-5-20251001',
      provider: 'anthropic',
      promptA: 'Answer with only the capital.',
      generatedAt: '2026-09-08T12:00:00.000Z',
      result: {
        conditions: { metricId: 'exact-match', runs: 2, caseCount: 1, durationMs: 4200 },
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
    expect(md).toContain('| Runs each | 2 |');
    expect(md).toContain('| Duration | 4.2s |');
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

  it('identifies a separately configured judge model', () => {
    const md = buildEvalReportMarkdown({
      model: 'openai/generation-model',
      provider: 'openai',
      promptA: 'Answer.',
      result: {
        conditions: {
          metricId: 'llm-judge',
          judgeModel: 'anthropic/claude-sonnet-4-6',
          runs: 1,
          caseCount: 1,
        },
        prompts: [],
        cases: [],
        comparison: { outcome: 'unscored', winnerId: null, means: {} },
      },
    });

    expect(md).toContain('| Model | openai/generation-model |');
    expect(md).toContain('| Judge model | anthropic/claude-sonnet-4-6 |');
  });

  it('records template examples, case variables, and the filled-in prompt', () => {
    const md = buildEvalReportMarkdown({
      model: 'anthropic/test-model',
      provider: 'anthropic',
      promptA: 'You are a {{role}}.\n{{examples}}\n{{input}}',
      result: {
        conditions: { metricId: 'exact-match', runs: 1, caseCount: 1 },
        templateContext: {
          examples: [{ input: 'Hello', idealOutput: 'Hi' }],
        },
        comparison: { outcome: 'unscored', winnerId: null, means: { A: 1 } },
        prompts: [{ id: 'A', label: 'Prompt', aggregate: { mean: 1 } }],
        cases: [{
          id: 'case-1',
          label: 'Case 1',
          input: 'Thanks',
          expectedAnswer: 'Welcome',
          variables: { role: 'support agent' },
          comparison: { outcome: 'unscored', winnerId: null, means: { A: 1 } },
          prompts: [{
            id: 'A',
            label: 'Prompt',
            renderedPrompt: 'You are a support agent.\nExample 1\nInput: Hello\nIdeal output: Hi\nThanks',
            aggregate: { mean: 1 },
            results: [],
          }],
        }],
      },
    });

    expect(md).toContain('## Shared examples');
    expect(md).toContain('- **Ideal output:** Hi');
    expect(md).toContain('- **role:** support agent');
    expect(md).toContain('Filled-in prompt:');
    expect(md).toContain('You are a support agent.');
  });

  it('keeps each completed evaluation in numbered history sections', () => {
    const first = '# Prompt Evaluation Report\n\nGenerated: first\n\n## Setup\n\nFirst setup\n';
    const second = '# Prompt Evaluation Report\n\nGenerated: second\n\n## Setup\n\nSecond setup\n';

    const history = buildEvalReportHistoryMarkdown('', first);
    const updated = buildEvalReportHistoryMarkdown(history, second);

    expect(updated).toContain('## Evaluation 1\n\nGenerated: first');
    expect(updated).toContain('## Evaluation 2\n\nGenerated: second');
    expect(updated).toContain('### Setup\n\nFirst setup');
    expect(updated).toContain('### Setup\n\nSecond setup');
    expect(updated.match(/^# Prompt Evaluation Report$/gmu)).toHaveLength(1);
  });

  it('migrates a legacy single-evaluation report before appending', () => {
    const legacy = '# Prompt Evaluation Report\n\nGenerated: old\n\n## Setup\n\nOld setup\n';
    const next = '# Prompt Evaluation Report\n\nGenerated: new\n\n## Setup\n\nNew setup\n';

    const history = buildEvalReportHistoryMarkdown(legacy, next);

    expect(history).toContain('## Evaluation 1\n\nGenerated: old');
    expect(history).toContain('## Evaluation 2\n\nGenerated: new');
  });
});
