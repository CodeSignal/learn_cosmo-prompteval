import { describe, it, expect } from 'vitest';
import { FALLBACK_DEFAULTS, normalizeSessionConfig } from '../lib/session-config.js';

describe('normalizeSessionConfig', () => {
  it('returns fallback defaults and an empty session when raw is missing', () => {
    expect(normalizeSessionConfig(undefined)).toEqual({
      defaults: { ...FALLBACK_DEFAULTS },
      initialSession: { promptA: '', promptB: '', cases: [] },
    });
    expect(normalizeSessionConfig({})).toEqual({
      defaults: { ...FALLBACK_DEFAULTS },
      initialSession: { promptA: '', promptB: '', cases: [] },
    });
  });

  it('applies optional default bounds', () => {
    const result = normalizeSessionConfig({
      defaults: { minRuns: 2, maxRuns: 3, minCases: 1, maxCases: 2 },
    });
    expect(result.defaults).toEqual({
      minRuns: 2,
      maxRuns: 3,
      minCases: 1,
      maxCases: 2,
    });
  });

  it('clamps bounds to the fallback range and ignores inverted pairs', () => {
    expect(normalizeSessionConfig({
      defaults: { minRuns: 0, maxRuns: 99 },
    }).defaults).toEqual({
      ...FALLBACK_DEFAULTS,
      minRuns: FALLBACK_DEFAULTS.minRuns,
      maxRuns: FALLBACK_DEFAULTS.maxRuns,
    });

    expect(normalizeSessionConfig({
      defaults: { minRuns: 4, maxRuns: 2 },
    }).defaults.minRuns).toBe(FALLBACK_DEFAULTS.minRuns);
    expect(normalizeSessionConfig({
      defaults: { minRuns: 4, maxRuns: 2 },
    }).defaults.maxRuns).toBe(FALLBACK_DEFAULTS.maxRuns);
  });

  it('normalizes initialSession prompts and cases', () => {
    const result = normalizeSessionConfig({
      initialSession: {
        promptA: 'Prompt A',
        promptB: 'Prompt B',
        cases: [
          { input: 'France', expectedAnswer: 'Paris' },
          { input: 12, expectedAnswer: null },
          'skip-me',
          { expectedAnswer: 'only-expected' },
        ],
      },
    });
    expect(result.initialSession).toEqual({
      promptA: 'Prompt A',
      promptB: 'Prompt B',
      cases: [
        { input: 'France', expectedAnswer: 'Paris' },
        { input: '', expectedAnswer: '' },
        { input: '', expectedAnswer: 'only-expected' },
      ],
    });
  });

  it('treats non-string prompts and a missing cases array as empty', () => {
    const result = normalizeSessionConfig({
      initialSession: { promptA: 1, promptB: null, cases: { input: 'x' } },
    });
    expect(result.initialSession).toEqual({
      promptA: '',
      promptB: '',
      cases: [],
    });
  });
});
