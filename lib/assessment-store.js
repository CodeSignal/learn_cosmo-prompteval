/**
 * Server-written assessment files under `.codesignal/`:
 *
 * - submission.json   — the candidate's current work (prompt, own cases, custom
 *                        check, notes) plus a compact history. Hidden tests read
 *                        the prompt and criteria from here and re-run them on
 *                        hidden data; scores the browser reports are never trusted.
 * - submission.md     — the same content, compact and readable, for rubric graders.
 * - evaluations.jsonl — one line per evaluation or calibration with full outputs.
 */

import { createHash } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { writeJsonFileAtomic, writeTextFileAtomic } from './helpers.js';
import { measureCopying } from './copy-detection.js';

export const SUBMISSION_VERSION = 1;
const HISTORY_LIMIT = 200;

/**
 * @param {string} rootDir project root
 */
export function assessmentPaths(rootDir) {
  const dir = path.join(rootDir, '.codesignal');
  return {
    dir,
    submissionJson: path.join(dir, 'submission.json'),
    submissionMd: path.join(dir, 'submission.md'),
    evaluationsLog: path.join(dir, 'evaluations.jsonl'),
  };
}

/**
 * Short stable fingerprint so graders can count distinct prompt/criteria versions.
 * @param {unknown} text
 * @returns {string}
 */
export function textVersion(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 8);
}

/**
 * @param {string} filePath
 * @returns {Promise<Record<string, any>>}
 */
export async function readSubmission(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, any>} previous
 * @returns {{ evaluations: object[], calibrations: object[] }}
 */
function previousHistory(previous) {
  const history = previous?.history ?? {};
  return {
    evaluations: Array.isArray(history.evaluations) ? history.evaluations : [],
    calibrations: Array.isArray(history.calibrations) ? history.calibrations : [],
  };
}

/**
 * Candidate-owned artifacts from a normalized eval session.
 * @param {{
 *   config: ReturnType<typeof import('./session-config.js').normalizeSessionConfig>,
 *   session: import('./eval-session.js').EvalSession,
 *   previous?: Record<string, any>,
 *   updatedAt?: string,
 * }} opts
 */
export function buildSubmission(opts) {
  const { config, session } = opts;
  const assessment = config.assessment;
  return {
    version: SUBMISSION_VERSION,
    updatedAt: opts.updatedAt ?? new Date().toISOString(),
    stage: assessment.stage,
    stageLabel: assessment.stageLabel,
    model: session.model || config.model,
    prompt: {
      template: session.promptA,
      version: textVersion(session.promptA),
      ...(session.compareMode && session.promptB.trim()
        ? { comparedWith: session.promptB }
        : {}),
      ...(Array.isArray(session.examples) && session.examples.length > 0
        ? { examples: session.examples.map(({ input, idealOutput }) => ({ input, idealOutput })) }
        : {}),
    },
    candidateCases: session.cases.map(({ id, input, expectedAnswer, variables }) => ({
      id,
      input,
      expectedAnswer,
      ...(variables ? { variables } : {}),
    })),
    customCheck: {
      criteria: session.customCheckCriteria ?? '',
      version: textVersion(session.customCheckCriteria ?? ''),
    },
    notes: session.notes ?? '',
    copying: {
      prompt: measureCopying(session.promptA, assessment.materials.map((m) => m.body)),
      customCheck: measureCopying(session.customCheckCriteria ?? '', assessment.materials.map((m) => m.body)),
    },
    settings: { metricId: session.metricId, runs: session.runs },
    history: previousHistory(opts.previous ?? {}),
    latestEvaluation: opts.previous?.latestEvaluation ?? null,
  };
}

/**
 * Per-case view of the graded prompt (A) in one evaluation result.
 * @param {any} result
 */
export function summarizeLatestEvaluation(result) {
  const cases = Array.isArray(result?.cases) ? result.cases : [];
  return {
    metricId: result?.conditions?.metricId ?? null,
    runs: result?.conditions?.runs ?? null,
    cases: cases.map((c) => {
      const p = c.prompts?.find((pr) => pr.id === 'A') ?? c.prompts?.[0];
      return {
        id: c.id,
        label: c.label,
        provided: c.provided === true,
        mean: p?.aggregate?.mean ?? null,
        agreeing: p?.consistency?.agreeing ?? null,
        compared: p?.consistency?.runs ?? null,
        commonOutput: String(p?.consistency?.commonAnswer ?? p?.results?.find((r) => r.status === 'ok')?.output ?? '')
          .slice(0, 400),
      };
    }),
  };
}

