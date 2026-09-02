import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock external deps before importing server
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
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

vi.mock('../lib/eval-run.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runEvalBatch: vi.fn(),
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
const { runEvalBatch } = await import('../lib/eval-run.js');
const { runPromptComparison } = await import('../lib/eval-compare.js');

// Set env vars before importing server
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

const { createLlmProvider } = await import('../lib/llm/provider.js');
const { app, resetLlmCache } = await import('../server.js');

// ── GET /api/config ───────────────────────────────────────────

describe('GET /api/config', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns parsed config from chat-config.json', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ model: 'openai/gpt-4o', temperature: 0.5 }));
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ model: 'openai/gpt-4o', temperature: 0.5 });
  });

  it('returns empty object when config file is missing', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('attaches htmlLang and catalog strings when language matches a locale', async () => {
    fs.readdir = vi.fn().mockResolvedValue(['es.json']);
    fs.readFile.mockImplementation(async (p) => {
      const path = String(p);
      if (path.includes('chat-config')) return JSON.stringify({ language: 'Spanish', model: 'x' });
      if (path.endsWith('es.json')) {
        return JSON.stringify({
          languageNames: ['es', 'spanish'],
          strings: { Settings: 'Configuración' },
        });
      }
      throw new Error('ENOENT');
    });
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.htmlLang).toBe('es');
    expect(res.body.strings.Settings).toBe('Configuración');
    expect(res.body.language).toBe('Spanish');
  });
});

// ── GET /api/models ───────────────────────────────────────────

describe('GET /api/models', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns parsed models from text file', async () => {
    fs.readFile.mockImplementation((path) => {
      if (path.includes('current-models')) return Promise.resolve('openai/gpt-4o\nanthropic/claude-3\n');
      if (path.includes('chat-config')) return Promise.resolve('{}');
      if (path.includes('model-capabilities')) {
        return Promise.resolve(JSON.stringify({
          models: {
            'openai/gpt-4o': { supportsThinking: false },
            'anthropic/claude-3': { supportsThinking: true },
          },
        }));
      }
      return Promise.reject(new Error('ENOENT'));
    });
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(['openai/gpt-4o', 'anthropic/claude-3']);
    expect(res.body.capabilities).toEqual({
      'openai/gpt-4o': { supportsThinking: false },
      'anthropic/claude-3': { supportsThinking: true },
    });
  });

  it('filters models by allowedModels config', async () => {
    fs.readFile.mockImplementation((path) => {
      if (path.includes('current-models')) return Promise.resolve('openai/gpt-4o\nanthropic/claude-3\n');
      if (path.includes('chat-config')) return Promise.resolve(JSON.stringify({ allowedModels: ['openai/gpt-4o'] }));
      if (path.includes('model-capabilities')) return Promise.resolve(JSON.stringify({ models: {} }));
      return Promise.reject(new Error('ENOENT'));
    });
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(['openai/gpt-4o']);
    expect(res.body.capabilities).toHaveProperty('openai/gpt-4o');
  });

  it('applies thinkingModels config overrides on capabilities', async () => {
    fs.readFile.mockImplementation((path) => {
      if (path.includes('current-models')) {
        return Promise.resolve('openrouter/amazon/nova-premier-v1\n');
      }
      if (path.includes('chat-config')) {
        return Promise.resolve(JSON.stringify({
          thinkingModels: ['openrouter/amazon/nova-premier-v1'],
        }));
      }
      if (path.includes('model-capabilities')) {
        return Promise.resolve(JSON.stringify({
          models: {
            'openrouter/amazon/nova-premier-v1': { supportsThinking: false },
          },
        }));
      }
      return Promise.reject(new Error('ENOENT'));
    });
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.capabilities['openrouter/amazon/nova-premier-v1']).toEqual({
      supportsThinking: true,
    });
  });

  it('returns empty array when models file is missing', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([]);
    expect(res.body.capabilities).toEqual({});
  });
});

// ── GET /api/sessions ─────────────────────────────────────────

