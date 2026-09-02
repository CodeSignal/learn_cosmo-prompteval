import { describe, it, expect } from 'vitest';
import { isRenderableResult, normalizeEvalSession } from '../lib/eval-session.js';
import { DEFAULT_METRIC_ID } from '../lib/metrics/index.js';
import { FALLBACK_DEFAULTS } from '../lib/session-config.js';

describe('normalizeEvalSession', () => {
  it('returns an empty session when raw is missing or invalid', () => {
    const empty = {
      promptA: '',
      promptB: '',
      compareMode: false,
      cases: [],
      metricId: DEFAULT_METRIC_ID,
      runs: 2,
      lastResult: null,
    };
    expect(normalizeEvalSession(undefined)).toEqual(empty);
    expect(normalizeEvalSession({})).toEqual(empty);
    expect(normalizeEvalSession([])).toEqual(empty);
  });

  it('keeps valid fields and case ids', () => {
    const lastResult = { conditions: { runs: 1, caseCount: 1 }, prompts: [], cases: [], comparison: {} };
    const result = normalizeEvalSession({
      promptA: 'A',
      promptB: 'B',
      compareMode: true,
      cases: [{ id: 'case-1', input: 'France', expectedAnswer: 'Paris' }],
      metricId: 'contains',
      runs: 3,
      lastResult,
    });
    expect(result).toEqual({
      promptA: 'A',
      promptB: 'B',
      compareMode: true,
      cases: [{ id: 'case-1', input: 'France', expectedAnswer: 'Paris' }],
      metricId: 'contains',
      runs: 3,
      lastResult,
    });
  });

  it('caps cases at maxCases and assigns ids when missing', () => {
    const result = normalizeEvalSession({
      cases: [
        { input: 'France', expectedAnswer: 'Paris' },
        { input: 'Japan', expectedAnswer: 'Tokyo' },
        { input: 'Spain', expectedAnswer: 'Madrid' },
      ],
    }, { maxCases: 2 });
    expect(result.cases).toEqual([
      { id: 'case-0', input: 'France', expectedAnswer: 'Paris' },
      { id: 'case-1', input: 'Japan', expectedAnswer: 'Tokyo' },
    ]);
  });

  it('drops lastResult when it is not a plain object', () => {
    expect(normalizeEvalSession({ lastResult: 'nope' }).lastResult).toBeNull();
    expect(normalizeEvalSession({ lastResult: ['x'] }).lastResult).toBeNull();
    expect(normalizeEvalSession({ lastResult: null }).lastResult).toBeNull();
  });

  it('falls back to the default metric and clamps runs', () => {
    expect(normalizeEvalSession({ metricId: 'nope', runs: 99 }).metricId).toBe(DEFAULT_METRIC_ID);
    expect(normalizeEvalSession({ runs: 99 }).runs).toBe(FALLBACK_DEFAULTS.maxRuns);
    expect(normalizeEvalSession({ runs: 0 }).runs).toBe(FALLBACK_DEFAULTS.minRuns);
    expect(normalizeEvalSession({ compareMode: 'yes' }).compareMode).toBe(false);
  });
});

describe('isRenderableResult', () => {
  it('accepts a comparison-shaped payload', () => {
    expect(isRenderableResult({
      conditions: { runs: 1, caseCount: 1 },
      prompts: [],
      cases: [],
      comparison: { outcome: 'unscored' },
    })).toBe(true);
    expect(isRenderableResult({ prompts: [] })).toBe(false);
    expect(isRenderableResult(null)).toBe(false);
  });
});
