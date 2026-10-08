import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    appendFile: vi.fn(),
  },
}));

vi.mock('../lib/llm/provider.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createLlmProvider: vi.fn(() => ({
      name: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      complete: vi.fn().mockResolvedValue({ text: 'VERDICT: PASS\nREASON: Meets the criteria.' }),
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

process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

const { app, resetLlmCache } = await import('../server.js');

const ASSESSMENT_CONFIG = {
  model: 'anthropic/claude-haiku-4-5-20251001',
  allowedModels: ['anthropic/claude-haiku-4-5-20251001'],
  allowedMetricIds: ['field-match', 'custom-check'],
  llmJudgeModel: 'anthropic/claude-sonnet-4-6',
  defaults: { runs: 3, minRuns: 1, maxRuns: 10, maxCases: 8 },
  assessment: {
    enabled: true,
    stage: 'l2',
    maxCandidateCases: 3,
    maxCallsPerEvaluation: 60,
    temperature: 1,
    providedCases: [
      { id: 'p1', label: 'Fries', input: 'fries, shared fryer', expectedAnswer: 'Allergens: SHELLFISH' },
      { id: 'p2', label: 'Curry', input: 'coconut curry', expectedAnswer: 'Allergens: NONE' },
    ],
    customCheck: {
      enabled: true,
      calibrationSamples: [
        { id: 's1', input: 'fries', output: 'Allergens: SHELLFISH', verdict: 'pass' },
        { id: 's2', input: 'curry', output: 'Allergens: TREE NUTS', verdict: 'fail' },
      ],
    },
    consistency: { enabled: true, fields: ['Allergens', 'Diet'] },
    notes: { enabled: true },
  },
};

const EMPTY_RESULT = {
  conditions: { metricId: 'field-match', runs: 3, caseCount: 2 },
  cases: [],
  prompts: [{ id: 'A', label: 'Prompt', aggregate: { mean: 1 } }],
  comparison: { outcome: 'unscored', winnerId: null, means: { A: 1 } },
};

function mockFiles(config = ASSESSMENT_CONFIG, extra = {}) {
  fs.readFile.mockImplementation(async (p) => {
    const file = String(p);
    if (file.includes('session.config.json')) return JSON.stringify(config);
    for (const [name, content] of Object.entries(extra)) {
      if (file.endsWith(name)) return content;
    }
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  });
}

function writesTo(name) {
  return fs.writeFile.mock.calls.filter((c) => String(c[0]).includes(name));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLlmCache();
  runPromptComparison.mockReset();
  runPromptComparison.mockResolvedValue(EMPTY_RESULT);
  fs.mkdir.mockResolvedValue(undefined);
  fs.writeFile.mockResolvedValue(undefined);
  fs.rename.mockResolvedValue(undefined);
  fs.appendFile.mockResolvedValue(undefined);
  mockFiles();
});

