/**
 * Build `.codesignal/report.md` after each evaluation run for Cosmo / assessment.
 */

import fs from 'fs/promises';
import path from 'path';
import { formatDuration } from './format-duration.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * @param {unknown} score
 * @returns {string}
 */
function formatScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return score.toFixed(2);
}

/**
 * @param {unknown} text
 * @param {number} [max=240]
 * @returns {string}
 */
function clip(text, max = 240) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Build markdown for one completed comparison / evaluation result.
 *
 * @param {{
 *   model?: string,
 *   provider?: string,
 *   promptA?: string,
 *   promptB?: string,
 *   result: {
 *     conditions?: { metricId?: string | null, runs?: number, caseCount?: number, maxConcurrency?: number, durationMs?: number },
 *     comparison?: { outcome?: string, winnerId?: string | null, means?: Record<string, number | null> },
 *     prompts?: Array<{ id: string, label?: string, aggregate?: { mean?: number, min?: number, max?: number, count?: number } | null }>,
 *     cases?: Array<{
 *       id?: string,
 *       label?: string,
 *       input?: string,
 *       expectedAnswer?: string | null,
 *       comparison?: { outcome?: string, winnerId?: string | null, means?: Record<string, number | null> },
 *       prompts?: Array<{
 *         id: string,
 *         label?: string,
 *         aggregate?: { mean?: number } | null,
 *         results?: Array<{ run?: number, status?: string, score?: number | null, output?: string, error?: string | null }>,
 *       }>,
 *     }>,
 *   },
 *   generatedAt?: string,
 * }} opts
 * @returns {string}
 */
export function buildEvalReportMarkdown(opts) {
  const result = opts.result && typeof opts.result === 'object' ? opts.result : {};
  const conditions = result.conditions && typeof result.conditions === 'object' ? result.conditions : {};
  const comparison = result.comparison && typeof result.comparison === 'object' ? result.comparison : {};
  const prompts = Array.isArray(result.prompts) ? result.prompts : [];
  const cases = Array.isArray(result.cases) ? result.cases : [];
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const multi = prompts.length > 1;

  const lines = [
    '# Prompt Evaluation Report',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Setup',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Model | ${escapeCell(opts.model || '—')} |`,
    `| Provider | ${escapeCell(opts.provider || '—')} |`,
    `| Metric | ${escapeCell(conditions.metricId ?? 'none (unscored)')} |`,
    `| Runs each | ${escapeCell(conditions.runs ?? '—')} |`,
    `| Max concurrency | ${escapeCell(conditions.maxConcurrency ?? '—')} |`,
    `| Cases | ${escapeCell(conditions.caseCount ?? cases.length)} |`,
    `| Duration | ${escapeCell(formatDuration(conditions.durationMs) || '—')} |`,
    `| Mode | ${multi ? 'Prompt A vs Prompt B' : 'Single prompt'} |`,
    '',
    '## Prompts',
    '',
    '### Prompt A',
    '',
    '```',
    String(opts.promptA ?? prompts.find((p) => p.id === 'A')?.promptTemplate ?? '').trim() || '(empty)',
    '```',
    '',
  ];

  if (multi) {
    lines.push(
      '### Prompt B',
      '',
      '```',
      String(opts.promptB ?? prompts.find((p) => p.id === 'B')?.promptTemplate ?? '').trim() || '(empty)',
      '```',
      '',
    );
  }

  lines.push('## Overall results', '');

  if (comparison.outcome === 'winner' && comparison.winnerId) {
    const winner = prompts.find((p) => p.id === comparison.winnerId);
    lines.push(`**Winner:** ${escapeCell(winner?.label || `Prompt ${comparison.winnerId}`)}`);
  } else if (comparison.outcome === 'tie') {
    lines.push('**Outcome:** Tie (same overall mean)');
  } else if (multi) {
    lines.push('**Outcome:** No scored winner (add expected answers to score)');
  } else {
    lines.push('**Outcome:** Evaluation complete');
  }
  lines.push('');

  lines.push('| Prompt | Mean | Min | Max | Scored runs |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const p of prompts) {
    const agg = p.aggregate;
    lines.push(
      `| ${escapeCell(p.label || p.id)} | ${formatScore(agg?.mean)} | ${formatScore(agg?.min)} | ${formatScore(agg?.max)} | ${escapeCell(agg?.count ?? 0)} |`,
    );
  }
  lines.push('');

  lines.push('## Case details', '');
  if (cases.length === 0) {
    lines.push('_No case results._', '');
  }

  for (const testCase of cases) {
    lines.push(`### ${escapeCell(testCase.label || testCase.id || 'Case')}`, '');
    lines.push(`- **Input:** ${escapeCell(testCase.input || '(empty)')}`);
    lines.push(
      `- **Expected:** ${testCase.expectedAnswer == null || testCase.expectedAnswer === ''
        ? '_none_'
        : escapeCell(testCase.expectedAnswer)}`,
    );
    if (multi && testCase.comparison) {
      if (testCase.comparison.outcome === 'winner' && testCase.comparison.winnerId) {
        lines.push(`- **Case winner:** Prompt ${escapeCell(testCase.comparison.winnerId)}`);
      } else if (testCase.comparison.outcome === 'tie') {
        lines.push('- **Case outcome:** Tie');
      } else {
        lines.push('- **Case outcome:** Unscored');
      }
    }
    lines.push('');

    for (const prompt of testCase.prompts || []) {
      lines.push(`#### ${escapeCell(prompt.label || prompt.id)}`, '');
      lines.push(`Mean: ${formatScore(prompt.aggregate?.mean)}`, '');
      lines.push('| Run | Status | Score | Output |');
      lines.push('| --- | --- | --- | --- |');
      for (const run of prompt.results || []) {
        const body = run.error
          ? `Error: ${run.error}`
          : (run.output || '(empty)');
        lines.push(
          `| ${escapeCell(run.run ?? '')} | ${escapeCell(run.status || (run.error ? 'error' : 'ok'))} | ${formatScore(run.score)} | ${escapeCell(clip(body))} |`,
        );
      }
      lines.push('');
    }
  }

  lines.push(
    '## Notes for Cosmo / grading',
    '',
    '- Prefer overall means and case-level consistency over any single run.',
    '- Unscored runs usually mean no expected answer or a failed API call.',
    '- Compare mode uses the same cases, metric, run count, and model for both prompts.',
    '',
  );

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * Write report markdown to `.codesignal/report.md` (creates the directory).
 * @param {string} reportPath
 * @param {string} markdown
 */
export async function writeEvalReportFile(reportPath, markdown) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, markdown, 'utf8');
}

/**
 * @param {string} rootDir project root
 * @returns {string}
 */
export function defaultEvalReportPath(rootDir) {
  return path.join(rootDir, '.codesignal', 'report.md');
}
