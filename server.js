import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import {
  deriveTitle,
  readJsonFile,
  writeJsonFile,
  filterModels,
  matchLocale,
  htmlLangFromLocale,
  mergeStrings,
} from './lib/helpers.js';
import {
  buildCapabilitiesPayload,
  loadCapabilities,
} from './lib/model-capabilities.js';
import { enqueueSessionsWrite } from './lib/sessions-file.js';
import { MAX_EVAL_RUNS, MIN_EVAL_RUNS, runEvalBatch } from './lib/eval-run.js';
import { runPromptComparison, MAX_EVAL_CASES } from './lib/eval-compare.js';
import { createLlmProvider, requiredApiKeyName } from './lib/llm/provider.js';
import {
  DEFAULT_METRIC_ID,
  isValidMetricId,
  listMetrics,
} from './lib/metrics/index.js';
import { normalizeSessionConfig } from './lib/session-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.join(__dirname, 'chat-sessions.json');
const CONFIG_FILE   = path.join(__dirname, 'chat-config.json');
const SESSION_CONFIG_FILE = path.join(__dirname, 'session.config.json');
const MODELS_FILE   = path.join(__dirname, 'current-models.txt');
const CAPABILITIES_FILE = path.join(__dirname, 'model-capabilities.json');
const I18N_DIR      = path.join(__dirname, 'i18n');
const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;

const CHAT_UNAVAILABLE = 'Chat sessions are not available; this app uses the Claude API for evaluation only';

/** @type {import('./lib/llm/types.js').LlmProvider | null | undefined} */
let cachedLlm;

/**
 * Resolve the configured LLM provider. A missing provider API key is treated
 * as "not configured" so eval routes can return 503 without crashing startup.
 * @returns {import('./lib/llm/types.js').LlmProvider | null}
 */
function getLlm() {
  const keyName = requiredApiKeyName(process.env);
  if (!process.env[keyName]) return null;
  if (!cachedLlm) cachedLlm = createLlmProvider(process.env);
  return cachedLlm;
}

/**
 * Resolve a provider for an eval route without letting createLlmProvider()
 * throws escape Express 4 async handlers as unhandled rejections.
 * @param {import('express').Response} res
 * @returns {import('./lib/llm/types.js').LlmProvider | null}
 */
