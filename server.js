import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJsonFile, writeJsonFileAtomic } from './lib/helpers.js';
import { enqueueSessionsWrite } from './lib/sessions-file.js';
import { runPromptComparison } from './lib/eval-compare.js';
import { createLlmProvider, requiredApiKeyName } from './lib/llm/provider.js';
import { DEFAULT_METRIC_ID, getMetric, isValidMetricId } from './lib/metrics/index.js';
import { assertAllowedModel, findAllowedModel, normalizeSessionConfig } from './lib/session-config.js';
import { normalizeEvalSession } from './lib/eval-session.js';
import {
  appendEvalReportFile,
  buildEvalReportMarkdown,
  defaultEvalReportPath,
} from './lib/eval-report.js';
import { formatEvalProgress } from './lib/eval-progress.js';
import {
  appendAssessmentLog,
  assessmentPaths,
  buildSubmission,
  readSubmission,
  sessionFromSubmission,
  summarizeCalibration,
  summarizeEvaluation,
  summarizeLatestEvaluation,
  withHistoryRow,
  writeSubmissionFiles,
} from './lib/assessment-store.js';
import { runCustomCheckCalibration } from './lib/custom-check-calibration.js';
import { readSubmittedVersions } from './lib/submitted-versions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_CONFIG_FILE = path.join(__dirname, 'session.config.json');
const EVAL_SESSION_FILE = path.join(__dirname, 'eval-session.json');
const EVAL_REPORT_FILE = defaultEvalReportPath(__dirname);
const ASSESSMENT_FILES = assessmentPaths(__dirname);
const evalReportWrite = { chain: Promise.resolve() };
const assessmentWrite = { chain: Promise.resolve() };
const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;

/** @type {import('./lib/llm/types.js').LlmProvider | null | undefined} */
let cachedLlm;
/** @type {string | undefined} */
let cachedModel;
/** @type {import('./lib/llm/types.js').LlmProvider | null | undefined} */
let cachedJudgeLlm;
/** @type {string | undefined} */
let cachedJudgeModel;

/**
 * @returns {Promise<ReturnType<typeof normalizeSessionConfig>>}
 */
async function sessionLlmConfig() {
  return normalizeSessionConfig(await readJsonFile(SESSION_CONFIG_FILE, {}));
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
 * @returns {Promise<{
 *   llm: import('./lib/llm/types.js').LlmProvider,
 *   model: string,
 *   config: ReturnType<typeof normalizeSessionConfig>,
 * } | null>}
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
    return { llm, model, config };
  } catch (err) {
    const message = err instanceof Error && err.message
      ? err.message
      : 'LLM provider is not configured';
    res.status(503).json({ error: message });
    return null;
  }
}

/**
 * Resolve the server-configured judge provider. The client cannot override it.
 * When omitted, retain the original same-model behavior for compatibility.
 * @param {import('express').Response} res
 * @param {ReturnType<typeof normalizeSessionConfig>} config
 * @param {string} generationModel
 * @returns {{ judgeLlm: import('./lib/llm/types.js').LlmProvider, judgeModel: string } | null}
 */
function resolveJudgeLlm(res, config, generationModel) {
  const judgeModel = config.llmJudgeModel || generationModel;
  try {
    const keyName = requiredApiKeyName(judgeModel);
    if (!process.env[keyName]) {
      res.status(503).json({ error: `${keyName} is not configured for the LLM judge` });
      return null;
    }
    if (!cachedJudgeLlm || cachedJudgeModel !== judgeModel) {
      cachedJudgeLlm = createLlmProvider(process.env, judgeModel);
      cachedJudgeModel = judgeModel;
    }
    return { judgeLlm: cachedJudgeLlm, judgeModel };
  } catch (err) {
    const message = err instanceof Error && err.message
      ? err.message
      : 'LLM judge provider is not configured';
    res.status(503).json({ error: message });
    return null;
  }
}

