import { describe, it, expect } from 'vitest';
import { isRenderableResult, normalizeEvalSession } from '../lib/eval-session.js';
import { DEFAULT_METRIC_ID } from '../lib/metrics/index.js';
import { FALLBACK_DEFAULTS } from '../lib/session-config.js';

describe('normalizeEvalSession', () => {
  it('returns an empty session when raw is missing or invalid', () => {
    const empty = {
      model: '',
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
      model: '  google/gemini-3.6-flash  ',
      promptA: 'A',
      promptB: 'B',
      compareMode: true,
      cases: [{ id: 'case-1', input: 'France', expectedAnswer: 'Paris' }],
      metricId: 'contains',
      runs: 3,
      lastResult,
    });
    expect(result).toEqual({
      model: 'google/gemini-3.6-flash',
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

  it('keeps template variables and examples only when the feature is enabled', () => {
    const raw = {
      cases: [{
        id: 'case-1',
        input: 'Hello',
        expectedAnswer: 'Hi',
        variables: { role: 'tutor', ignored: 'drop' },
      }],
      examples: [{
        id: 'example-1',
        input: 'Thanks',
        idealOutput: 'You are welcome',
      }],
    };
    const promptTemplating = {
      enabled: true,
      showPreview: true,
      allowExamples: true,
      variableNames: ['role'],
    };

    const enabled = normalizeEvalSession(raw, { promptTemplating });
    expect(enabled.cases[0].variables).toEqual({ role: 'tutor' });
    expect(enabled.examples).toEqual([{
      id: 'example-1',
      input: 'Thanks',
      idealOutput: 'You are welcome',
    }]);

    const disabled = normalizeEvalSession(raw);
    expect(disabled.cases[0]).not.toHaveProperty('variables');
    expect(disabled).not.toHaveProperty('examples');
  });

  it('keeps only configured structured prompt components', () => {
    const result = normalizeEvalSession({
      promptComponents: {
        active: ['context', 'examples', 'unknown'],
        instruction: 'Summarize the input.',
        context: 'For a beginner.',
        constraints: 12,
        outputFormat: 'One sentence.',
      },
    }, {
      promptTemplating: {
        enabled: true,
        allowExamples: true,
        variableNames: [],
        builder: {
          enabled: true,
          availableComponents: ['context', 'examples', 'constraints'],
        },
      },
    });

    expect(result.promptComponents).toEqual({
      active: ['context', 'examples'],
      instruction: 'Summarize the input.',
      context: 'For a beginner.',
      constraints: '',
      outputFormat: 'One sentence.',
    });
  });

  it('derives saved case variables from the current template', () => {
    const result = normalizeEvalSession({
      promptA: '{{context}}\n{{input}}\n{{constraint}}',
      cases: [{
        input: 'Question',
        variables: { context: 'Background', constraint: 'Be brief', ignored: 'drop' },
      }],
    }, {
      promptTemplating: {
        enabled: true,
        dynamicFields: true,
        allowExamples: false,
        variableNames: [],
      },
    });

    expect(result.cases[0].variables).toEqual({
      context: 'Background',
      constraint: 'Be brief',
    });
  });

  it('keeps freeform {{examples}} variables when allowExamples is off', () => {
    const result = normalizeEvalSession({
      promptA: 'Ticket:\n{{input}}',
      promptB: 'Examples:\n{{examples}}\n\nTicket:\n{{input}}',
      cases: [{
        input: 'Urgent',
        variables: { examples: '"down" → High' },
      }],
    }, {
      promptTemplating: {
        enabled: true,
        dynamicFields: true,
        allowExamples: false,
        variableNames: [],
      },
    });

    expect(result.cases[0].variables).toEqual({
      examples: '"down" → High',
    });
    expect(result).not.toHaveProperty('examples');
  });
});

const completeResult = {
  conditions: { runs: 1, caseCount: 1 },
  prompts: [{ id: 'A', label: 'Prompt', aggregate: { mean: 1 } }],
  cases: [{
    label: 'Case 1',
    input: 'France',
    comparison: { outcome: 'unscored', means: { A: 1 } },
    prompts: [{ id: 'A', label: 'Prompt', results: [] }],
  }],
  comparison: { outcome: 'unscored', means: { A: 1 } },
};

describe('isRenderableResult', () => {
  it('accepts a complete comparison payload', () => {
    expect(isRenderableResult(completeResult)).toBe(true);
    expect(isRenderableResult({
      conditions: { runs: 1, caseCount: 0 },
      prompts: [],
      cases: [],
      comparison: { outcome: 'unscored', means: {} },
    })).toBe(true);
  });

  it('rejects malformed nested result objects', () => {
    expect(isRenderableResult({ prompts: [] })).toBe(false);
    expect(isRenderableResult(null)).toBe(false);
    expect(isRenderableResult({
      ...completeResult,
      comparison: { outcome: 'unscored' },
    })).toBe(false);
    expect(isRenderableResult({
      ...completeResult,
      comparison: { outcome: 'unscored', means: null },
    })).toBe(false);
    expect(isRenderableResult({
      ...completeResult,
      comparison: { outcome: 'unscored', means: ['A'] },
    })).toBe(false);
    expect(isRenderableResult({
      ...completeResult,
      prompts: [{ label: 'Prompt' }],
    })).toBe(false);
    expect(isRenderableResult({
      ...completeResult,
      prompts: [null],
    })).toBe(false);
    expect(isRenderableResult({
      ...completeResult,
      cases: [{ input: 'France' }],
    })).toBe(false);
    expect(isRenderableResult({
      ...completeResult,
      cases: [{
        ...completeResult.cases[0],
        comparison: { outcome: 'unscored' },
      }],
    })).toBe(false);
    expect(isRenderableResult({
      ...completeResult,
      cases: [{
        ...completeResult.cases[0],
        prompts: [{ id: 'A', label: 'Prompt' }],
      }],
    })).toBe(false);
  });
});