function resolveLlm(res) {
  try {
    const llm = getLlm();
    if (!llm) {
      res.status(503).json({ error: `${requiredApiKeyName()} is not configured` });
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
}

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use('/design-system', express.static(path.join(__dirname, 'design-system')));
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ────────────────────────────────────────────────────
const readConfig = () => readJsonFile(CONFIG_FILE);

// Loads every i18n/*.json locale catalog. Each file is
// { languageNames: string[], strings: { [english]: translation } }.
// Malformed files are skipped so one bad catalog can't break config loading.
async function readLocales() {
  let files;
  try {
    files = await fs.readdir(I18N_DIR);
  } catch {
    return [];
  }
  const locales = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const parsed = await readJsonFile(path.join(I18N_DIR, file), null);
    if (parsed) locales.push(parsed);
  }
  return locales;
}

// Resolves the effective UI strings for the config's `language`: the matching
// i18n catalog is the base, and any `strings` in chat-config.json override it
// per-key. This way translations live in i18n/*.json ahead of time, and the
// config map is reserved for one-off overrides.
async function resolveConfigI18n(config) {
  const locales = await readLocales();
  const locale = matchLocale(config.language, locales);
  const base = locale?.strings && typeof locale.strings === 'object' ? locale.strings : {};
  const strings = mergeStrings(base, config.strings);
  return {
    strings,
    htmlLang: locale ? htmlLangFromLocale(locale) : null,
  };
}

// Local eval session defaults (prompts, cases, UI min/max). Not secrets —
// those stay in .env. Missing file → empty initial session + built-in limits.
app.get('/api/session-config', async (_req, res) => {
  const raw = await readJsonFile(SESSION_CONFIG_FILE, {});
  res.json(normalizeSessionConfig(raw));
});

app.get('/api/config', async (_req, res) => {
  const config = await readConfig();
  const { strings, htmlLang } = await resolveConfigI18n(config);
  // Only attach i18n fields when a catalog matched so the response stays a
  // clean passthrough when language is unset.
  const body = { ...config };
  if (Object.keys(strings).length > 0) body.strings = strings;
  if (htmlLang) body.htmlLang = htmlLang;
  res.json(body);
});

// Persists the user-editable custom instructions back to chat-config.json so
// they survive a page reload. Only this field is writable from the client.
app.post('/api/config/custom-instructions', async (req, res) => {
  const { customInstructions } = req.body;
  if (typeof customInstructions !== 'string') {
    return res.status(400).json({ error: 'customInstructions (string) is required' });
  }

  try {
    const config = await readConfig();
    config.customInstructions = customInstructions;
    await writeJsonFile(CONFIG_FILE, config);
    res.json({ ok: true });
  } catch (err) {
    console.error('[config/custom-instructions] Error:', err);
    res.status(500).json({ error: 'Failed to save custom instructions' });
  }
});

// ── Models ─────────────────────────────────────────────────────
app.get('/api/models', async (_req, res) => {
  try {
    const [raw, config, capsFile] = await Promise.all([
      fs.readFile(MODELS_FILE, 'utf8'),
      readConfig(),
      loadCapabilities(CAPABILITIES_FILE, fs),
    ]);
    const models = filterModels(raw, config.allowedModels, config.allowedModelFamilies);
    const capabilities = buildCapabilitiesPayload(models, config, capsFile.models);
    res.json({ models, capabilities });
  } catch {
    res.json({ models: [], capabilities: {} });
  }
});

// ── Session file helpers ──────────────────────────────────────
const readSessionsFile = () => readJsonFile(SESSIONS_FILE, { sessions: [] });
const writeSessionsFile = (data) => writeJsonFile(SESSIONS_FILE, data);

/**
 * Run a read-modify-write against chat-sessions.json without overlapping writers.
 * The mutator receives the current data object. Return contract:
 *   • a new object → write that object
 *   • undefined → write the (possibly mutated) existing data
 *   • false → skip persistence
 */
function updateSessionsFile(mutator) {
  return enqueueSessionsWrite(async () => {
    const data = await readSessionsFile();
    const next = await mutator(data);
    if (next !== false) await writeSessionsFile(next ?? data);
    return next ?? data;
  });
}

// ── GET /api/sessions ─────────────────────────────────────────
// Lists all sessions (id, title, timestamps) sorted newest first.
app.get('/api/sessions', async (req, res) => {
  const data = await readSessionsFile();
  const list = data.sessions
    .map((s) => ({
      session_id: s.session_id,
      title: deriveTitle(s.messages),
      created_at: s.created_at,
      updated_at: s.updated_at,
    }))
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  res.json({ sessions: list });
});

// ── GET /api/session ──────────────────────────────────────────
// Returns a specific session by ?id= or the most recently updated.
// Creating a new remote session is not available (Claude eval-only).
app.get('/api/session', async (req, res) => {
  const data = await readSessionsFile();
  const config = await readConfig();

  // Load a specific session when ?id= is provided
  if (req.query.id) {
    const session = data.sessions.find((s) => s.session_id === req.query.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json({ sessionId: session.session_id, messages: session.messages });
  }

  // Resume the most recently updated session
  if (data.sessions.length > 0) {
    const latest = data.sessions.reduce((a, b) =>
      (a.updated_at || a.created_at) > (b.updated_at || b.created_at) ? a : b,
    );
    // With history hidden, keep only the resumed session; discard any others.
    if (config.hideHistory && data.sessions.length > 1) {
      await updateSessionsFile((current) => {
        current.sessions = [latest];
        return current;
      });
    }
    return res.json({ sessionId: latest.session_id, messages: latest.messages });
  }

  return res.status(501).json({ error: CHAT_UNAVAILABLE });
});

// ── POST /api/sessions ────────────────────────────────────────
app.post('/api/sessions', (_req, res) => {
  res.status(501).json({ error: CHAT_UNAVAILABLE });
});

// ── DELETE /api/sessions/:sessionId ──────────────────────────
app.delete('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  await updateSessionsFile((data) => {
    data.sessions = data.sessions.filter((s) => s.session_id !== sessionId);
    return data;
  });
  res.json({ ok: true });
});

