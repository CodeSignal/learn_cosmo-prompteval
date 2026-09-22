import { describe, it, expect } from 'vitest';
import { DEFAULT_CONCURRENCY } from '../lib/concurrency.js';
import {
  DEFAULT_ALLOWED_MODELS,
  DEFAULT_ALLOWED_METRIC_IDS,
  DEFAULT_MODEL_REF,
  DEFAULT_PROMPT_TEMPLATING,
  FALLBACK_DEFAULTS,
  assertAllowedModel,
  normalizeAllowedModels,
  normalizeAllowedMetricIds,
  normalizePromptTemplating,
  normalizeSessionConfig,
} from '../lib/session-config.js';

describe('normalizeSessionConfig', () => {
  it('returns fallback defaults and an empty session when raw is missing', () => {
    expect(normalizeSessionConfig(undefined)).toEqual({
      model: DEFAULT_MODEL_REF,
      allowedModels: [...DEFAULT_ALLOWED_MODELS],
      allowedMetricIds: [...DEFAULT_ALLOWED_METRIC_IDS],
      llmJudgeModel: null,
      allowUserModelSelection: false,
      allowCompare: false,
      maxConcurrency: DEFAULT_CONCURRENCY,
      features: { promptTemplating: { ...DEFAULT_PROMPT_TEMPLATING } },
      defaults: { ...FALLBACK_DEFAULTS },
      initialSession: { promptA: '', promptB: '', cases: [] },
    });
    expect(normalizeSessionConfig({})).toEqual({
      model: DEFAULT_MODEL_REF,
      allowedModels: [...DEFAULT_ALLOWED_MODELS],
      allowedMetricIds: [...DEFAULT_ALLOWED_METRIC_IDS],
      llmJudgeModel: null,
      allowUserModelSelection: false,
      allowCompare: false,
      maxConcurrency: DEFAULT_CONCURRENCY,
      features: { promptTemplating: { ...DEFAULT_PROMPT_TEMPLATING } },
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

  it('only enables compare UI for an explicit true value', () => {
    expect(normalizeSessionConfig({ allowCompare: true }).allowCompare).toBe(true);
    expect(normalizeSessionConfig({ allowCompare: false }).allowCompare).toBe(false);
    expect(normalizeSessionConfig({ allowCompare: 'true' }).allowCompare).toBe(false);
  });

  it('normalizes an optional fixed LLM judge model', () => {
    expect(normalizeSessionConfig({
      llmJudgeModel: '  anthropic/claude-sonnet-4-6  ',
    }).llmJudgeModel).toBe('anthropic/claude-sonnet-4-6');
    expect(normalizeSessionConfig({ llmJudgeModel: 'not-a-model' }).llmJudgeModel).toBeNull();
    expect(normalizeSessionConfig({}).llmJudgeModel).toBeNull();
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
      defaults: { runs: 3, minRuns: 2, maxRuns: 3, minCases: 1, maxCases: 2 },
    });
    expect(result.defaults).toEqual({
      runs: 3,
      minRuns: 2,
      maxRuns: 3,
      minCases: 1,
      maxCases: 2,
    });
  });

  it('clamps the initial run count to the configured run limits', () => {
    expect(normalizeSessionConfig({
      defaults: { runs: 1, minRuns: 1, maxRuns: 5 },
    }).defaults.runs).toBe(1);
    expect(normalizeSessionConfig({
      defaults: { runs: 1, minRuns: 3, maxRuns: 5 },
    }).defaults.runs).toBe(3);
    expect(normalizeSessionConfig({
      defaults: { runs: 99, minRuns: 1, maxRuns: 5 },
    }).defaults.runs).toBe(5);
  });

  it('normalizes maxConcurrency and defaults when omitted', () => {
    expect(normalizeSessionConfig({ maxConcurrency: 2 }).maxConcurrency).toBe(2);
    expect(normalizeSessionConfig({ maxConcurrency: 0 }).maxConcurrency).toBe(1);
    expect(normalizeSessionConfig({ maxConcurrency: 99 }).maxConcurrency).toBe(50);
    expect(normalizeSessionConfig({}).maxConcurrency).toBe(DEFAULT_CONCURRENCY);
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

  it('normalizes config-gated prompt templating, variables, and examples', () => {
    const result = normalizeSessionConfig({
      features: {
        promptTemplating: {
          enabled: true,
          templateEditable: true,
          showPreview: true,
          allowExamples: true,
          fields: [
            { name: 'input', label: 'Customer message' },
            { name: 'role', label: 'Agent role', multiline: false },
            'tone',
            'constructor',
            '__proto__',
            'bad name',
            'role',
          ],
        },
      },
      initialSession: {
        promptA: 'You are a {{role}}. Use a {{tone}} tone.',
        cases: [{
          input: 'Hello',
          variables: { role: 'tutor', tone: 'warm', ignored: 'x' },
        }],
        examples: [{ input: 'Hi', idealOutput: 'Hello!' }],
      },
    });

    expect(result.features.promptTemplating).toEqual({
      enabled: true,
      templateEditable: true,
      showPreview: true,
      allowExamples: true,
      fields: [
        { name: 'input', label: 'Customer message', multiline: true },
        { name: 'role', label: 'Agent role', multiline: false },
        { name: 'tone', label: 'Tone', multiline: true },
      ],
      variableNames: ['role', 'tone'],
      dynamicFields: false,
      strictFields: false,
      builder: {
        enabled: false,
        availableComponents: [],
        defaultComponents: [],
        allowMultipleInputs: false,
        showExpectedAnswer: false,
      },
    });
    expect(result.initialSession.cases[0].variables).toEqual({
      role: 'tutor',
      tone: 'warm',
    });
    expect(result.initialSession.examples).toEqual([
      { input: 'Hi', idealOutput: 'Hello!' },
    ]);
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

describe('normalizeAllowedMetricIds', () => {
  it('keeps Course 1 metrics when configuration is omitted', () => {
    expect(normalizeAllowedMetricIds(undefined)).toEqual(DEFAULT_ALLOWED_METRIC_IDS);
    expect(normalizeAllowedMetricIds([])).toEqual(DEFAULT_ALLOWED_METRIC_IDS);
  });

  it('enables only known configured metrics', () => {
    expect(normalizeAllowedMetricIds([
      'exact-match',
      'valid-json',
      'llm-judge',
      'unknown',
      'valid-json',
    ])).toEqual(['exact-match', 'valid-json', 'llm-judge']);
  });
});

describe('normalizePromptTemplating', () => {
  it('keeps every feature off when configuration is missing', () => {
    expect(normalizePromptTemplating(undefined)).toEqual(DEFAULT_PROMPT_TEMPLATING);
  });

  it('ignores child options until templating is enabled', () => {
    expect(normalizePromptTemplating({
      showPreview: true,
      allowExamples: true,
      fields: ['tone'],
    })).toEqual(DEFAULT_PROMPT_TEMPLATING);
  });

  it('normalizes the structured builder component controls', () => {
    expect(normalizePromptTemplating({
      enabled: true,
      builder: {
        enabled: true,
        availableComponents: ['context', 'examples', 'unknown'],
        defaultComponents: ['examples', 'constraints'],
        allowMultipleInputs: true,
        showExpectedAnswer: true,
      },
    }).builder).toEqual({
      enabled: true,
      availableComponents: ['context', 'examples'],
      defaultComponents: ['examples'],
      allowMultipleInputs: true,
      showExpectedAnswer: true,
    });
  });

  it('derives initial case variables from prompt placeholders in dynamic mode', () => {
    const result = normalizeSessionConfig({
      features: {
        promptTemplating: {
          enabled: true,
          dynamicFields: true,
          strictFields: true,
        },
      },
      initialSession: {
        promptA: 'Context: {{context}}\nInput: {{input}}\nRule: {{constraint}}',
        cases: [{
          input: 'Question',
          variables: { context: 'Background', constraint: 'Be brief', ignored: 'drop' },
        }],
      },
    });

    expect(result.features.promptTemplating.dynamicFields).toBe(true);
    expect(result.features.promptTemplating.strictFields).toBe(true);
    expect(result.features.promptTemplating.fields).toEqual([]);
    expect(result.initialSession.cases[0].variables).toEqual({
      context: 'Background',
      constraint: 'Be brief',
    });
  });

  it('keeps freeform {{examples}} as a case variable when allowExamples is off', () => {
    const result = normalizeSessionConfig({
      features: {
        promptTemplating: {
          enabled: true,
          dynamicFields: true,
        },
      },
      initialSession: {
        promptA: 'Ticket:\n{{input}}',
        promptB: 'Examples:\n{{examples}}\n\nTicket:\n{{input}}',
        cases: [{
          input: 'Urgent but has workaround',
          variables: { examples: '"down" → High' },
        }],
      },
    });

    expect(result.features.promptTemplating.allowExamples).toBe(false);
    expect(result.initialSession.cases[0].variables).toEqual({
      examples: '"down" → High',
    });
    expect(result.initialSession).not.toHaveProperty('examples');
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
