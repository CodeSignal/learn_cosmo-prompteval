import { describe, it, expect, vi } from 'vitest';
import fieldMatch, {
  compareLabeledFields,
  normalizeFieldValue,
  parseLabeledFields,
} from '../lib/metrics/field-match.js';
import {
  CUSTOM_CHECK_SYSTEM_PROMPT,
  buildCustomCheckMessage,
  parseCustomCheckVerdict,
} from '../lib/metrics/custom-check.js';
import { isScoringEnabled, scoreOutputDetailed } from '../lib/metrics/index.js';
import { runCustomCheckCalibration } from '../lib/custom-check-calibration.js';

const LABEL = 'Allergens: EGG, MILK\nDiet: VEGETARIAN\nBlurb: Fluffy omelette with chives.';

describe('field-match', () => {
  it('parses labeled lines and keeps the first occurrence', () => {
    const fields = parseLabeledFields('Allergens: EGG\nDiet: NONE\nDiet: VEGAN\nnot a field');
    expect([...fields.keys()]).toEqual(['allergens', 'diet']);
    expect(fields.get('diet').value).toBe('NONE');
  });

  it('keeps colons inside values', () => {
    expect(parseLabeledFields('Summary: Ready at 10:30').get('summary').value).toBe('Ready at 10:30');
  });

  it('normalizes case, spacing, trailing periods, and list order', () => {
    expect(normalizeFieldValue(' Milk,  egg. ')).toBe('egg, milk');
    expect(normalizeFieldValue('EGG, MILK')).toBe('egg, milk');
  });

  it('scores only the fields written in Expected Answer', () => {
    expect(fieldMatch.score(LABEL, 'Allergens: MILK, EGG\nDiet: vegetarian')).toBe(1);
    expect(fieldMatch.score(LABEL, 'Allergens: MILK\nDiet: VEGETARIAN')).toBe(0.5);
    expect(fieldMatch.score(LABEL, 'Blurb: Something else')).toBe(0);
  });

  it('does not accept markdown-decorated labels', () => {
    expect(fieldMatch.score('**Diet:** VEGAN', 'Diet: VEGAN')).toBe(0);
  });

  it('falls back to a whole-output comparison when expected has no labels', () => {
    expect(fieldMatch.score('Vegan', 'vegan')).toBe(1);
    expect(fieldMatch.score('Vegan', '')).toBe(0);
  });

  it('reports each field comparison', () => {
    expect(compareLabeledFields(LABEL, 'Diet: VEGAN\nCalories: 200')).toEqual([
      { label: 'Diet', expected: 'VEGAN', actual: 'VEGETARIAN', match: false },
      { label: 'Calories', expected: '200', actual: null, match: false },
    ]);
  });
});

describe('custom-check verdicts', () => {
  it('parses PASS/FAIL with an optional reason', () => {
    expect(parseCustomCheckVerdict('VERDICT: PASS\nREASON: All rules met.')).toEqual({
      verdict: 'pass',
      reason: 'All rules met.',
    });
    expect(parseCustomCheckVerdict('fail')).toEqual({ verdict: 'fail', reason: '' });
    expect(parseCustomCheckVerdict('**FAIL** because')).toEqual({ verdict: 'fail', reason: '' });
    expect(parseCustomCheckVerdict('It looks fine to me')).toBeNull();
  });

  it('wraps criteria, input, output, and reference in tags', () => {
    const message = buildCustomCheckMessage({
      criteria: 'Blurb has at most 25 words.',
      input: 'omelette, chives',
      output: LABEL,
      expectedAnswer: 'Diet: VEGETARIAN',
    });
    expect(message).toContain('<CRITERIA>\nBlurb has at most 25 words.\n</CRITERIA>');
    expect(message).toContain('<INPUT>\nomelette, chives\n</INPUT>');
    expect(message).toContain('<REFERENCE>\nDiet: VEGETARIAN\n</REFERENCE>');
  });

  it('does not require an expected answer', () => {
    expect(isScoringEnabled('custom-check', '')).toBe(true);
    expect(isScoringEnabled('llm-judge', '')).toBe(false);
  });
});

