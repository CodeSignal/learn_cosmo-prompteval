import { describe, it, expect } from 'vitest';
import {
  buildSubmission,
  buildSubmissionMarkdown,
  summarizeCalibration,
  summarizeEvaluation,
  summarizeLatestEvaluation,
  textVersion,
  withHistoryRow,
} from '../lib/assessment-store.js';
import { normalizeSessionConfig } from '../lib/session-config.js';
import { normalizeEvalSession } from '../lib/eval-session.js';

const config = normalizeSessionConfig({
  model: 'anthropic/claude-haiku-4-5-20251001',
  allowedModels: ['anthropic/claude-haiku-4-5-20251001'],
  allowedMetricIds: ['field-match', 'custom-check'],
  assessment: {
    enabled: true,
    stage: 'l2',
    stageLabel: 'Level 2 of 3',
    customCheck: { enabled: true },
    notes: { enabled: true },
  },
});
const limits = { ...config.defaults, allowedMetricIds: config.allowedMetricIds, assessment: config.assessment };

const result = {
  conditions: { metricId: 'field-match', runs: 3, criteria: 'Be strict.' },
  prompts: [{ id: 'A', aggregate: { mean: 0.75 }, consistency: { stability: 2 / 3 }, scoreErrors: 1 }],
  cases: [
    {
      id: 'p1',
      label: 'Fries',
      provided: true,
      prompts: [{
        id: 'A',
        aggregate: { mean: 1 },
        consistency: { agreeing: 3, runs: 3, commonAnswer: 'Allergens: SHELLFISH' },
        results: [],
      }],
    },
    {
      id: 'own-1',
      label: 'Your case 1',
      prompts: [{ id: 'A', aggregate: { mean: 0.5 }, results: [{ status: 'ok', output: 'Diet: NONE' }] }],
    },
  ],
};

describe('assessment submission', () => {
  const session = normalizeEvalSession({
    model: 'anthropic/claude-haiku-4-5-20251001',
    promptA: 'Label the dish:\n```\n{{input}}\n```',
    cases: [{ id: 'c1', input: 'coconut curry', expectedAnswer: 'Allergens: NONE' }],
    customCheckCriteria: 'Blurb at most 25 words.',
    notes: 'Added tie-break rules.',
    metricId: 'field-match',
    runs: 3,
  }, limits);

  it('captures the candidate artifacts and keeps prior history', () => {
    const previous = { history: { evaluations: [{ n: 1 }], calibrations: [] }, latestEvaluation: { cases: [] } };
    const submission = buildSubmission({ config, session, previous, updatedAt: 'T' });
    expect(submission).toMatchObject({
      version: 1,
      updatedAt: 'T',
      stage: 'l2',
      prompt: { template: session.promptA, version: textVersion(session.promptA) },
      candidateCases: [{ id: 'c1', input: 'coconut curry', expectedAnswer: 'Allergens: NONE' }],
      customCheck: { criteria: 'Blurb at most 25 words.' },
      notes: 'Added tie-break rules.',
      settings: { metricId: 'field-match', runs: 3 },
      history: { evaluations: [{ n: 1 }], calibrations: [] },
      latestEvaluation: { cases: [] },
    });
  });

  it('summarizes evaluations and calibrations as compact history rows', () => {
    expect(summarizeEvaluation({ n: 2, at: 'T', stage: 'l2', result, promptTemplate: 'P' })).toEqual({
      n: 2,
      at: 'T',
      stage: 'l2',
      promptVersion: textVersion('P'),
      criteriaVersion: textVersion('Be strict.'),
      metricId: 'field-match',
      runs: 3,
      caseCount: 2,
      providedCases: 1,
      candidateCases: 1,
      compare: false,
      mean: 0.75,
      stability: 2 / 3,
      scoreErrors: 1,
    });
    expect(summarizeCalibration({
      n: 1,
      at: 'T',
      stage: 'l2',
      calibration: { criteria: 'C', agreement: { agreeing: 7, total: 10, scored: 9 } },
    })).toEqual({ n: 1, at: 'T', stage: 'l2', criteriaVersion: textVersion('C'), agreeing: 7, total: 10, unscored: 1 });
  });

  it('keeps the latest per-case view of the graded prompt', () => {
    expect(summarizeLatestEvaluation(result).cases).toEqual([
      { id: 'p1', label: 'Fries', provided: true, mean: 1, agreeing: 3, compared: 3, commonOutput: 'Allergens: SHELLFISH' },
      { id: 'own-1', label: 'Your case 1', provided: false, mean: 0.5, agreeing: null, compared: null, commonOutput: 'Diet: NONE' },
    ]);
  });

  it('writes readable markdown that candidate text cannot break out of', () => {
    let submission = buildSubmission({ config, session, updatedAt: 'T' });
    submission = withHistoryRow(submission, 'evaluations', summarizeEvaluation({
      n: 1, at: 'T', stage: 'l2', result, promptTemplate: session.promptA,
    }));
    submission = { ...submission, latestEvaluation: summarizeLatestEvaluation(result) };
    const markdown = buildSubmissionMarkdown(submission);
    expect(markdown).toContain('## Prompt (graded)\n\n````\nLabel the dish:\n```\n{{input}}\n```\n````');
    expect(markdown).toContain('| 1 | l2 | field-match | 3 | 1 + 1 |');
    expect(markdown).toContain('| Provided: Fries | 1.00 | 3/3 | Allergens: SHELLFISH |');
    expect(markdown).toContain('## Custom check criteria');
    expect(markdown).toContain('## Copied from the reference material');
    expect(markdown).toContain('**Copy/paste of the reference material: NO**');
  });
});
