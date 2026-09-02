import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock external deps before importing server
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
  },
}));

vi.mock('../lib/llm/provider.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createLlmProvider: vi.fn(() => ({
      name: 'anthropic',
      model: 'claude-sonnet-4-6',
      complete: vi.fn().mockResolvedValue({ text: 'mock-output', requestId: 'msg-1' }),
    })),
  };
});

vi.mock('../lib/eval-compare.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runPromptComparison: vi.fn(),
  };
});

vi.mock('dotenv/config', () => ({}));

const fs = (await import('fs/promises')).default;
const { runPromptComparison } = await import('../lib/eval-compare.js');

// Set env vars before importing server
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

const { createLlmProvider } = await import('../lib/llm/provider.js');
const { app, resetLlmCache } = await import('../server.js');

// ── GET / PUT /api/eval/session ───────────────────────────────

describe('GET /api/eval/session', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns session null when the file is missing', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app).get('/api/eval/session');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ session: null });
  });

  it('returns a normalized session when the file is present', async () => {
    fs.readFile.mockImplementation(async (p) => {
      const path = String(p);
      if (path.includes('eval-session.json')) {
        return JSON.stringify({
          promptA: 'A',
          promptB: 'B',
          compareMode: true,
          cases: [{ id: 'c1', input: 'France', expectedAnswer: 'Paris' }],
          metricId: 'contains',
          runs: 3,
          lastResult: { conditions: { runs: 3, caseCount: 1 }, prompts: [], cases: [], comparison: {} },
        });
      }
      if (path.includes('session.config.json')) return '{}';
      throw new Error('ENOENT');
    });
    const res = await request(app).get('/api/eval/session');
    expect(res.status).toBe(200);
    expect(res.body.session.promptA).toBe('A');
    expect(res.body.session.compareMode).toBe(true);
    expect(res.body.session.metricId).toBe('contains');
    expect(res.body.session.cases).toHaveLength(1);
    expect(res.body.session.lastResult.conditions.runs).toBe(3);
  });
});

describe('PUT /api/eval/session', () => {
  beforeEach(() => vi.resetAllMocks());

  it('writes a normalized session and returns it', async () => {
    fs.readFile.mockImplementation(async (p) => {
      if (String(p).includes('session.config.json')) return '{}';
      throw new Error('ENOENT');
    });
    fs.writeFile.mockResolvedValue(undefined);
    fs.rename.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/eval/session')
      .send({
        promptA: 'Hello',
        compareMode: true,
        cases: [
          { id: 'c1', input: 'France', expectedAnswer: 'Paris' },
          { id: 'c2', input: 'Japan', expectedAnswer: 'Tokyo' },
          { id: 'c3', input: 'Spain', expectedAnswer: 'Madrid' },
          { id: 'c4', input: 'Italy', expectedAnswer: 'Rome' },
          { id: 'c5', input: 'Peru', expectedAnswer: 'Lima' },
          { id: 'c6', input: 'Chile', expectedAnswer: 'Santiago' },
        ],
        metricId: 'nope',
        runs: 2,
        lastResult: 'bad',
      });

    expect(res.status).toBe(200);
    expect(res.body.session.promptA).toBe('Hello');
    expect(res.body.session.compareMode).toBe(true);
    expect(res.body.session.metricId).toBe('exact-match');
    expect(res.body.session.cases).toHaveLength(5);
    expect(res.body.session.lastResult).toBeNull();
    expect(fs.writeFile).toHaveBeenCalledOnce();
    expect(String(fs.writeFile.mock.calls[0][0])).toMatch(/\.eval-session\.json\.\d+\.[0-9a-f-]{36}\.tmp$/);
    expect(fs.rename).toHaveBeenCalledOnce();
    expect(String(fs.rename.mock.calls[0][1])).toMatch(/eval-session\.json$/);
    const written = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(written.promptA).toBe('Hello');
    expect(written.cases).toHaveLength(5);
  });
});

// ── GET /api/session-config ───────────────────────────────────

describe('GET /api/session-config', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns a normalized empty session when the file is missing', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app).get('/api/session-config');
    expect(res.status).toBe(200);
    expect(res.body.defaults).toEqual({
      minRuns: 1,
      maxRuns: 5,
      minCases: 1,
      maxCases: 5,
    });
    expect(res.body.initialSession).toEqual({
      promptA: '',
      promptB: '',
      cases: [],
    });
  });

  it('returns parsed session.config.json with defaults and initialSession', async () => {
    fs.readFile.mockImplementation(async (p) => {
      if (String(p).includes('session.config.json')) {
        return JSON.stringify({
          defaults: { minRuns: 2, maxRuns: 4 },
          initialSession: {
            promptA: 'Prompt A',
            promptB: 'Prompt B',
            cases: [{ input: 'France', expectedAnswer: 'Paris' }],
          },
        });
      }
      throw new Error('ENOENT');
    });
    const res = await request(app).get('/api/session-config');
    expect(res.status).toBe(200);
    expect(res.body.defaults.minRuns).toBe(2);
    expect(res.body.defaults.maxRuns).toBe(4);
    expect(res.body.initialSession.promptA).toBe('Prompt A');
    expect(res.body.initialSession.promptB).toBe('Prompt B');
    expect(res.body.initialSession.cases).toEqual([
      { input: 'France', expectedAnswer: 'Paris' },
    ]);
  });
});