/**
 * Compact history row for one evaluation result.
 * @param {{ n: number, at: string, stage: string, result: any, promptTemplate: string }} opts
 */
export function summarizeEvaluation(opts) {
  const { result } = opts;
  const promptA = result.prompts?.find((p) => p.id === 'A') ?? result.prompts?.[0];
  const cases = Array.isArray(result.cases) ? result.cases : [];
  return {
    n: opts.n,
    at: opts.at,
    stage: opts.stage,
    promptVersion: textVersion(opts.promptTemplate),
    ...(result.conditions?.criteria ? { criteriaVersion: textVersion(result.conditions.criteria) } : {}),
    metricId: result.conditions?.metricId ?? null,
    runs: result.conditions?.runs ?? null,
    caseCount: cases.length,
    providedCases: cases.filter((c) => c.provided).length,
    candidateCases: cases.filter((c) => !c.provided).length,
    compare: (result.prompts?.length ?? 0) > 1,
    mean: promptA?.aggregate?.mean ?? null,
    stability: promptA?.consistency?.stability ?? null,
    scoreErrors: promptA?.scoreErrors ?? 0,
  };
}

/**
 * @param {{ n: number, at: string, stage: string, calibration: any }} opts
 */
export function summarizeCalibration(opts) {
  const { agreement } = opts.calibration;
  return {
    n: opts.n,
    at: opts.at,
    stage: opts.stage,
    criteriaVersion: textVersion(opts.calibration.criteria),
    agreeing: agreement.agreeing,
    total: agreement.total,
    unscored: agreement.total - agreement.scored,
  };
}

/**
 * @param {Record<string, any>} submission
 * @param {'evaluations' | 'calibrations'} kind
 * @param {object} row
 */
export function withHistoryRow(submission, kind, row) {
  const history = previousHistory(submission);
  history[kind] = [...history[kind], row].slice(-HISTORY_LIMIT);
  return { ...submission, history };
}

/**
 * A fence longer than any backtick run inside the text, so candidate prompts
 * cannot close it early.
 * @param {string} text
 */
