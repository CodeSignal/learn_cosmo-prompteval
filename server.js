import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { OctavusClient, toSSEStream } from '@octavus/server-sdk';
import {
  deriveTitle,
  readJsonFile,
  writeJsonFile,
  buildSessionInput,
  buildSessionRecord,
  filterModels,
  matchLocale,
  htmlLangFromLocale,
  mergeStrings,
} from './lib/helpers.js';
import {
  buildCapabilitiesPayload,
  loadCapabilities,
} from './lib/model-capabilities.js';
import { createAgentSession } from './lib/octavus-create.js';
import { enqueueSessionsWrite } from './lib/sessions-file.js';
import { MAX_EVAL_RUNS, MIN_EVAL_RUNS, runEvalBatch } from './lib/eval-run.js';
import { runPromptComparison } from './lib/eval-compare.js';
import {
  DEFAULT_METRIC_ID,
  isValidMetricId,
  listMetrics,
} from './lib/metrics/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.join(__dirname, 'chat-sessions.json');
const CONFIG_FILE   = path.join(__dirname, 'chat-config.json');
const MODELS_FILE   = path.join(__dirname, 'current-models.txt');
const CAPABILITIES_FILE = path.join(__dirname, 'model-capabilities.json');
const I18N_DIR      = path.join(__dirname, 'i18n');
const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;

// ── Octavus client ────────────────────────────────────────────
const octavus = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL,
  apiKey: process.env.OCTAVUS_API_KEY,
});

// Which deployed agent the server talks to. Defaults to "prod" so existing
// deployments that only set the legacy OCTAVUS_AGENT_ID keep hitting their
// production agent with no .env changes. Local development opts into the dev
// agent via `npm run dev` (which sets AGENT_TARGET=dev). When a target-specific
// ID is missing we fall back to the legacy OCTAVUS_AGENT_ID.
const AGENT_TARGET = (process.env.AGENT_TARGET ?? 'prod').toLowerCase();
if (AGENT_TARGET !== 'prod' && AGENT_TARGET !== 'dev') {
  throw new Error(
    `Invalid AGENT_TARGET "${process.env.AGENT_TARGET}". Expected "prod" or "dev".`,
  );
}
const AGENT_ID =
  (AGENT_TARGET === 'prod'
    ? process.env.OCTAVUS_AGENT_ID_PROD
    : process.env.OCTAVUS_AGENT_ID_DEV) ?? process.env.OCTAVUS_AGENT_ID;

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

