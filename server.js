import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJsonFile, writeJsonFileAtomic } from './lib/helpers.js';
import { enqueueSessionsWrite } from './lib/sessions-file.js';
import { MAX_EVAL_RUNS, MIN_EVAL_RUNS } from './lib/eval-run.js';
import { runPromptComparison, MAX_EVAL_CASES } from './lib/eval-compare.js';
import { createLlmProvider, requiredApiKeyName } from './lib/llm/provider.js';
import { DEFAULT_METRIC_ID, isValidMetricId } from './lib/metrics/index.js';
import { assertAllowedModel, findAllowedModel, normalizeSessionConfig } from './lib/session-config.js';
import { normalizeEvalSession } from './lib/eval-session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_CONFIG_FILE = path.join(__dirname, 'session.config.json');
const EVAL_SESSION_FILE = path.join(__dirname, 'eval-session.json');
const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;

/** @type {import('./lib/llm/types.js').LlmProvider | null | undefined} */
let cachedLlm;
/** @type {string | undefined} */
let cachedModel;

/**
 * @returns {Promise<{ model: string, allowedModels: string[], allowUserModelSelection: boolean }>}
 */
async function sessionLlmConfig() {
  const config = normalizeSessionConfig(await readJsonFile(SESSION_CONFIG_FILE, {}));
  return {
    model: config.model,
    allowedModels: config.allowedModels,
    allowUserModelSelection: config.allowUserModelSelection,
  };
}

/**
 * Resolve the configured LLM provider. A missing provider API key is treated
 * as "not configured" so eval routes can return 503 without crashing startup.
 * @param {string} model
 * @param {string[]} allowedModels
 * @returns {import('./lib/llm/types.js').LlmProvider | null}
 */
function getLlm(model, allowedModels) {
  const keyName = requiredApiKeyName(model);
  assertAllowedModel(model, allowedModels);
  if (!process.env[keyName]) return null;
  if (!cachedLlm || cachedModel !== model) {
    cachedLlm = createLlmProvider(process.env, model);
    cachedModel = model;
  }
  return cachedLlm;
}

/**
 * Resolve a provider for an eval route without letting createLlmProvider()
 * throws escape Express 4 async handlers as unhandled rejections.
 * @param {import('express').Response} res
 * @param {unknown} requestedModel
 * @returns {Promise<import('./lib/llm/types.js').LlmProvider | null>}
 */
async function resolveLlm(res, requestedModel) {
  try {
    const config = await sessionLlmConfig();
    const requested = config.allowUserModelSelection
      && typeof requestedModel === 'string'
      && requestedModel.trim()
      ? requestedModel.trim()
      : config.model;
    const { allowedModels } = config;
    const model = findAllowedModel(requested, allowedModels) ?? requested;
    const llm = getLlm(model, allowedModels);
    if (!llm) {
      res.status(503).json({ error: `${requiredApiKeyName(model)} is not configured` });
      return null;
    }
    return llm;
  } catch (err) {
    const message = err instanceof Error && err.message
      ? err.message
      : 'LLM provider is not configured';
    res.status(503).json({ error: message });
    return null;
  }
}

/** Clear the cached provider. Used by tests when mocking createLlmProvider. */
export function resetLlmCache() {
  cachedLlm = undefined;
  cachedModel = undefined;
}

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use('/design-system', express.static(path.join(__dirname, 'design-system')));
app.use(express.static(path.join(__dirname, 'public')));

// Local eval session defaults (model, prompts, cases, UI min/max). Not secrets —
// those stay in .env. Missing file → empty initial session + built-in limits.
app.get('/api/session-config', async (_req, res) => {
  const raw = await readJsonFile(SESSION_CONFIG_FILE, {});
  res.json(normalizeSessionConfig(raw));
});

const evalSessionWrite = { chain: Promise.resolve() };

async function sessionLimitsFromConfig() {
  const config = normalizeSessionConfig(await readJsonFile(SESSION_CONFIG_FILE, {}));
  return config.defaults;
}

// One working eval session (prompts, cases, settings, last results).
// Missing file → { session: null } so the client can fall back to initialSession.
app.get('/api/eval/session', async (_req, res) => {
  const raw = await readJsonFile(EVAL_SESSION_FILE, null);
  if (raw == null) return res.json({ session: null });
  const limits = await sessionLimitsFromConfig();
  res.json({ session: normalizeEvalSession(raw, limits) });
});

