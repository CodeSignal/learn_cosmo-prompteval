import { describe, it, expect } from 'vitest';
import { evalProgressPercent, formatEvalProgress } from '../lib/eval-progress.js';

describe('formatEvalProgress', () => {
  it('shows a simple start message before totals are known', () => {
    expect(formatEvalProgress({ phase: 'start', completed: 0, total: 0 })).toBe(
      'Running evaluation…',
    );
    expect(formatEvalProgress({
      phase: 'start',
      completed: 0,
      total: 0,
      compareMode: true,
    })).toBe('Comparing prompts…');
  });

  it('includes counts, case, prompt, and run details', () => {
    expect(formatEvalProgress({
      phase: 'run_done',
      completed: 3,
      total: 8,
      active: 2,
      caseLabel: 'Case 2',
      promptLabel: 'Prompt A',
      run: 1,
    })).toBe('Running evaluation · 3/8 complete · Case 2 · Prompt A · run 1 · 2 in flight…');
  });

  it('returns Done when finished', () => {
    expect(formatEvalProgress({ phase: 'done', completed: 4, total: 4 })).toBe('Done.');
    expect(formatEvalProgress({ phase: 'run_done', completed: 4, total: 4 })).toBe('Done.');
  });
});

describe('evalProgressPercent', () => {
  it('clamps to 0–100', () => {
    expect(evalProgressPercent(0, 4)).toBe(0);
    expect(evalProgressPercent(1, 4)).toBe(25);
    expect(evalProgressPercent(4, 4)).toBe(100);
    expect(evalProgressPercent(9, 4)).toBe(100);
    expect(evalProgressPercent(1, 0)).toBe(0);
  });
});