describe('POST /api/eval/compare in assessment mode', () => {
  it('puts server-owned provided cases before the candidate cases', async () => {
    const res = await request(app)
      .post('/api/eval/compare')
      .send({
        promptA: 'Label: {{input}}',
        runs: 2,
        metricId: 'field-match',
        cases: [
          { id: 'c1', input: 'tamari tofu', expectedAnswer: 'Allergens: SOY', provided: true },
        ],
      });

    expect(res.status).toBe(200);
    const [deps, opts] = runPromptComparison.mock.calls[0];
    expect(deps.temperature).toBe(1);
    expect(opts.cases).toEqual([
      expect.objectContaining({ id: 'p1', provided: true, expectedAnswer: 'Allergens: SHELLFISH' }),
      expect.objectContaining({ id: 'p2', provided: true }),
      expect.objectContaining({ id: 'own-c1', label: 'Your case 1', provided: false, input: 'tamari tofu' }),
    ]);
    expect(opts.consistency).toEqual({ fields: ['Allergens', 'Diet'] });
  });

  it('runs only the selected provided cases and rejects unknown ids', async () => {
    await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'P', runs: 1, metricId: 'field-match', providedCaseIds: ['p2'] });
    expect(runPromptComparison.mock.calls[0][1].cases.map((c) => c.id)).toEqual(['p2']);

    const res = await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'P', runs: 1, metricId: 'field-match', providedCaseIds: ['nope'] });
    expect(res.status).toBe(400);
  });

  it('enforces own-case, run, and call limits from the config', async () => {
    const tooMany = await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'P', metricId: 'field-match', cases: [{}, {}, {}, {}] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/at most 3 cases/u);

    const runs = await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'P', metricId: 'field-match', runs: 11 });
    expect(runs.status).toBe(400);

    // 2 provided × 10 runs × 2 calls (judge) = 40 fits; + 1 own case = 60 fits; + 2 = 80 does not.
    const calls = await request(app)
      .post('/api/eval/compare')
      .send({
        promptA: 'P',
        metricId: 'custom-check',
        customCheck: { criteria: 'Be strict.' },
        runs: 10,
        cases: [{ input: 'a' }, { input: 'b' }],
      });
    expect(calls.status).toBe(400);
    expect(calls.body.error).toMatch(/80 model calls; the limit is 60/u);
    expect(runPromptComparison).not.toHaveBeenCalled();
  });

  it('rejects prompts longer than the configured limit', async () => {
    mockFiles({ ...ASSESSMENT_CONFIG, assessment: { ...ASSESSMENT_CONFIG.assessment, maxPromptLength: 10 } });
    const res = await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'x'.repeat(11), runs: 1, metricId: 'field-match' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 10 characters; this one is 11/u);
    expect(runPromptComparison).not.toHaveBeenCalled();
  });

  it('defaults to the first enabled metric instead of exact-match', async () => {
    await request(app).post('/api/eval/compare').send({ promptA: 'P', runs: 1 });
    expect(runPromptComparison.mock.calls[0][1].metricId).toBe('field-match');
  });

  it('requires criteria for the custom check and passes them to the evaluation', async () => {
    const missing = await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'P', runs: 1, metricId: 'custom-check' });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/criteria/u);

    const res = await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'P', runs: 1, metricId: 'custom-check', customCheck: { criteria: ' Be strict. ' } });
    expect(res.status).toBe(200);
    const [deps, opts] = runPromptComparison.mock.calls[0];
    expect(deps.judgeModel).toBe('anthropic/claude-sonnet-4-6');
    expect(opts.criteria).toBe('Be strict.');
  });

  it('logs the evaluation and updates the submission files', async () => {
    const res = await request(app)
      .post('/api/eval/compare')
      .send({ promptA: 'Label: {{input}}', runs: 1, metricId: 'field-match' });
    expect(res.status).toBe(200);

    const log = fs.appendFile.mock.calls.find((c) => String(c[0]).endsWith('evaluations.jsonl'));
    expect(JSON.parse(log[1])).toMatchObject({ type: 'evaluation', stage: 'l2', promptA: 'Label: {{input}}' });

    const submission = JSON.parse(writesTo('submission.json').at(-1)[1]);
    expect(submission.history.evaluations).toEqual([
      expect.objectContaining({ n: 1, stage: 'l2', metricId: 'field-match', mean: 1 }),
    ]);
    expect(String(writesTo('submission.md').at(-1)[1])).toContain('## Evaluation history (1)');
  });

  it('stores the result in the saved session so autosave does not have to send it', async () => {
    mockFiles(ASSESSMENT_CONFIG, { 'eval-session.json': JSON.stringify({ promptA: 'Label: {{input}}', stage: 'l2' }) });
    await request(app).post('/api/eval/compare').send({ promptA: 'Label: {{input}}', runs: 1, metricId: 'field-match' });
    expect(JSON.parse(writesTo('eval-session.json').at(-1)[1])).toMatchObject({
      promptA: 'Label: {{input}}',
      lastResult: { prompts: [{ id: 'A' }] },
    });
  });
});

describe('PUT /api/eval/session in assessment mode', () => {
  it('writes the candidate work to submission.json, keeping history', async () => {
    mockFiles(ASSESSMENT_CONFIG, {
      'submission.json': JSON.stringify({ version: 1, history: { evaluations: [{ n: 1 }], calibrations: [] } }),
    });
    const res = await request(app)
      .put('/api/eval/session')
      .send({
        promptA: 'Final prompt',
        metricId: 'custom-check',
        customCheckCriteria: 'Blurb at most 25 words.',
        notes: 'Stability improved.',
        cases: [{ id: 'c1', input: 'x', expectedAnswer: 'Diet: NONE' }],
      });
    expect(res.status).toBe(200);
    const submission = JSON.parse(writesTo('submission.json').at(-1)[1]);
    expect(submission).toMatchObject({
      stage: 'l2',
      prompt: { template: 'Final prompt' },
      customCheck: { criteria: 'Blurb at most 25 words.' },
      notes: 'Stability improved.',
      candidateCases: [{ id: 'c1', input: 'x', expectedAnswer: 'Diet: NONE' }],
      history: { evaluations: [{ n: 1 }] },
    });
  });

  it('keeps the results the server stored when the page saves only its edits', async () => {
    mockFiles(ASSESSMENT_CONFIG, {
      'eval-session.json': JSON.stringify({ promptA: 'Old', stage: 'l2', lastResult: { runId: 'r1' } }),
    });
    await request(app).put('/api/eval/session').send({ promptA: 'New', stage: 'l2' });
    expect(JSON.parse(writesTo('eval-session.json').at(-1)[1])).toMatchObject({ promptA: 'New', lastResult: { runId: 'r1' } });
  });

  it('drops stored results from another level, and an explicit null clears them', async () => {
    mockFiles(ASSESSMENT_CONFIG, {
      'eval-session.json': JSON.stringify({ promptA: 'Old', stage: 'l1', lastResult: { runId: 'r1' } }),
    });
    await request(app).put('/api/eval/session').send({ promptA: 'New', stage: 'l2' });
    expect(JSON.parse(writesTo('eval-session.json').at(-1)[1]).lastResult).toBeNull();
    mockFiles(ASSESSMENT_CONFIG, {
      'eval-session.json': JSON.stringify({ promptA: 'Old', stage: 'l2', lastResult: { runId: 'r1' } }),
    });
    await request(app).put('/api/eval/session').send({ promptA: 'New', stage: 'l2', lastResult: null });
    expect(JSON.parse(writesTo('eval-session.json').at(-1)[1]).lastResult).toBeNull();
  });

  it('accepts sessions far larger than 100 KB', async () => {
    const res = await request(app).put('/api/eval/session').send({ promptA: 'P', notes: 'x'.repeat(150_000) });
    expect(res.status).toBe(200);
  });

  it('does not write submission files outside assessment mode', async () => {
    mockFiles({});
    await request(app).put('/api/eval/session').send({ promptA: 'P' });
    expect(writesTo('submission.json')).toHaveLength(0);
  });
});