/**
 * Persist Cosmo-facing report after a successful eval (best-effort).
 * @param {{
 *   model?: string,
 *   provider?: string,
 *   promptA?: string,
 *   promptB?: string,
 *   result: object,
 * }} payload
 */
async function persistEvalReport(payload) {
  try {
    const markdown = buildEvalReportMarkdown(payload);
    await enqueueSessionsWrite(
      () => appendEvalReportFile(EVAL_REPORT_FILE, markdown),
      evalReportWrite,
    );
  } catch (err) {
    console.error('[eval/report] Failed to write .codesignal/report.md:', err);
  }
}

/**
 * Update the server-written assessment files (best-effort, serialized).
 * `update` receives the previous submission.json and returns the next one.
 * @param {(previous: Record<string, any>) => Record<string, any>} update
 * @param {object} [logEntry] appended to evaluations.jsonl first
 */
async function persistAssessment(update, logEntry) {
  try {
    await enqueueSessionsWrite(async () => {
      if (logEntry) await appendAssessmentLog(ASSESSMENT_FILES.evaluationsLog, logEntry);
      const previous = await readSubmission(ASSESSMENT_FILES.submissionJson);
      await writeSubmissionFiles(ASSESSMENT_FILES, update(previous));
    }, assessmentWrite);
  } catch (err) {
    console.error('[assessment] Failed to write .codesignal submission files:', err);
  }
}

/**
 * Current saved session, for history rows written before the browser saves.
 * @param {Awaited<ReturnType<typeof sessionLimitsFromConfig>>} limits
 */
async function savedSession(limits) {
  return normalizeEvalSession(await readJsonFile(EVAL_SESSION_FILE, {}), limits);
}

/** Clear the cached provider. Used by tests when mocking createLlmProvider. */
export function resetLlmCache() {
  cachedLlm = undefined;
  cachedModel = undefined;
  cachedJudgeLlm = undefined;
  cachedJudgeModel = undefined;
}

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use('/design-system', express.static(path.join(__dirname, 'design-system')));
app.use(express.static(path.join(__dirname, 'public')));

// Local eval session defaults (model, concurrency, prompts, cases, UI min/max).
// Not secrets — those stay in .env. Missing file → empty initial session + built-in limits.
app.get('/api/session-config', async (_req, res) => {
  const raw = await readJsonFile(SESSION_CONFIG_FILE, {});
  res.json(normalizeSessionConfig(raw));
});

const evalSessionWrite = { chain: Promise.resolve() };

/**
 * @param {ReturnType<typeof normalizeSessionConfig>} config
 */
function sessionLimits(config) {
  return {
    ...config.defaults,
    allowedMetricIds: config.allowedMetricIds,
    promptTemplating: config.features.promptTemplating,
    assessment: config.assessment,
  };
}

async function sessionLimitsFromConfig() {
  return sessionLimits(normalizeSessionConfig(await readJsonFile(SESSION_CONFIG_FILE, {})));
}

// One working eval session (prompts, cases, settings, last results).
// Missing file → { session: null } so the client can fall back to initialSession.
app.get('/api/eval/session', async (_req, res) => {
  const config = await sessionLlmConfig();
  let raw = await readJsonFile(EVAL_SESSION_FILE, null);
  if (raw == null && config.assessment.enabled) {
    raw = sessionFromSubmission(await readSubmission(ASSESSMENT_FILES.submissionJson));
  }
  if (raw == null) return res.json({ session: null });
  res.json({ session: normalizeEvalSession(raw, sessionLimits(config)) });
});

app.put('/api/eval/session', async (req, res) => {
  try {
    const config = await sessionLlmConfig();
    const session = normalizeEvalSession(req.body, sessionLimits(config));
    await enqueueSessionsWrite(async () => {
      await writeJsonFileAtomic(EVAL_SESSION_FILE, session);
    }, evalSessionWrite);
    if (config.assessment.enabled) {
      await persistAssessment((previous) => buildSubmission({ config, session, previous }));
    }
    res.json({ session });
  } catch (err) {
    console.error('[eval/session] Error:', err);
    res.status(500).json({ error: 'Failed to save eval session' });
  }
});

