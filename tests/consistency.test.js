import { describe, it, expect } from 'vitest';
import {
  consistencyKey,
  normalizeConsistencyFields,
  resolveConsistencyFields,
  summarizeConsistency,
  summarizeOverallConsistency,
} from '../lib/consistency.js';

const ok = (output) => ({ status: 'ok', output, error: null });

describe('consistency', () => {
  it('compares whole outputs after trimming, case, and whitespace', () => {
    expect(consistencyKey('  Vegan\n', [])).toBe(consistencyKey('vegan', []));
    const summary = summarizeConsistency([ok('Vegan'), ok(' vegan '), ok('Vegetarian')]);
    expect(summary).toMatchObject({
      basis: [],
      runs: 3,
      agreeing: 2,
      agreement: 2 / 3,
      distinct: 2,
      commonAnswer: 'Vegan',
      errors: 0,
    });
  });

  it('compares only the chosen fields so free text can vary', () => {
    const summary = summarizeConsistency([
      ok('Allergens: EGG, MILK\nDiet: VEGETARIAN\nBlurb: Fluffy omelette.'),
      ok('Allergens: milk, egg\nDiet: VEGETARIAN\nBlurb: A soft omelette with herbs.'),
      ok('Allergens: EGG\nDiet: VEGETARIAN\nBlurb: Omelette.'),
    ], ['Allergens', 'Diet']);
    expect(summary).toMatchObject({ agreeing: 2, runs: 3, distinct: 2 });
  });

  it('never counts unreadable runs as agreeing and ignores failed runs', () => {
    const summary = summarizeConsistency([
      ok('Diet: VEGAN'),
      ok('The dish is vegan.'),
      ok('The dish is vegan.'),
      { status: 'error', output: '', error: 'timeout' },
    ], ['Diet']);
    expect(summary).toMatchObject({
      runs: 3,
      agreeing: 1,
      distinct: 3,
      unreadable: 2,
      errors: 1,
      commonAnswer: 'Diet: VEGAN',
    });

    const allUnreadable = summarizeConsistency([ok('Allergens:\n- Egg'), ok('Allergens:\n- Egg')], ['Allergens']);
    expect(allUnreadable).toMatchObject({ agreeing: 0, agreement: 0, unreadable: 2 });
  });

  it('needs two runs before reporting agreement', () => {
    expect(summarizeConsistency([ok('x')]).agreement).toBeNull();
  });

  it('averages agreement across cases for a prompt', () => {
    expect(summarizeOverallConsistency([
      { agreement: 1 },
      { agreement: 0.6 },
      { agreement: null },
      null,
    ])).toEqual({ stability: 0.8, consistentCases: 1, comparedCases: 2 });
    expect(summarizeOverallConsistency([])).toEqual({
      stability: null,
      consistentCases: 0,
      comparedCases: 0,
    });
  });

  it('uses configured fields, then field-match labels, then the whole output', () => {
    expect(resolveConsistencyFields({ fields: ['Diet'], metricId: 'field-match', expectedAnswer: 'Allergens: EGG' }))
      .toEqual(['Diet']);
    expect(resolveConsistencyFields({ fields: [], metricId: 'field-match', expectedAnswer: 'Allergens: EGG\nDiet: NONE' }))
      .toEqual(['Allergens', 'Diet']);
    expect(resolveConsistencyFields({ metricId: 'exact-match', expectedAnswer: 'Diet: NONE' })).toEqual([]);
  });

  it('normalizes configured field names', () => {
    expect(normalizeConsistencyFields([' Diet ', 'diet', 5, '', 'Allergens'])).toEqual(['Diet', 'Allergens']);
  });
});