describe('scoreOutputDetailed', () => {
  it('runs the custom check with its own system prompt and returns the reason', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'VERDICT: FAIL\nREASON: Blurb is 30 words.' });
    const detail = await scoreOutputDetailed(LABEL, '', 'custom-check', {
      llm: { name: 'x', model: 'judge', complete },
      criteria: 'Blurb has at most 25 words.',
      input: 'omelette',
    });
    expect(detail).toEqual({ score: 0, reason: 'Blurb is 30 words.' });
    expect(complete.mock.calls[0][0]).toMatchObject({
      system: CUSTOM_CHECK_SYSTEM_PROMPT,
      temperature: 0,
    });
  });

  it('skips the custom check when criteria are empty', async () => {
    const complete = vi.fn();
    expect(await scoreOutputDetailed(LABEL, '', 'custom-check', {
      llm: { name: 'x', model: 'judge', complete },
      criteria: '  ',
    })).toEqual({ score: null });
    expect(complete).not.toHaveBeenCalled();
  });

  it('reports judge failures instead of silently dropping them', async () => {
    const detail = await scoreOutputDetailed(LABEL, 'Diet: VEGAN', 'llm-judge', {
      llm: { name: 'x', model: 'judge', complete: vi.fn().mockResolvedValue({ text: 'about 0.7' }) },
    });
    expect(detail.score).toBeNull();
    expect(detail.error).toMatch(/not a number/u);

    const failed = await scoreOutputDetailed(LABEL, '', 'custom-check', {
      llm: { name: 'x', model: 'judge', complete: vi.fn().mockRejectedValue(new Error('rate limited')) },
      criteria: 'Anything',
    });
    expect(failed).toEqual({ score: null, error: 'rate limited' });
  });
});

describe('runCustomCheckCalibration', () => {
  const samples = [
    { id: 's1', input: 'a', output: 'good', verdict: 'pass' },
    { id: 's2', input: 'b', output: 'bad', verdict: 'fail' },
    { id: 's3', input: 'c', output: 'bad', verdict: 'fail' },
  ];

  it('counts agreement with reviewer verdicts', async () => {
    const complete = vi.fn(async ({ messages }) => ({
      text: messages[0].content.includes('good') ? 'VERDICT: PASS\nREASON: ok' : 'VERDICT: PASS\nREASON: lenient',
    }));
    const result = await runCustomCheckCalibration({
      llm: { name: 'x', model: 'judge', complete },
      model: 'judge',
      criteria: 'Be strict.',
      samples,
    });
    expect(result.agreement).toEqual({ agreeing: 1, total: 3, scored: 3, rate: 1 / 3 });
    expect(result.samples.map((s) => [s.id, s.verdict, s.agree])).toEqual([
      ['s1', 'pass', true],
      ['s2', 'pass', false],
      ['s3', 'pass', false],
    ]);
  });

  it('marks unparseable replies as unscored disagreements', async () => {
    const result = await runCustomCheckCalibration({
      llm: { name: 'x', model: 'judge', complete: vi.fn().mockResolvedValue({ text: 'maybe' }) },
      criteria: 'Be strict.',
      samples: samples.slice(0, 1),
    });
    expect(result.agreement).toEqual({ agreeing: 0, total: 1, scored: 0, rate: 0 });
    expect(result.samples[0]).toMatchObject({ verdict: null, agree: false });
    expect(result.samples[0].error).toMatch(/no PASS or FAIL/u);
  });

  it('rejects empty criteria', async () => {
    await expect(runCustomCheckCalibration({
      llm: { name: 'x', model: 'judge', complete: vi.fn() },
      criteria: ' ',
      samples,
    })).rejects.toMatchObject({ code: 'EMPTY_CRITERIA' });
  });
});