describe('GET /api/sessions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns sessions sorted newest first', async () => {
    const sessions = {
      sessions: [
        { session_id: 'old', created_at: '2026-01-01', updated_at: '2026-01-01', messages: [{ role: 'user', content: 'Old chat' }] },
        { session_id: 'new', created_at: '2026-06-01', updated_at: '2026-06-01', messages: [{ role: 'user', content: 'New chat' }] },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions[0].session_id).toBe('new');
    expect(res.body.sessions[1].session_id).toBe('old');
  });

  it('derives titles from the first user message', async () => {
    const sessions = {
      sessions: [
        { session_id: 's1', messages: [{ role: 'user', content: 'Help me with Python' }] },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    const res = await request(app).get('/api/sessions');
    expect(res.body.sessions[0].title).toBe('Help me with Python');
  });

  it('returns empty list when no sessions file exists', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'));
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([]);
  });
});

// ── GET /api/session ──────────────────────────────────────────

describe('GET /api/session', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns a specific session by id', async () => {
    const sessions = {
      sessions: [
        { session_id: 'target', messages: [{ role: 'user', content: 'Hello' }] },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    const res = await request(app).get('/api/session?id=target');
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('target');
    expect(res.body.messages).toHaveLength(1);
  });

  it('returns 404 when requested session id is not found', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ sessions: [] }));
    const res = await request(app).get('/api/session?id=nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns the most recently updated session when no id given', async () => {
    const sessions = {
      sessions: [
        { session_id: 'older', created_at: '2026-01-01', updated_at: '2026-01-01', messages: [] },
        { session_id: 'newer', created_at: '2026-06-01', updated_at: '2026-06-01', messages: [] },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    const res = await request(app).get('/api/session');
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('newer');
  });

  it('returns 501 when no stored session exists to resume', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ sessions: [] }));
    const res = await request(app).get('/api/session');
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not available/i);
  });
});

// ── POST /api/sessions ────────────────────────────────────────

describe('POST /api/sessions', () => {
  it('returns 501 because remote chat sessions are not available', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({ model: 'anthropic/claude-sonnet-4-6', temperature: 0.7, thinking: 'off' });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not available/i);
  });
});

describe('POST /api/session/fork', () => {
  it('returns 501 because remote chat sessions are not available', async () => {
    const res = await request(app)
      .post('/api/session/fork')
      .send({ oldSessionId: 'old', messages: [] });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not available/i);
  });
});

// ── DELETE /api/sessions/:sessionId ───────────────────────────

describe('DELETE /api/sessions/:sessionId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('removes the session and writes back', async () => {
    const sessions = {
      sessions: [
        { session_id: 'keep', messages: [] },
        { session_id: 'delete-me', messages: [] },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    fs.writeFile.mockResolvedValue(undefined);

    const res = await request(app).delete('/api/sessions/delete-me');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const written = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(written.sessions).toHaveLength(1);
    expect(written.sessions[0].session_id).toBe('keep');
  });
});

// ── POST /api/session/save ────────────────────────────────────

describe('POST /api/session/save', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates an existing session with new messages', async () => {
    const sessions = {
      sessions: [{ session_id: 's1', created_at: '2026-01-01', messages: [] }],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(sessions));
    fs.writeFile.mockResolvedValue(undefined);

    const newMessages = [{ role: 'user', content: 'Hello' }];
    const res = await request(app)
      .post('/api/session/save')
      .send({ sessionId: 's1', messages: newMessages });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const written = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(written.sessions[0].messages).toEqual(newMessages);
    expect(written.sessions[0].updated_at).toBeDefined();
  });

  it('creates a new session entry if sessionId is not found', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ sessions: [] }));
    fs.writeFile.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/session/save')
      .send({ sessionId: 'brand-new', messages: [{ role: 'user', content: 'Hi' }] });

    expect(res.status).toBe(200);
    const written = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(written.sessions).toHaveLength(1);
    expect(written.sessions[0].session_id).toBe('brand-new');
  });

  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app)
      .post('/api/session/save')
      .send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when messages is not an array', async () => {
    const res = await request(app)
      .post('/api/session/save')
      .send({ sessionId: 's1', messages: 'not-an-array' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/upload-urls ─────────────────────────────────────

describe('POST /api/upload-urls', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app)
      .post('/api/upload-urls')
      .send({ files: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when files is missing', async () => {
    const res = await request(app)
      .post('/api/upload-urls')
      .send({ sessionId: 's1' });
    expect(res.status).toBe(400);
  });

  it('returns 501 when the body is valid', async () => {
    const res = await request(app)
      .post('/api/upload-urls')
      .send({ sessionId: 's1', files: [{ name: 'a.txt' }] });
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not available/i);
  });
});

