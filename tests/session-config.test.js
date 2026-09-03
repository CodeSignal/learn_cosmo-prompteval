import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ALLOWED_MODELS,
  DEFAULT_MODEL_REF,
  FALLBACK_DEFAULTS,
  assertAllowedModel,
  normalizeAllowedModels,
  normalizeSessionConfig,
} from '../lib/session-config.js';

describe('normalizeSessionConfig', () => {
  it('returns fallback defaults and an empty session when raw is missing', () => {
    expect(normalizeSessionConfig(undefined)).toEqual({
      model: DEFAULT_MODEL_REF,
      allowedModels: [...DEFAULT_ALLOWED_MODELS],
      allowUserModelSelection: false,
      defaults: { ...FALLBACK_DEFAULTS },
      initialSession: { promptA: '', promptB: '', cases: [] },
    });
    expect(normalizeSessionConfig({})).toEqual({
      model: DEFAULT_MODEL_REF,
      allowedModels: [...DEFAULT_ALLOWED_MODELS],
      allowUserModelSelection: false,
      defaults: { ...FALLBACK_DEFAULTS },
      initialSession: { promptA: '', promptB: '', cases: [] },
    });
  });

  it('keeps a trimmed model ref and defaults a blank one', () => {
    expect(normalizeSessionConfig({
      model: '  google/gemini-3.6-flash  ',
    }).model).toBe('google/gemini-3.6-flash');
    expect(normalizeSessionConfig({ model: '   ' }).model).toBe(DEFAULT_MODEL_REF);
    expect(normalizeSessionConfig({ model: 12 }).model).toBe(DEFAULT_MODEL_REF);
  });

  it('only enables user model selection for an explicit true value', () => {
    expect(normalizeSessionConfig({ allowUserModelSelection: true }).allowUserModelSelection)
      .toBe(true);
    expect(normalizeSessionConfig({ allowUserModelSelection: false }).allowUserModelSelection)
      .toBe(false);
    expect(normalizeSessionConfig({ allowUserModelSelection: 'true' }).allowUserModelSelection)
      .toBe(false);
  });

  it('defaults model to the first allowed entry when the default is not listed', () => {
    expect(normalizeSessionConfig({
      allowedModels: ['openai/gpt-5.6-luna', 'google/gemini-3.6-flash'],
    }).model).toBe('openai/gpt-5.6-luna');
  });

  it('keeps a provided model even when it is not in allowedModels', () => {
    const result = normalizeSessionConfig({
      model: 'openai/gpt-4o',
      allowedModels: ['google/gemini-3.6-flash'],
    });
    expect(result.model).toBe('openai/gpt-4o');
    expect(result.allowedModels).toEqual(['google/gemini-3.6-flash']);
    expect(() => assertAllowedModel(result.model, result.allowedModels)).toThrow(/not in allowedModels/);
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

  it('caps initialSession cases at the configured maxCases', () => {
    const result = normalizeSessionConfig({
      defaults: { maxCases: 2 },
      initialSession: {
        cases: [
          { input: 'France', expectedAnswer: 'Paris' },
          { input: 'Japan', expectedAnswer: 'Tokyo' },
          { input: 'Spain', expectedAnswer: 'Madrid' },
        ],
      },
    });
    expect(result.defaults.maxCases).toBe(2);
    expect(result.initialSession.cases).toEqual([
      { input: 'France', expectedAnswer: 'Paris' },
      { input: 'Japan', expectedAnswer: 'Tokyo' },
    ]);
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

describe('normalizeAllowedModels', () => {
  it('returns the default catalog when the value is missing or empty', () => {
    expect(normalizeAllowedModels(undefined)).toEqual(DEFAULT_ALLOWED_MODELS);
    expect(normalizeAllowedModels([])).toEqual(DEFAULT_ALLOWED_MODELS);
    expect(normalizeAllowedModels(['', 12, 'not-a-model'])).toEqual(DEFAULT_ALLOWED_MODELS);
  });

  it('trims, drops invalid refs, and de-duplicates', () => {
    expect(normalizeAllowedModels([
      '  openai/gpt-5.6-luna  ',
      'openai/gpt-5.6-luna',
      'mistral/large',
      'google/gemini-3.6-flash',
    ])).toEqual([
      'openai/gpt-5.6-luna',
      'google/gemini-3.6-flash',
    ]);
  });
});

describe('assertAllowedModel', () => {
  it('accepts a model that is listed', () => {
    expect(() => assertAllowedModel(
      'google/gemini-3.6-flash',
      ['openai/gpt-5.6-luna', 'google/gemini-3.6-flash'],
    )).not.toThrow();
  });

  it('rejects a model that is not listed', () => {
    try {
      assertAllowedModel('openai/gpt-4o', ['google/gemini-3.6-flash']);
      throw new Error('expected assertAllowedModel to throw');
    } catch (err) {
      expect(err.code).toBe('LLM_MODEL_NOT_ALLOWED');
      expect(err.message).toMatch(/openai\/gpt-4o/);
    }
  });

  it('treats google/ and gemini/ as the same provider', () => {
    expect(() => assertAllowedModel(
      'gemini/gemini-3.6-flash',
      ['google/gemini-3.6-flash'],
    )).not.toThrow();
  });

  it('treats deepseek/ and ~deepseek/ as the same provider', () => {
    expect(() => assertAllowedModel(
      'deepseek/deepseek-v4-flash-latest',
      ['~deepseek/deepseek-v4-flash-latest'],
    )).not.toThrow();
  });

  it('does not treat openai/ and deepseek/ as the same provider', () => {
    expect(() => assertAllowedModel(
      'deepseek/gpt-4o',
      ['openai/gpt-4o'],
    )).toThrow(/not in allowedModels/);
  });

  it('matches an allowed ref when the prefix casing differs', () => {
    expect(() => assertAllowedModel(
      'Google/gemini-3.6-flash',
      ['google/gemini-3.6-flash'],
    )).not.toThrow();
  });

  it('still rejects a different model id under the same provider', () => {
    expect(() => assertAllowedModel(
      'google/gemini-2.5-flash',
      ['google/gemini-3.6-flash'],
    )).toThrow(/not in allowedModels/);
  });
});

describe('normalizeSessionConfig allowedModels', () => {
  it('keeps raw configured refs rather than rewriting aliases', () => {
    const result = normalizeSessionConfig({
      model: 'gemini/gemini-3.6-flash',
      allowedModels: ['GEMINI/gemini-3.6-flash', 'openai/gpt-5.6-luna'],
    });
    expect(result.model).toBe('gemini/gemini-3.6-flash');
    expect(result.allowedModels).toEqual([
      'GEMINI/gemini-3.6-flash',
      'openai/gpt-5.6-luna',
    ]);
    expect(() => assertAllowedModel(result.model, result.allowedModels)).not.toThrow();
  });
});
