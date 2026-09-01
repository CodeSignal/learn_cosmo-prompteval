import { describe, it, expect } from 'vitest';
import {
  collectPromptScores,
  binScores,
  summarizeDistribution,
} from '../lib/score-distribution.js';

describe('collectPromptScores', () => {
  it('flattens finite scores for one prompt across cases', () => {
    const cases = [
      {
        prompts: [
          { id: 'A', results: [{ score: 1 }, { score: 0 }, { score: null }] },
          { id: 'B', results: [{ score: 0.5 }] },
        ],
      },
      {
        prompts: [
          { id: 'A', results: [{ score: 1 }] },
        ],
      },
    ];
    expect(collectPromptScores(cases, 'A')).toEqual([1, 0, 1]);
    expect(collectPromptScores(cases, 'B')).toEqual([0.5]);
  });
});

describe('binScores', () => {
  it('puts 0 in the first bin and 1 in the last', () => {
    expect(binScores([0, 1], 5)).toEqual([1, 0, 0, 0, 1]);
  });

  it('places mid scores into interior bins', () => {
    expect(binScores([0.1, 0.5, 0.9], 5)).toEqual([1, 0, 1, 0, 1]);
  });
});

describe('summarizeDistribution', () => {
  it('counts perfect scores', () => {
    expect(summarizeDistribution([1, 0, 1, 0.75])).toEqual({
      count: 4,
      perfectCount: 2,
      bins: [1, 0, 0, 1, 2],
    });
  });
});
