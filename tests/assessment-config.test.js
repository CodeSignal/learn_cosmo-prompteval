import { describe, it, expect } from 'vitest';
import {
  ASSESSMENT_LIMITS,
  DEFAULT_ASSESSMENT,
  normalizeAssessmentConfig,
} from '../lib/assessment-config.js';
import { normalizeSessionConfig } from '../lib/session-config.js';
import { normalizeEvalSession } from '../lib/eval-session.js';

describe('normalizeAssessmentConfig', () => {
  it('is disabled unless enabled is literally true', () => {
    expect(normalizeAssessmentConfig(undefined)).toEqual(DEFAULT_ASSESSMENT);
    expect(normalizeAssessmentConfig({ enabled: 'yes', stage: 'l1' })).toEqual(DEFAULT_ASSESSMENT);
  });

  it('normalizes provided cases, materials, and calibration samples', () => {
    const result = normalizeAssessmentConfig({
      enabled: true,
      stage: ' l2 ',
      stageLabel: 'Level 2 of 3',
      materials: [{ title: 'Kitchen memo', body: 'Coconut is not a tree nut.' }, 'bad'],
      providedCases: [
        { id: 'p1', input: 'fries', expectedAnswer: 'Diet: VEGAN' },
        { id: 'p1', input: 'duplicate id' },
        { id: 'bad id!', input: 'soup', variables: { station: 'grill', 'bad-name': 'x', n: 3 } },
      ],
      customCheck: {
        enabled: true,
        calibrationSamples: [
          { id: 's1', input: 'a', output: 'b', verdict: 'pass' },
          { id: 's2', input: 'a', output: 'b', verdict: 'maybe' },
        ],
      },
      consistency: { enabled: true, fields: ['Allergens', 'Diet'] },
      notes: { enabled: true, label: 'Findings', maxLength: 999999 },
      temperature: 5,
      reasoningEffort: 'minimal',
    });
    expect(result.stage).toBe('l2');
    expect(result.eyebrow).toBe('');
    expect(normalizeAssessmentConfig({ enabled: true, eyebrow: ' Harbor & Hearth · Menu label pilot ' }).eyebrow)
      .toBe('Harbor & Hearth · Menu label pilot');
    expect(result.materials).toEqual([
      { id: 'material-1', title: 'Kitchen memo', body: 'Coconut is not a tree nut.' },
    ]);
    expect(result.providedCases.map((c) => c.id)).toEqual(['p1', 'provided-2', 'provided-3']);
    expect(result.providedCases[2].variables).toEqual({ station: 'grill' });
    expect(result.customCheck.calibrationSamples.map((s) => s.id)).toEqual(['s1']);
    expect(result.consistency).toEqual({ enabled: true, fields: ['Allergens', 'Diet'] });
    expect(result.notes).toMatchObject({ enabled: true, label: 'Findings', maxLength: 20000 });
    expect(result.temperature).toBeNull();
    expect(result.maxPromptLength).toBeNull();
    expect(normalizeAssessmentConfig({ enabled: true, maxPromptLength: 4000 }).maxPromptLength).toBe(4000);
    expect(result.reasoningEffort).toBe('minimal');
    expect(normalizeAssessmentConfig({ enabled: true, reasoningEffort: 'none' }).reasoningEffort).toBe('none');
    expect(normalizeAssessmentConfig({ enabled: true, reasoningEffort: 'extreme' }).reasoningEffort).toBeNull();
  });

  it('caps budgets at the hard limits', () => {
    const result = normalizeAssessmentConfig({
      enabled: true,
      maxCandidateCases: 999,
      maxCallsPerEvaluation: 99999,
    });
    expect(result.maxCandidateCases).toBe(ASSESSMENT_LIMITS.maxCandidateCases);
    expect(result.maxCallsPerEvaluation).toBe(ASSESSMENT_LIMITS.maxCallsPerEvaluation);
  });
});

describe('assessment limits in session config', () => {
  it('lets assessment mode raise runs and cases above the Course range', () => {
    const course = normalizeSessionConfig({ defaults: { maxRuns: 10, maxCases: 20 } });
    expect(course.defaults).toMatchObject({ maxRuns: 5, maxCases: 5 });

    const assessment = normalizeSessionConfig({
      assessment: { enabled: true },
      defaults: { maxRuns: 99, maxCases: 15 },
    });
    expect(assessment.defaults).toMatchObject({
      maxRuns: ASSESSMENT_LIMITS.maxRuns,
      maxCases: 15,
    });
  });
});

describe('assessment fields in eval sessions', () => {
  const assessment = normalizeAssessmentConfig({
    enabled: true,
    maxCandidateCases: 2,
    customCheck: { enabled: true },
    notes: { enabled: true, maxLength: 5 },
  });

  it('keeps candidate work only in assessment mode', () => {
    const raw = {
      stage: 'l1',
      customCheckCriteria: 'Blurb under 25 words.',
      notes: 'Stability went from 60% to 100%.',
      excludedCaseIds: ['c1', 'c1', 7],
      cases: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    };
    const course = normalizeEvalSession(raw);
    expect(course).not.toHaveProperty('customCheckCriteria');
    expect(course.cases).toHaveLength(3);

    const result = normalizeEvalSession(raw, { assessment });
    // Stored as typed (no silent truncation); limits are enforced where the text is used.
    expect(result).toMatchObject({
      stage: 'l1',
      customCheckCriteria: 'Blurb under 25 words.',
      notes: 'Stability went from 60% to 100%.',
      excludedCaseIds: ['c1'],
      lastCalibration: null,
    });
    expect(result.cases.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('drops candidate cases when the level uses provided cases only', () => {
    const closed = normalizeAssessmentConfig({ enabled: true, allowCandidateCases: false });
    expect(normalizeEvalSession({ cases: [{ id: 'a' }] }, { assessment: closed }).cases).toEqual([]);
  });
});
