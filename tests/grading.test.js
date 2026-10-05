import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  checkLabelFormat,
  countWords,
  fieldValue,
  gradeCustomCheck,
  gradePrompt,
  loadCandidateWork,
} from '../lib/grading.js';

const SCHEMA = [
  { label: 'Allergens', type: 'list', allowed: ['MILK', 'EGG', 'SOY', 'WHEAT'], exclusive: ['NONE', 'CHECK WITH CHEF'] },
  { label: 'Diet', type: 'enum', allowed: ['VEGAN', 'VEGETARIAN', 'NONE', 'CHECK WITH CHEF'] },
  { label: 'Blurb', type: 'text', maxWords: 5 },
];

describe('checkLabelFormat', () => {
  it('accepts exactly the schema lines with allowed values', () => {
    expect(checkLabelFormat('Allergens: EGG, MILK\n\nDiet: VEGETARIAN\nBlurb: Fluffy omelette.', SCHEMA))
      .toEqual({ ok: true, problems: [] });
    expect(checkLabelFormat('Allergens: NONE\nDiet: VEGAN\nBlurb: Crisp salad.', SCHEMA).ok).toBe(true);
  });

  it('reports each machine-readability problem', () => {
    expect(checkLabelFormat('Here is the label:\nAllergens: dairy\nDiet: VEGAN\nBlurb: A b c d e f', SCHEMA).problems)
      .toEqual([
        'expected 3 lines, got 4',
        'line 1 must start with "Allergens:"',
        'line 2 must start with "Diet:"',
        'line 3 must start with "Blurb:"',
      ]);
    expect(checkLabelFormat('Allergens: dairy, EGG, EGG\nDiet: vegan\nBlurb: A b c d e f', SCHEMA).problems)
      .toEqual([
        'Allergens has unknown values: dairy',
        'Allergens repeats a value',
        'Diet "vegan" is not one of VEGAN, VEGETARIAN, NONE, CHECK WITH CHEF',
        'Blurb has 6 words (max 5)',
      ]);
    expect(checkLabelFormat('Allergens: NONE, EGG\nDiet: NONE\nBlurb: Toast.', SCHEMA).problems)
      .toEqual(['Allergens mixes NONE/CHECK WITH CHEF with other values']);
  });

  it('counts words and reads normalized field values', () => {
    expect(countWords('  one two\tthree ')).toBe(3);
    expect(fieldValue('Allergens: MILK, EGG', 'allergens')).toBe('egg, milk');
    expect(fieldValue('nothing here', 'Diet')).toBeNull();
  });
});

describe('loadCandidateWork', () => {
  it('prefers submission.json and falls back to eval-session.json', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grading-'));
    await fs.writeFile(path.join(dir, 'eval-session.json'), JSON.stringify({
      promptA: 'from session',
      customCheckCriteria: 'session criteria',
    }));
    expect(await loadCandidateWork(dir)).toMatchObject({ promptA: 'from session', criteria: 'session criteria' });

    await fs.mkdir(path.join(dir, '.codesignal'));
    await fs.writeFile(path.join(dir, '.codesignal', 'submission.json'), JSON.stringify({
      prompt: { template: 'from submission' },
      customCheck: { criteria: 'submission criteria' },
      notes: 'n',
      history: { evaluations: [{ n: 1 }] },
    }));
    expect(await loadCandidateWork(dir)).toMatchObject({
      promptA: 'from submission',
      criteria: 'submission criteria',
      notes: 'n',
      history: { evaluations: [{ n: 1 }], calibrations: [] },
    });
  });
});

describe('gradePrompt', () => {
  it('re-runs the prompt and reports field accuracy, consistency, and the common answer', async () => {
    const outputs = [
      'Allergens: EGG\nDiet: VEGETARIAN\nBlurb: One.',
      'Allergens: EGG\nDiet: VEGETARIAN\nBlurb: Two.',
      'Allergens: MILK\nDiet: VEGETARIAN\nBlurb: Three.',
    ];
    let call = 0;
    const llm = { name: 'x', model: 'm', complete: vi.fn(async () => ({ text: outputs[call++ % 3] })) };
    const [graded] = await gradePrompt({
      llm,
      promptA: 'Label:\n{{input}}',
      cases: [{ id: 'd1', input: 'omelette', expected: { Allergens: 'EGG', Diet: 'VEGETARIAN' } }],
      runs: 3,
      fields: ['Allergens', 'Diet'],
      reasoningEffort: 'minimal',
      maxConcurrency: 1,
    });
    expect(llm.complete).toHaveBeenCalledTimes(3);
    expect(llm.complete.mock.calls[0][0]).toMatchObject({
      reasoningEffort: 'minimal',
      messages: [{ role: 'user', content: 'Label:\nomelette' }],
    });
    expect(graded).toMatchObject({
      id: 'd1',
      errors: 0,
      fieldAccuracy: { Allergens: 2 / 3, Diet: 1 },
      consistency: { agreeing: 2, runs: 3 },
      commonAnswerCorrect: true,
    });
  });
});

describe('gradeCustomCheck', () => {
  const samples = [
    { id: 'p1', input: 'a', output: 'ok', verdict: 'pass' },
    { id: 'p2', input: 'a', output: 'ok', verdict: 'pass' },
    { id: 'f1', input: 'a', output: 'bad', verdict: 'fail' },
    { id: 'f2', input: 'a', output: 'bad', verdict: 'fail' },
  ];

  it('uses balanced accuracy so a one-sided check does not score well', async () => {
    const alwaysFail = { name: 'x', model: 'j', complete: vi.fn(async () => ({ text: 'VERDICT: FAIL' })) };
    const result = await gradeCustomCheck({ llm: alwaysFail, criteria: 'Fail everything.', samples });
    expect(result).toMatchObject({ agreement: 0.5, passRecall: 0, failRecall: 1, balancedAccuracy: 0.5 });
  });

  it('scores criteria over the length limit as zero without calling the judge', async () => {
    const llm = { name: 'x', model: 'j', complete: vi.fn() };
    expect(await gradeCustomCheck({ llm, criteria: 'x'.repeat(11), maxCriteriaLength: 10, samples }))
      .toMatchObject({ balancedAccuracy: 0, tooLong: true });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('scores empty criteria as zero without calling the judge', async () => {
    const llm = { name: 'x', model: 'j', complete: vi.fn() };
    expect(await gradeCustomCheck({ llm, criteria: '  ', samples })).toMatchObject({ balancedAccuracy: 0 });
    expect(llm.complete).not.toHaveBeenCalled();
  });
});