function fenced(text) {
  const longest = Math.max(0, ...[...String(text).matchAll(/`+/gu)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [fence, String(text).trim() || '(empty)', fence].join('\n');
}

function cell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ').trim();
}

function score(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

function percent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
}

/**
 * Readable submission for rubric graders. Kept compact on purpose: full run
 * outputs live in evaluations.jsonl.
 * @param {Record<string, any>} submission
 * @returns {string}
 */
export function buildSubmissionMarkdown(submission) {
  const history = previousHistory(submission);
  const cases = Array.isArray(submission.candidateCases) ? submission.candidateCases : [];
  const lines = [
    '# Candidate submission',
    '',
    `- **Level:** ${cell(submission.stageLabel || submission.stage || '—')}`,
    `- **Updated:** ${cell(submission.updatedAt)}`,
    `- **Model:** ${cell(submission.model || '—')}`,
    '',
    '## Prompt (graded)',
    '',
    fenced(submission.prompt?.template ?? ''),
    '',
  ];

  if (Array.isArray(submission.prompt?.examples) && submission.prompt.examples.length > 0) {
    lines.push('### Shared examples', '');
    submission.prompt.examples.forEach((example, i) => {
      lines.push(`${i + 1}. **Input:** ${cell(example.input)} → **Ideal output:** ${cell(example.idealOutput)}`);
    });
    lines.push('');
  }

  lines.push(`## Candidate test cases (${cases.length})`, '');
  if (cases.length === 0) lines.push('_None._', '');
  cases.forEach((c, i) => {
    lines.push(`### Case ${i + 1}`, '', 'Input:', '', fenced(c.input), '', 'Expected:', '', fenced(c.expectedAnswer), '');
  });

  lines.push('## Custom check criteria', '', fenced(submission.customCheck?.criteria ?? ''), '');
  if (submission.copying) {
    const row = (name, c) => `- **${name}:** ${c.copiedPhrases} of its ${c.textPhrases} four-word phrases also appear in the reference material (which has ${c.materialPhrases}). **Copy/paste of the reference material: ${c.isCopyPaste ? 'YES' : 'NO'}**`;
    lines.push(
      '## Copied from the reference material',
      '',
      row('Prompt', submission.copying.prompt),
      row('Custom check criteria', submission.copying.customCheck),
      '',
    );
  }
  lines.push('## Notes', '', fenced(submission.notes ?? ''), '');

  lines.push(`## Evaluation history (${history.evaluations.length})`, '');
  if (history.evaluations.length > 0) {
    lines.push(
      '| # | Level | Metric | Runs | Cases (provided + own) | Prompt version | Mean | Stability | Unscored |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const row of history.evaluations) {
      lines.push(`| ${row.n} | ${cell(row.stage)} | ${cell(row.metricId ?? 'none')} | ${cell(row.runs)} | ${row.providedCases} + ${row.candidateCases} | ${cell(row.promptVersion)} | ${score(row.mean)} | ${percent(row.stability)} | ${row.scoreErrors ?? 0} |`);
    }
    lines.push('');
  } else {
    lines.push('_No evaluations yet._', '');
  }

  lines.push(`## Custom check calibration history (${history.calibrations.length})`, '');
  if (history.calibrations.length > 0) {
    lines.push('| # | Level | Criteria version | Agrees with reviewer |', '| --- | --- | --- | --- |');
    for (const row of history.calibrations) {
      lines.push(`| ${row.n} | ${cell(row.stage)} | ${cell(row.criteriaVersion)} | ${row.agreeing}/${row.total} |`);
    }
    lines.push('');
  } else {
    lines.push('_No calibrations yet._', '');
  }

  const latest = submission.latestEvaluation;
  if (latest && Array.isArray(latest.cases)) {
    lines.push(
      `## Latest evaluation by case (metric: ${cell(latest.metricId ?? 'none')}, runs: ${cell(latest.runs)})`,
      '',
      '| Case | Mean | Runs agreeing | Most common output |',
      '| --- | --- | --- | --- |',
    );
    for (const c of latest.cases) {
      const agreeing = c.agreeing != null ? `${c.agreeing}/${c.compared}` : '—';
      lines.push(`| ${cell(`${c.provided ? 'Provided' : 'Own'}: ${c.label}`)} | ${score(c.mean)} | ${agreeing} | ${cell(c.commonOutput.slice(0, 160))} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

/**
 * Rebuild a saved eval session from submission.json. Used when
 * eval-session.json is missing, e.g. a platform that saves only the compact
 * submission (bulky files are in the task's ignored paths) recreated the
 * workspace. Results are not restored; the candidate's work is.
 * @param {Record<string, any>} submission
 * @returns {Record<string, unknown> | null}
 */
export function sessionFromSubmission(submission) {
  if (!submission || typeof submission.prompt?.template !== 'string') return null;
  return {
    model: submission.model ?? '',
    promptA: submission.prompt.template,
    promptB: submission.prompt.comparedWith ?? '',
    compareMode: typeof submission.prompt.comparedWith === 'string',
    cases: Array.isArray(submission.candidateCases) ? submission.candidateCases : [],
    ...(Array.isArray(submission.prompt.examples)
      ? { examples: submission.prompt.examples.map((e, i) => ({ id: `example-${i}`, ...e })) }
      : {}),
    metricId: submission.settings?.metricId,
    runs: submission.settings?.runs,
    lastResult: null,
    stage: submission.stage ?? '',
    customCheckCriteria: submission.customCheck?.criteria ?? '',
    notes: submission.notes ?? '',
    excludedCaseIds: [],
    lastCalibration: null,
  };
}

/**
 * @param {ReturnType<typeof assessmentPaths>} paths
 * @param {Record<string, any>} submission
 */
export async function writeSubmissionFiles(paths, submission) {
  await fs.mkdir(paths.dir, { recursive: true });
  await writeJsonFileAtomic(paths.submissionJson, submission);
  await writeTextFileAtomic(paths.submissionMd, buildSubmissionMarkdown(submission));
}

/**
 * @param {string} logPath
 * @param {object} entry
 */
export async function appendAssessmentLog(logPath, entry) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}