// ── POST /api/trigger ─────────────────────────────────────────

describe('POST /api/trigger', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app)
      .post('/api/trigger')
      .send({ message: 'hello' });
    expect(res.status).toBe(400);
  });

  it('returns 501 when sessionId is present', async () => {
    const res = await request(app)
      .post('/api/trigger')
      .send({ sessionId: 's1', message: 'hello' });
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not available/i);
  });
});

// ── POST /api/eval/run ────────────────────────────────────────

describe('POST /api/eval/run', () => {
  beforeEach(() => {
    runEvalBatch.mockReset();
  });

  it('returns 400 when promptTemplate is missing', async () => {
    const res = await request(app).post('/api/eval/run').send({ input: 'x', runs: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/promptTemplate/);
    expect(runEvalBatch).not.toHaveBeenCalled();
  });

  it('returns 400 when runs is out of range', async () => {
    const res = await request(app)
      .post('/api/eval/run')
      .send({ promptTemplate: 'Hi {{input}}', input: 'there', runs: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/runs/);
    expect(runEvalBatch).not.toHaveBeenCalled();
  });

  it('returns the batch payload from runEvalBatch', async () => {
    runEvalBatch.mockResolvedValue({
      renderedPrompt: 'Say hello',
      runs: 2,
      expectedAnswer: 'hello',
      metricId: 'exact-match',
      aggregate: { mean: 1, min: 1, max: 1, count: 2 },
      results: [
        { run: 1, sessionId: 'sess-a', output: 'hello', error: null, status: 'ok', score: 1 },
        { run: 2, sessionId: 'sess-b', output: 'hello', error: null, status: 'ok', score: 1 },
      ],
    });

    const res = await request(app)
      .post('/api/eval/run')
      .send({
        promptTemplate: 'Say {{input}}',
        input: 'hello',
        runs: 2,
        expectedAnswer: 'hello',
        metricId: 'exact-match',
      });

    expect(res.status).toBe(200);
    expect(res.body.renderedPrompt).toBe('Say hello');
    expect(res.body.runs).toBe(2);
    expect(res.body.aggregate.mean).toBe(1);
    expect(res.body.results).toHaveLength(2);
    expect(runEvalBatch).toHaveBeenCalledOnce();
    const [, opts] = runEvalBatch.mock.calls[0];
    expect(opts).toEqual({
      promptTemplate: 'Say {{input}}',
      input: 'hello',
      runs: 2,
      expectedAnswer: 'hello',
      metricId: 'exact-match',
    });
  });

  it('rejects unknown metricId', async () => {
    const res = await request(app)
      .post('/api/eval/run')
      .send({ promptTemplate: 'Hi', input: 'x', runs: 1, metricId: 'semantic-nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/metricId/);
    expect(runEvalBatch).not.toHaveBeenCalled();
  });

  it('returns 503 when ANTHROPIC_API_KEY is missing', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await request(app)
        .post('/api/eval/run')
        .send({ promptTemplate: 'Hi', input: 'x', runs: 1 });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
      expect(runEvalBatch).not.toHaveBeenCalled();
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
      .post('/api/eval/run')
      .send({ promptTemplate: 'Hi', input: 'x', runs: 1 });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Unsupported LLM_PROVIDER/);
    expect(runEvalBatch).not.toHaveBeenCalled();
    resetLlmCache();
  });

  it('returns 503 when LLM_PROVIDER=openai and OPENAI_API_KEY is missing', async () => {
    const previousProvider = process.env.LLM_PROVIDER;
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.LLM_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;
    try {
      const res = await request(app)
        .post('/api/eval/run')
        .send({ promptTemplate: 'Hi', input: 'x', runs: 1 });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/OPENAI_API_KEY/);
      expect(runEvalBatch).not.toHaveBeenCalled();
    } finally {
      if (previousProvider === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = previousProvider;
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  });
});

describe('GET /api/eval/metrics', () => {
  it('lists registered metrics', async () => {
    const res = await request(app).get('/api/eval/metrics');
    expect(res.status).toBe(200);
    expect(res.body.defaultMetricId).toBe('exact-match');
    expect(res.body.metrics.map((m) => m.id)).toContain('string-similarity');
    expect(res.body.metrics.map((m) => m.id)).toContain('word-overlap-f1');
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
});