app.put('/api/eval/session', async (req, res) => {
  try {
    const limits = await sessionLimitsFromConfig();
    const session = normalizeEvalSession(req.body, limits);
    await enqueueSessionsWrite(async () => {
      await writeJsonFileAtomic(EVAL_SESSION_FILE, session);
    }, evalSessionWrite);
    res.json({ session });
  } catch (err) {
    console.error('[eval/session] Error:', err);
    res.status(500).json({ error: 'Failed to save eval session' });
  }
});

// ── POST /api/eval/compare ────────────────────────────────────
// Evaluate Prompt A across cases; optionally compare with Prompt B under
// identical conditions. Each run is an independent LLM complete() call.
app.post('/api/eval/compare', async (req, res) => {
  const llm = await resolveLlm(res, req.body?.model);
  if (!llm) return;

  const {
    promptA,
    promptB,
    cases,
    input,
    runs,
    expectedAnswer,
    metricId,
  } = req.body ?? {};

  if (typeof promptA !== 'string') {
    return res.status(400).json({ error: 'promptA (string) is required' });
  }
  if (promptB !== undefined && promptB !== null && typeof promptB !== 'string') {
    return res.status(400).json({ error: 'promptB must be a string when provided' });
  }
  if (cases !== undefined) {
    if (!Array.isArray(cases)) {
      return res.status(400).json({ error: 'cases must be an array when provided' });
    }
    if (cases.length < 1 || cases.length > MAX_EVAL_CASES) {
      return res.status(400).json({
        error: `cases must contain between 1 and ${MAX_EVAL_CASES} items`,
      });
    }
  }
  if (input !== undefined && typeof input !== 'string') {
    return res.status(400).json({ error: 'input must be a string when provided' });
  }
  if (expectedAnswer !== undefined && expectedAnswer !== null && typeof expectedAnswer !== 'string') {
    return res.status(400).json({ error: 'expectedAnswer must be a string when provided' });
  }
  if (metricId !== undefined && metricId !== null && metricId !== '') {
    if (!isValidMetricId(metricId)) {
      return res.status(400).json({ error: `Unknown metricId "${metricId}"` });
    }
  }
  if (runs !== undefined && runs !== null) {
    const parsed = Number.parseInt(String(runs), 10);
    if (!Number.isFinite(parsed) || parsed < MIN_EVAL_RUNS || parsed > MAX_EVAL_RUNS) {
      return res.status(400).json({
        error: `runs must be an integer between ${MIN_EVAL_RUNS} and ${MAX_EVAL_RUNS}`,
      });
    }
  }

  try {
    const result = await runPromptComparison(
      { llm },
      {
        prompts: [
          {
            id: 'A',
            label: typeof promptB === 'string' && promptB.trim() !== '' ? 'Prompt A' : 'Prompt',
            promptTemplate: promptA,
          },
          ...(typeof promptB === 'string' && promptB.trim() !== ''
            ? [{ id: 'B', label: 'Prompt B', promptTemplate: promptB }]
            : []),
        ],
        cases: Array.isArray(cases) ? cases : undefined,
        input: typeof input === 'string' ? input : '',
        expectedAnswer: typeof expectedAnswer === 'string' ? expectedAnswer : '',
        metricId: typeof metricId === 'string' && metricId ? metricId : DEFAULT_METRIC_ID,
        runs,
      },
    );
    res.json(result);
  } catch (err) {
    if (
      err?.code === 'EMPTY_PROMPT'
      || err?.code === 'NEED_PROMPTS'
      || err?.code === 'INVALID_PROMPT'
      || err?.code === 'INVALID_CASE'
      || err?.code === 'TOO_MANY_CASES'
    ) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[eval/compare] Error:', err);
    res.status(500).json({ error: 'Failed to compare prompts' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, async () => {
    console.log(`Prompt Evaluation Simulator at http://localhost:${PORT}`);
    try {
      const { model, allowedModels } = await sessionLlmConfig();
      assertAllowedModel(model, allowedModels);
      const keyName = requiredApiKeyName(model);
      if (!process.env[keyName]) {
        console.warn(`[WARN] ${keyName} is not set — evaluation will not work until it is configured.`);
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'LLM model is not configured';
      console.warn(`[WARN] ${message}`);
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use. Stop the other dev server (or any app on that port), or run with a different port, e.g. PORT=3001 npm run dev`,
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

export { app };
