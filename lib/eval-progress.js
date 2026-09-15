/**
 * Progress helpers for live evaluation status updates.
 */

/**
 * @typedef {object} EvalProgress
 * @property {'start' | 'run_start' | 'run_done' | 'done'} phase
 * @property {number} completed
 * @property {number} total
 * @property {number} [active]
 * @property {string} [caseLabel]
 * @property {string} [promptLabel]
 * @property {number} [run]
 * @property {boolean} [compareMode]
 */

/**
 * Build a short status line for the eval UI / SSE clients.
 * @param {EvalProgress} progress
 * @returns {string}
 */
export function formatEvalProgress(progress) {
  const total = Number.isFinite(progress.total) ? Math.max(0, progress.total) : 0;
  const completed = Number.isFinite(progress.completed)
    ? Math.min(total, Math.max(0, progress.completed))
    : 0;

  if (progress.phase === 'done' || (total > 0 && completed >= total)) {
    return 'Done.';
  }

  if (total === 0) {
    return progress.compareMode
      ? 'Comparing prompts…'
      : 'Running evaluation…';
  }

  const parts = [
    progress.compareMode ? 'Comparing prompts' : 'Running evaluation',
    `${completed}/${total} complete`,
  ];

  if (progress.caseLabel) parts.push(progress.caseLabel);
  if (progress.promptLabel) parts.push(progress.promptLabel);
  if (Number.isFinite(progress.run)) parts.push(`run ${progress.run}`);

  const active = Number.isFinite(progress.active) ? progress.active : 0;
  if (active > 0) parts.push(`${active} in flight`);

  return `${parts.join(' · ')}…`;
}

/**
 * @param {number} completed
 * @param {number} total
 * @returns {number} 0–100
 */
export function evalProgressPercent(completed, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(completed) || completed <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}
