/**
 * Helpers for teaching score distributions (not just means).
 */

/**
 * Collect finite scores for one prompt across all case results.
 * @param {Array<{ prompts?: Array<{ id: string, results?: Array<{ score?: number | null }> }> }>} cases
 * @param {string} promptId
 * @returns {number[]}
 */
export function collectPromptScores(cases, promptId) {
  const scores = [];
  if (!Array.isArray(cases)) return scores;
  for (const testCase of cases) {
    const prompt = (testCase.prompts || []).find((p) => p.id === promptId);
    if (!prompt?.results) continue;
    for (const result of prompt.results) {
      if (typeof result.score === 'number' && Number.isFinite(result.score)) {
        scores.push(result.score);
      }
    }
  }
  return scores;
}

/**
 * Bin scores on [0, 1] into equal-width buckets (last bin includes 1).
 * @param {number[]} scores
 * @param {number} [binCount=5]
 * @returns {number[]}
 */
export function binScores(scores, binCount = 5) {
  const n = Math.max(1, Math.floor(binCount));
  const bins = Array.from({ length: n }, () => 0);
  for (const raw of scores) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const clamped = Math.min(1, Math.max(0, raw));
    const idx = clamped >= 1 ? n - 1 : Math.floor(clamped * n);
    bins[idx] += 1;
  }
  return bins;
}

/**
 * @param {number[]} scores
 * @returns {{ count: number, perfectCount: number, bins: number[] }}
 */
export function summarizeDistribution(scores) {
  const list = Array.isArray(scores) ? scores.filter((s) => typeof s === 'number' && Number.isFinite(s)) : [];
  return {
    count: list.length,
    perfectCount: list.filter((s) => s === 1).length,
    bins: binScores(list, 5),
  };
}