async function createNewSession(options = {}) {
  const config = await readConfig();
  const input = buildSessionInput(options, config);
  console.log('[session] Creating with input:', JSON.stringify(input));
  // Dedicated HTTP pool — must not share the streaming trigger dispatcher.
  const sessionId = await createAgentSession({
    baseUrl: process.env.OCTAVUS_API_URL,
    apiKey: process.env.OCTAVUS_API_KEY,
    agentId: AGENT_ID,
    input,
  });
  const record = buildSessionRecord(sessionId);
  await updateSessionsFile((data) => {
    // With history hidden there is only ever one conversation; drop the rest.
    data.sessions = config.hideHistory ? [record] : [...data.sessions, record];
    return data;
  });
  return record;
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
// Returns a specific session by ?id=, the most recently updated, or creates one.
app.get('/api/session', async (req, res) => {
  if (!AGENT_ID) {
    return res.status(503).json({ error: 'OCTAVUS_AGENT_ID is not configured' });
  }

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

  // No stored session — create one
  try {
    const record = await createNewSession();
    res.json({ sessionId: record.session_id, messages: [] });
  } catch (err) {
    console.error('[session] Error creating session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ── POST /api/sessions ────────────────────────────────────────
// Creates a brand-new Octavus session and adds it to the file.
app.post('/api/sessions', async (req, res) => {
  if (!AGENT_ID) {
    return res.status(503).json({ error: 'OCTAVUS_AGENT_ID is not configured' });
  }
  try {
    const record = await createNewSession({
      model: req.body.model,
      temperature: req.body.temperature,
      thinking: req.body.thinking,
    });
    res.json({ sessionId: record.session_id, messages: [] });
  } catch (err) {
    console.error('[sessions] Error creating session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
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
// Creates a new Octavus session, seeds it with the supplied messages, and
// removes the old session record.  Used by regenerate / edit-and-resend.
app.post('/api/session/fork', async (req, res) => {
  const { oldSessionId, messages, model, temperature, thinking } = req.body;
  if (!oldSessionId || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'oldSessionId and messages[] are required' });
  }

  try {
    const record = await createNewSession({ model, temperature, thinking });
    await updateSessionsFile((data) => {
      const idx = data.sessions.findIndex((s) => s.session_id === record.session_id);
      if (idx >= 0) {
        data.sessions[idx].messages = messages;
        data.sessions[idx].updated_at = new Date().toISOString();
      }
      data.sessions = data.sessions.filter((s) => s.session_id !== oldSessionId);
      return data;
    });
    res.json({ sessionId: record.session_id });
  } catch (err) {
    console.error('[session/fork] Error:', err);
    res.status(500).json({ error: 'Failed to fork session' });
  }
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
// Proxies presigned S3 upload URL requests to Octavus.
app.post('/api/upload-urls', async (req, res) => {
  const { sessionId, files } = req.body;
  if (!sessionId || !Array.isArray(files)) {
    return res.status(400).json({ error: 'sessionId and files[] are required' });
  }
  try {
    const result = await octavus.files.getUploadUrls(sessionId, files);
    res.json(result);
  } catch (err) {
    console.error('[upload-urls] Error:', err);
    res.status(500).json({ error: 'Failed to get upload URLs' });
  }
});

// ── POST /api/trigger ─────────────────────────────────────────
// Attaches to an existing session and streams the agent response as SSE.
app.post('/api/trigger', async (req, res) => {
  const { sessionId, ...payload } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const session = octavus.agentSessions.attach(sessionId);
  const events = session.execute(payload);
  const stream = toSSEStream(events);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    console.error('[trigger] Stream error:', err);
  } finally {
    reader.releaseLock();
    res.end();
  }
});

// ── GET /api/eval/metrics ─────────────────────────────────────
// Lists registered scoring metrics (modular registry in lib/metrics/).
app.get('/api/eval/metrics', (_req, res) => {
  res.json({ metrics: listMetrics(), defaultMetricId: DEFAULT_METRIC_ID });
});

// ── POST /api/eval/run ────────────────────────────────────────
// Prompt Evaluation Simulator: render template + input, create a fresh
// Octavus session per run, optionally score outputs against expectedAnswer.
app.post('/api/eval/run', async (req, res) => {
  if (!AGENT_ID) {
    return res.status(503).json({ error: 'OCTAVUS_AGENT_ID is not configured' });
  }

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
      {
        baseUrl: process.env.OCTAVUS_API_URL,
        apiKey: process.env.OCTAVUS_API_KEY,
        agentId: AGENT_ID,
        octavus,
      },
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
// Compare Prompt A vs Prompt B under identical conditions (shared input,
// expected answer, metric, run count). Each run still uses a fresh session.
// Shape is ready for multi-test-case later: prompts[] + shared conditions.
app.post('/api/eval/compare', async (req, res) => {
  if (!AGENT_ID) {
    return res.status(503).json({ error: 'OCTAVUS_AGENT_ID is not configured' });
  }

  const {
    promptA,
    promptB,
    input,
    runs,
    expectedAnswer,
    metricId,
  } = req.body ?? {};

  if (typeof promptA !== 'string') {
    return res.status(400).json({ error: 'promptA (string) is required' });
  }
  if (typeof promptB !== 'string') {
    return res.status(400).json({ error: 'promptB (string) is required' });
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
      {
        baseUrl: process.env.OCTAVUS_API_URL,
        apiKey: process.env.OCTAVUS_API_KEY,
        agentId: AGENT_ID,
        octavus,
      },
      {
        prompts: [
          { id: 'A', label: 'Prompt A', promptTemplate: promptA },
          { id: 'B', label: 'Prompt B', promptTemplate: promptB },
        ],
        input: typeof input === 'string' ? input : '',
        expectedAnswer: typeof expectedAnswer === 'string' ? expectedAnswer : '',
        metricId: typeof metricId === 'string' && metricId ? metricId : DEFAULT_METRIC_ID,
        runs,
      },
    );
    res.json(result);
  } catch (err) {
    if (err?.code === 'EMPTY_PROMPT' || err?.code === 'NEED_PROMPTS' || err?.code === 'INVALID_PROMPT') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[eval/compare] Error:', err);
    res.status(500).json({ error: 'Failed to compare prompts' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`Prompt Evaluation Simulator at http://localhost:${PORT}`);
    console.log(`[agent] target=${AGENT_TARGET}${AGENT_ID ? ` (agent ${AGENT_ID})` : ''}`);
    if (!AGENT_ID) {
      const expected = `OCTAVUS_AGENT_ID_${AGENT_TARGET.toUpperCase()}`;
      console.warn(`[WARN] ${expected} is not set — evaluation will not work until it is configured.`);
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