describe('POST /api/eval/compare', () => {
  beforeEach(() => {
    runPromptComparison.mockReset();
  });

  it('returns 400 when promptA is missing', async () => {
    const res = await request(app)
      .post('/api/eval/compare')
      .send({ promptB: 'B', input: 'x', runs: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/promptA/);
    expect(runPromptComparison).not.toHaveBeenCalled();
  });

  it('returns comparison payload', async () => {
    runPromptComparison.mockResolvedValue({
      conditions: {
        metricId: 'exact-match',
        runs: 2,
        caseCount: 2,
      },
      cases: [],
      prompts: [
        { id: 'A', label: 'Prompt A', aggregate: { mean: 1, min: 1, max: 1, count: 2 }, caseSummaries: [] },
        { id: 'B', label: 'Prompt B', aggregate: { mean: 0, min: 0, max: 0, count: 2 }, caseSummaries: [] },
      ],
      comparison: { outcome: 'winner', winnerId: 'A', means: { A: 1, B: 0 } },
    });

    const res = await request(app)
      .post('/api/eval/compare')
      .send({
        promptA: 'A {{input}}',
        promptB: 'B {{input}}',
        cases: [
          { input: 'France', expectedAnswer: 'Paris' },
          { input: 'Japan', expectedAnswer: 'Tokyo' },
        ],
        metricId: 'exact-match',
        runs: 2,
      });

    expect(res.status).toBe(200);
    expect(res.body.comparison.winnerId).toBe('A');
    expect(runPromptComparison).toHaveBeenCalledOnce();
    const [, opts] = runPromptComparison.mock.calls[0];
    expect(opts.prompts.map((p) => p.id)).toEqual(['A', 'B']);
    expect(opts.cases).toHaveLength(2);
    expect(opts.runs).toBe(2);
  });

  it('accepts a single prompt when promptB is omitted', async () => {
    runPromptComparison.mockResolvedValue({
      conditions: { metricId: 'exact-match', runs: 1, caseCount: 1 },
      cases: [],
      prompts: [
        { id: 'A', label: 'Prompt', aggregate: { mean: 1, min: 1, max: 1, count: 1 }, caseSummaries: [] },
      ],
      comparison: { outcome: 'unscored', winnerId: null, means: { A: 1 } },
    });

    const res = await request(app)
      .post('/api/eval/compare')
      .send({
        promptA: 'Answer briefly.',
        cases: [{ input: 'France', expectedAnswer: 'Paris' }],
        runs: 1,
      });

    expect(res.status).toBe(200);
    const [, opts] = runPromptComparison.mock.calls[0];
    expect(opts.prompts).toEqual([
      { id: 'A', label: 'Prompt', promptTemplate: 'Answer briefly.' },
    ]);
  });

  it('returns 503 when ANTHROPIC_API_KEY is missing', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await request(app)
        .post('/api/eval/compare')
        .send({ promptA: 'Hi', input: 'x', runs: 1 });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
      expect(runPromptComparison).not.toHaveBeenCalled();
    } finally {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it('returns 503 when createLlmProvider throws a configuration error', async () => {
    resetLlmCache();
    const err = new Error('Unsupported LLM_PROVIDER "gemini"');
    err.code = 'LLM_UNSUPPORTED_PROVIDER';
    createLlmProvider.mockImplementationOnce(() => {
      throw err;
    });

    const res = await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'Hi', input: 'x', runs: 1 });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Unsupported LLM_PROVIDER/);
    expect(runPromptComparison).not.toHaveBeenCalled();
    resetLlmCache();
  });

  it('returns 503 when LLM_PROVIDER=openai and OPENAI_API_KEY is missing', async () => {
    const previousProvider = process.env.LLM_PROVIDER;
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.LLM_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;
    try {
      const res = await request(app)
        .post('/api/eval/compare')
        .send({ promptA: 'Hi', input: 'x', runs: 1 });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/OPENAI_API_KEY/);
      expect(runPromptComparison).not.toHaveBeenCalled();
    } finally {
      if (previousProvider === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = previousProvider;
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  });

  it('returns 503 when LLM_PROVIDER=gemini and GOOGLE_API_KEY is missing', async () => {
    const previousProvider = process.env.LLM_PROVIDER;
    const previousKey = process.env.GOOGLE_API_KEY;
    process.env.LLM_PROVIDER = 'gemini';
    delete process.env.GOOGLE_API_KEY;
    try {
      const res = await request(app)
        .post('/api/eval/compare')
        .send({ promptA: 'Hi', input: 'x', runs: 1 });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/GOOGLE_API_KEY/);
      expect(runPromptComparison).not.toHaveBeenCalled();
    } finally {
      if (previousProvider === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = previousProvider;
      if (previousKey === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = previousKey;
    }
  });
});