// Assessment level id, polled by the client so a new level's config loads
// even when the platform does not reload the preview between levels.
app.get('/api/assessment/stage', async (_req, res) => {
  const { assessment } = await sessionLlmConfig();
  res.json({ enabled: assessment.enabled, stage: assessment.stage });
});

// Work saved on each Submit (newest first), for the restore menus.
app.get('/api/assessment/submitted-versions', async (_req, res) => {
  const { assessment } = await sessionLlmConfig();
  if (!assessment.enabled) return res.json({ versions: [] });
  const versions = await readSubmittedVersions(ASSESSMENT_FILES.submittedVersions);
  res.json({ versions: versions.reverse() });
});

// ── POST /api/check/calibrate ─────────────────────────────────
// Apply the candidate's custom check to reviewer-labeled sample outputs from
// session.config.json and report how often it agrees with the reviewer.
app.post('/api/check/calibrate', async (req, res) => {
  const config = await sessionLlmConfig();
  const { assessment } = config;
  if (!assessment.enabled || !assessment.customCheck.enabled) {
    return res.status(404).json({ error: 'Custom check is not enabled' });
  }
  const criteria = typeof req.body?.criteria === 'string' ? req.body.criteria.trim() : '';
  if (!criteria) {
    return res.status(400).json({ error: 'Write your check criteria before testing it' });
  }
  if (criteria.length > assessment.customCheck.maxCriteriaLength) {
    return res.status(400).json({
      error: `Check criteria must be at most ${assessment.customCheck.maxCriteriaLength} characters`,
    });
  }
  const samples = assessment.customCheck.calibrationSamples;
  if (samples.length === 0) {
    return res.status(400).json({ error: 'No reviewer samples are configured for this level' });
  }
  const judge = resolveJudgeLlm(res, config, config.model);
  if (!judge) return;

  try {
    const calibration = await runCustomCheckCalibration({
      llm: judge.judgeLlm,
      model: judge.judgeModel,
      criteria,
      samples,
      maxConcurrency: config.maxConcurrency,
    });
    const at = new Date().toISOString();
    await persistAssessment(
      (previous) => {
        const n = (previous.history?.calibrations?.length ?? 0) + 1;
        return withHistoryRow(previous, 'calibrations', summarizeCalibration({
          n,
          at,
          stage: assessment.stage,
          calibration,
        }));
      },
      { type: 'calibration', at, stage: assessment.stage, ...calibration },
    );
    res.json(calibration);
  } catch (err) {
    console.error('[check/calibrate] Error:', err);
    res.status(500).json({ error: 'Failed to test the check' });
  }
});

/**
 * Assessment mode: provided cases come from the server config (selected by id)
 * and are placed before the candidate's own cases.
 * @param {ReturnType<typeof normalizeSessionConfig>['assessment']} assessment
 * @param {unknown} providedCaseIds
 * @param {unknown} candidateCases
 * @returns {{ cases: object[] } | { error: string }}
 */
function assessmentCases(assessment, providedCaseIds, candidateCases) {
  const byId = new Map(assessment.providedCases.map((c) => [c.id, c]));
  let selected = assessment.providedCases;
  if (providedCaseIds !== undefined) {
    if (!Array.isArray(providedCaseIds) || providedCaseIds.some((id) => !byId.has(id))) {
      return { error: 'providedCaseIds must list provided case ids' };
    }
    const wanted = new Set(providedCaseIds);
    selected = assessment.providedCases.filter((c) => wanted.has(c.id));
  }
  const own = Array.isArray(candidateCases) ? candidateCases : [];
  if (!assessment.allowCandidateCases && own.length > 0) {
    return { error: 'This level uses only the provided cases' };
  }
  if (own.length > assessment.maxCandidateCases) {
    return { error: `You can add at most ${assessment.maxCandidateCases} cases of your own` };
  }
  return {
    cases: [
      ...selected.map((c) => ({ ...c, provided: true })),
      ...own.map((c, i) => ({
        ...(c && typeof c === 'object' ? c : {}),
        id: `own-${typeof c?.id === 'string' && c.id ? c.id : i + 1}`,
        label: `Your case ${i + 1}`,
        provided: false,
      })),
    ],
  };
}

