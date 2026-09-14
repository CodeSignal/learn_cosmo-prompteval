/**
 * Compact wall-clock duration for eval summaries.
 */

/**
 * @param {unknown} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${Math.round(n)}ms`;

  const totalSeconds = n / 1000;
  if (totalSeconds < 60) {
    const rounded = totalSeconds < 10
      ? Math.round(totalSeconds * 10) / 10
      : Math.round(totalSeconds);
    if (rounded >= 60) return '1m';
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (seconds === 60) return `${minutes + 1}m`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
