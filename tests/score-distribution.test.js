import { describe, it, expect } from 'vitest';
import {
  collectPromptScores,
  collectPromptScoresByCase,
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

describe('collectPromptScoresByCase', () => {
  it('keeps scores grouped per case', () => {
    const cases = [
      {
        id: 'c1',
        label: 'Case 1',
        prompts: [{ id: 'A', results: [{ score: 1 }, { score: 0 }] }],
      },
      {
        id: 'c2',
        label: 'Case 2',
        prompts: [{ id: 'A', results: [{ score: 1 }] }],
      },
    ];
    expect(collectPromptScoresByCase(cases, 'A')).toEqual([
      { caseId: 'c1', caseLabel: 'Case 1', scores: [1, 0] },
      { caseId: 'c2', caseLabel: 'Case 2', scores: [1] },
    ]);
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
