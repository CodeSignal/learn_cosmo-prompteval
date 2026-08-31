import { describe, it, expect } from 'vitest';
import {
  DEFAULT_METRIC_ID,
  getMetric,
  isValidMetricId,
  listMetrics,
  scoreOutput,
  summarizeScores,
} from '../lib/metrics/index.js';
import { levenshteinDistance } from '../lib/metrics/string-similarity.js';

describe('metric registry', () => {
  it('lists the four milestone-2 metrics', () => {
    const ids = listMetrics().map((m) => m.id);
    expect(ids).toEqual([
      'exact-match',
      'exact-match-ci',
      'contains',
      'string-similarity',
    ]);
    expect(DEFAULT_METRIC_ID).toBe('exact-match');
  });

  it('validates metric ids', () => {
    expect(isValidMetricId('contains')).toBe(true);
    expect(isValidMetricId('nope')).toBe(false);
    expect(getMetric('contains')?.name).toBe('Contains');
  });
});

describe('exact-match', () => {
  const metric = getMetric('exact-match');

  it('scores 1 for identical trimmed strings', () => {
    expect(metric.score('  Paris  ', 'Paris')).toBe(1);
  });

  it('scores 0 when case differs', () => {
    expect(metric.score('paris', 'Paris')).toBe(0);
  });
});

describe('exact-match-ci', () => {
  const metric = getMetric('exact-match-ci');

  it('ignores case', () => {
    expect(metric.score('pArIs', 'Paris')).toBe(1);
  });

  it('still requires full equality', () => {
    expect(metric.score('Paris France', 'Paris')).toBe(0);
  });
});

describe('contains', () => {
  const metric = getMetric('contains');

  it('scores 1 when expected is a substring', () => {
    expect(metric.score('The capital is Paris.', 'Paris')).toBe(1);
  });

  it('is case-sensitive', () => {
    expect(metric.score('The capital is paris.', 'Paris')).toBe(0);
  });
});

describe('string-similarity', () => {
  const metric = getMetric('string-similarity');

  it('scores 1 for identical strings', () => {
    expect(metric.score('Paris', 'Paris')).toBe(1);
  });

  it('scores between 0 and 1 for near misses', () => {
    const score = metric.score('Parix', 'Paris');
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });

  it('exposes levenshteinDistance for unit checks', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });
});

describe('scoreOutput / summarizeScores', () => {
  it('returns null when expected answer is blank', () => {
    expect(scoreOutput('Paris', '', 'exact-match')).toBeNull();
    expect(scoreOutput('Paris', '   ', 'exact-match')).toBeNull();
  });

  it('scores with the selected metric', () => {
    expect(scoreOutput('paris', 'Paris', 'exact-match')).toBe(0);
    expect(scoreOutput('paris', 'Paris', 'exact-match-ci')).toBe(1);
  });

  it('aggregates mean/min/max', () => {
    expect(summarizeScores([1, 0, 0.5, null])).toEqual({
      mean: 0.5,
      min: 0,
      max: 1,
      count: 3,
    });
    expect(summarizeScores([null, undefined])).toBeNull();
  });
});