// ── POST /api/session/fork ────────────────────────────────────
app.post('/api/session/fork', (_req, res) => {
  res.status(501).json({ error: CHAT_UNAVAILABLE });
});

// ── POST /api/session/save ────────────────────────────────────
// Receives the full serialised message list and writes it into chat-sessions.json.
app.post('/api/session/save', async (req, res) => {
  const { sessionId, messages } = req.body;
  if (!sessionId || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'sessionId and messages[] are required' });
  }

  try {
    const config = await readConfig();
    await updateSessionsFile((data) => {
      const idx = data.sessions.findIndex((s) => s.session_id === sessionId);
      const now = new Date().toISOString();

      if (idx >= 0) {
        data.sessions[idx].messages = messages;
        data.sessions[idx].updated_at = now;
      } else {
        data.sessions.push({
          session_id: sessionId,
          created_at: now,
          updated_at: now,
          messages,
          selected_submission: null,
        });
      }

      // With history hidden, only the current conversation is ever persisted.
      if (config.hideHistory) {
        data.sessions = data.sessions.filter((s) => s.session_id === sessionId);
      }
      return data;
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[session/save] Error:', err);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

// ── POST /api/upload-urls ─────────────────────────────────────
app.post('/api/upload-urls', (req, res) => {
  const { sessionId, files } = req.body;
  if (!sessionId || !Array.isArray(files)) {
    return res.status(400).json({ error: 'sessionId and files[] are required' });
  }
  return res.status(501).json({ error: CHAT_UNAVAILABLE });
});

// ── POST /api/trigger ─────────────────────────────────────────
app.post('/api/trigger', (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  return res.status(501).json({ error: CHAT_UNAVAILABLE });
});

// ── GET /api/eval/metrics ─────────────────────────────────────
// Lists registered scoring metrics (modular registry in lib/metrics/).
app.get('/api/eval/metrics', (_req, res) => {
  res.json({ metrics: listMetrics(), defaultMetricId: DEFAULT_METRIC_ID });
});

// ── POST /api/eval/run ────────────────────────────────────────
// Prompt Evaluation Simulator: render template + input, run independent
// LLM completions, optionally score outputs against expectedAnswer.
app.post('/api/eval/run', async (req, res) => {
  const llm = resolveLlm(res);
  if (!llm) return;

  const { promptTemplate, input, runs, expectedAnswer, metricId } = req.body ?? {};
  if (typeof promptTemplate !== 'string') {
    return res.status(400).json({ error: 'promptTemplate (string) is required' });
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
    const batch = await runEvalBatch(
      { llm },
      {
        promptTemplate,
        input: typeof input === 'string' ? input : '',
        runs,
        expectedAnswer: typeof expectedAnswer === 'string' ? expectedAnswer : '',
        metricId: typeof metricId === 'string' && metricId ? metricId : DEFAULT_METRIC_ID,
      },
    );
    res.json(batch);
  } catch (err) {
    if (err?.code === 'EMPTY_PROMPT') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[eval/run] Error:', err);
    res.status(500).json({ error: 'Failed to run prompt evaluation' });
  }
});

// ── POST /api/eval/compare ────────────────────────────────────
// Evaluate Prompt A across cases; optionally compare with Prompt B under
// identical conditions. Each run is an independent LLM complete() call.
app.post('/api/eval/compare', async (req, res) => {
  const llm = resolveLlm(res);
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
  const server = app.listen(PORT, () => {
    console.log(`Prompt Evaluation Simulator at http://localhost:${PORT}`);
    const keyName = requiredApiKeyName();
    if (!process.env[keyName]) {
      console.warn(`[WARN] ${keyName} is not set — evaluation will not work until it is configured.`);
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