// ── POST /api/eval/compare ────────────────────────────────────
// Evaluate Prompt A across cases; optionally compare with Prompt B under
// identical conditions. Each run is an independent LLM complete() call.
app.post('/api/eval/compare', async (req, res) => {
  const resolved = await resolveLlm(res, req.body?.model);
  if (!resolved) return;
  const { llm, model, config } = resolved;

  const {
    promptA,
    promptB,
    cases,
    input,
    runs,
    expectedAnswer,
    metricId,
    examples,
    providedCaseIds,
    customCheck,
  } = req.body ?? {};
  const { assessment, defaults } = config;

  if (typeof promptA !== 'string') {
    return res.status(400).json({ error: 'promptA (string) is required' });
  }
  if (promptB !== undefined && promptB !== null && typeof promptB !== 'string') {
    return res.status(400).json({ error: 'promptB must be a string when provided' });
  }
  const maxPromptLength = config.assessment.enabled ? config.assessment.maxPromptLength : null;
  const tooLongPrompt = maxPromptLength != null
    && [promptA, promptB].find((p) => typeof p === 'string' && p.length > maxPromptLength);
  if (tooLongPrompt) {
    return res.status(400).json({
      error: `A prompt can be at most ${maxPromptLength} characters; this one is ${tooLongPrompt.length}.`,
    });
  }
  if (cases !== undefined && !Array.isArray(cases)) {
    return res.status(400).json({ error: 'cases must be an array when provided' });
  }
  let evalCases = Array.isArray(cases) ? cases : undefined;
  if (assessment.enabled) {
    const merged = assessmentCases(assessment, providedCaseIds, cases);
    if ('error' in merged) return res.status(400).json({ error: merged.error });
    evalCases = merged.cases;
  }
  if (evalCases !== undefined && (evalCases.length < 1 || evalCases.length > defaults.maxCases)) {
    return res.status(400).json({
      error: `cases must contain between 1 and ${defaults.maxCases} items`,
    });
  }
  if (input !== undefined && typeof input !== 'string') {
    return res.status(400).json({ error: 'input must be a string when provided' });
  }
  if (expectedAnswer !== undefined && expectedAnswer !== null && typeof expectedAnswer !== 'string') {
    return res.status(400).json({ error: 'expectedAnswer must be a string when provided' });
  }
  if (metricId !== undefined && metricId !== null && metricId !== '') {
    if (!isValidMetricId(metricId) || !config.allowedMetricIds.includes(metricId)) {
      return res.status(400).json({ error: `Metric "${metricId}" is not enabled` });
    }
  }
  // Assessment mode never falls back to a metric the level did not enable.
  const effectiveMetricId = typeof metricId === 'string' && metricId
    ? metricId
    : (assessment.enabled ? config.allowedMetricIds[0] : DEFAULT_METRIC_ID);
  const criteria = typeof customCheck?.criteria === 'string' ? customCheck.criteria.trim() : '';
  if (effectiveMetricId === 'custom-check') {
    if (!criteria) {
      return res.status(400).json({ error: 'Write your custom check criteria before running it' });
    }
    if (criteria.length > assessment.customCheck.maxCriteriaLength) {
      return res.status(400).json({
        error: `Check criteria must be at most ${assessment.customCheck.maxCriteriaLength} characters`,
      });
    }
  }
  const usesJudge = getMetric(effectiveMetricId)?.type === 'llm';
  const judge = usesJudge
    ? resolveJudgeLlm(res, config, model)
    : null;
  if (usesJudge && !judge) return;
  if (runs !== undefined && runs !== null) {
    const parsed = Number.parseInt(String(runs), 10);
    if (!Number.isFinite(parsed) || parsed < defaults.minRuns || parsed > defaults.maxRuns) {
      return res.status(400).json({
        error: `runs must be an integer between ${defaults.minRuns} and ${defaults.maxRuns}`,
      });
    }
  }
  if (assessment.enabled) {
    const runCount = Number.parseInt(String(runs ?? defaults.runs), 10);
    const promptCount = typeof promptB === 'string' && promptB.trim() !== '' ? 2 : 1;
    const calls = evalCases.length * promptCount * runCount * (usesJudge ? 2 : 1);
    if (calls > assessment.maxCallsPerEvaluation) {
      return res.status(400).json({
        error: `This evaluation needs ${calls} model calls; the limit is ${assessment.maxCallsPerEvaluation}. Use fewer runs or cases.`,
      });
    }
  }

  try {
    const wantsStream = req.headers.accept?.includes('text/event-stream')
      || req.body?.stream === true;

    /** @type {((event: string, data: object) => void) | null} */
    let sendEvent = null;
    if (wantsStream) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
    }

    const result = await runPromptComparison(
      {
        llm,
        judgeLlm: judge?.judgeLlm,
        judgeModel: judge?.judgeModel,
        ...(assessment.temperature != null ? { temperature: assessment.temperature } : {}),
        ...(assessment.reasoningEffort ? { reasoningEffort: assessment.reasoningEffort } : {}),
      },
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
        cases: evalCases,
        examples: config.features.promptTemplating.allowExamples && Array.isArray(examples)
          ? examples
          : [],
        promptTemplating: config.features.promptTemplating,
        input: typeof input === 'string' ? input : '',
        expectedAnswer: typeof expectedAnswer === 'string' ? expectedAnswer : '',
        metricId: effectiveMetricId,
        criteria,
        consistency: assessment.enabled && assessment.consistency.enabled
          ? { fields: assessment.consistency.fields }
          : null,
        runs: runs ?? (assessment.enabled ? defaults.runs : undefined),
        maxConcurrency: config.maxConcurrency,
        onProgress: sendEvent
          ? (progress) => {
            sendEvent('progress', {
              ...progress,
              message: formatEvalProgress(progress),
            });
          }
          : undefined,
      },
    );
    await persistEvalReport({
      model,
      provider: llm.name,
      promptA,
      promptB: typeof promptB === 'string' && promptB.trim() !== '' ? promptB : undefined,
      result,
    });
    if (assessment.enabled) {
      const at = new Date().toISOString();
      const session = await savedSession(sessionLimits(config));
      await persistAssessment(
        (previous) => {
          const base = previous.version
            ? previous
            : buildSubmission({ config, session, previous });
          const n = (base.history?.evaluations?.length ?? 0) + 1;
          return {
            ...withHistoryRow(base, 'evaluations', summarizeEvaluation({
              n,
              at,
              stage: assessment.stage,
              result,
              promptTemplate: promptA,
            })),
            latestEvaluation: summarizeLatestEvaluation(result),
          };
        },
        {
          type: 'evaluation',
          at,
          stage: assessment.stage,
          model,
          provider: llm.name,
          promptA,
          ...(typeof promptB === 'string' && promptB.trim() !== '' ? { promptB } : {}),
          result,
        },
      );
    }
    if (sendEvent) {
      sendEvent('result', result);
      res.end();
      return;
    }
    res.json(result);
  } catch (err) {
    if (
      err?.code === 'EMPTY_PROMPT'
      || err?.code === 'NEED_PROMPTS'
      || err?.code === 'INVALID_PROMPT'
      || err?.code === 'INVALID_CASE'
      || err?.code === 'TOO_MANY_CASES'
      || err?.code === 'EXAMPLES_PLACEHOLDER_REQUIRED'
      || err?.code === 'UNRESOLVED_PLACEHOLDER'
    ) {
      if (!res.headersSent) {
        return res.status(400).json({ error: err.message });
      }
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      return res.end();
    }
    console.error('[eval/compare] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to compare prompts' });
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to compare prompts' })}\n\n`);
    res.end();
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