describe('GET /api/eval/session in assessment mode', () => {
  it('rebuilds the session from submission.json when eval-session.json is missing', async () => {
    mockFiles(ASSESSMENT_CONFIG, {
      'submission.json': JSON.stringify({
        version: 1,
        stage: 'l1',
        model: 'anthropic/claude-haiku-4-5-20251001',
        prompt: { template: 'Saved prompt' },
        candidateCases: [{ id: 'c1', input: 'x', expectedAnswer: 'Diet: NONE' }],
        customCheck: { criteria: 'Be strict.' },
        notes: 'Findings.',
        settings: { metricId: 'custom-check', runs: 4 },
      }),
    });
    const res = await request(app).get('/api/eval/session');
    expect(res.body.session).toMatchObject({
      promptA: 'Saved prompt',
      cases: [{ id: 'c1', input: 'x', expectedAnswer: 'Diet: NONE' }],
      customCheckCriteria: 'Be strict.',
      notes: 'Findings.',
      metricId: 'custom-check',
      runs: 4,
      stage: 'l1',
      lastResult: null,
    });
  });

  it('returns null when neither file exists', async () => {
    const res = await request(app).get('/api/eval/session');
    expect(res.body).toEqual({ session: null });
  });
});

describe('POST /api/check/calibrate', () => {
  it('scores reviewer samples with the fixed judge and records the result', async () => {
    const res = await request(app)
      .post('/api/check/calibrate')
      .send({ criteria: 'Allergens must follow the memo.' });
    expect(res.status).toBe(200);
    expect(res.body.judgeModel).toBe('anthropic/claude-sonnet-4-6');
    expect(res.body.agreement).toEqual({ agreeing: 1, total: 2, scored: 2, rate: 0.5 });
    const submission = JSON.parse(writesTo('submission.json').at(-1)[1]);
    expect(submission.history.calibrations).toEqual([
      expect.objectContaining({ n: 1, agreeing: 1, total: 2 }),
    ]);
  });

  it('rejects empty criteria and disabled checks', async () => {
    expect((await request(app).post('/api/check/calibrate').send({ criteria: ' ' })).status).toBe(400);
    mockFiles({});
    expect((await request(app).post('/api/check/calibrate').send({ criteria: 'x' })).status).toBe(404);
  });
});

describe('GET /api/assessment/stage', () => {
  it('returns the configured level id', async () => {
    const res = await request(app).get('/api/assessment/stage');
    expect(res.body).toEqual({ enabled: true, stage: 'l2' });
  });
});

describe('GET /api/assessment/submitted-versions', () => {
  it('lists submitted versions newest first', async () => {
    mockFiles(ASSESSMENT_CONFIG, {
      'submitted-versions.json': JSON.stringify({
        version: 1,
        versions: [
          { submittedAt: '2026-10-08T10:00:00.000Z', stage: 'l1', stageLabel: 'Level 1 of 3', prompt: 'P1', customCheckCriteria: '', notes: '' },
          { submittedAt: '2026-10-08T10:30:00.000Z', stage: 'l2', stageLabel: 'Level 2 of 3', prompt: 'P2', customCheckCriteria: 'C2', notes: '' },
        ],
      }),
    });
    const res = await request(app).get('/api/assessment/submitted-versions');
    expect(res.body.versions.map((v) => v.prompt)).toEqual(['P2', 'P1']);
  });

  it('returns nothing outside assessment mode', async () => {
    mockFiles({}, { 'submitted-versions.json': JSON.stringify({ versions: [{ submittedAt: 'T', prompt: 'P' }] }) });
    expect((await request(app).get('/api/assessment/submitted-versions')).body).toEqual({ versions: [] });
  });
});
