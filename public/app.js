/**
 * Prompt Evaluation Simulator – client (milestone 2).
 * Posts to /api/eval/run and renders outputs + optional metric scores.
 */

const promptTemplateEl = document.getElementById('promptTemplate');
const evalInputEl = document.getElementById('evalInput');
const expectedAnswerEl = document.getElementById('expectedAnswer');
const metricSelectEl = document.getElementById('metricSelect');
const runCountEl = document.getElementById('runCount');
const runBtn = document.getElementById('runBtn');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');
const resultsEmpty = document.getElementById('resultsEmpty');
const resultsList = document.getElementById('resultsList');
const resultsMeta = document.getElementById('resultsMeta');
const aggregatePanel = document.getElementById('aggregatePanel');
const aggMean = document.getElementById('aggMean');
const aggMin = document.getElementById('aggMin');
const aggMax = document.getElementById('aggMax');

const MIN_RUNS = 1;
const MAX_RUNS = 5;

function clampRuns(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 3;
  return Math.min(MAX_RUNS, Math.max(MIN_RUNS, n));
}

function setBusy(busy) {
  runBtn.disabled = busy;
  promptTemplateEl.readOnly = busy;
  evalInputEl.readOnly = busy;
  expectedAnswerEl.readOnly = busy;
  metricSelectEl.disabled = busy;
  runCountEl.readOnly = busy;
  statusText.textContent = busy ? 'Running independent Octavus sessions…' : '';
}

function showError(message) {
  if (!message) {
    errorText.hidden = true;
    errorText.textContent = '';
    return;
  }
  errorText.hidden = false;
  errorText.textContent = message;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a 0–1 score for display (e.g. 0.85 → "0.85", 1 → "1.00"). */
function formatScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score.toFixed(2);
}

function renderAggregate(aggregate) {
  if (!aggregate) {
    aggregatePanel.hidden = true;
    return;
  }
  aggregatePanel.hidden = false;
  aggMean.textContent = formatScore(aggregate.mean);
  aggMin.textContent = formatScore(aggregate.min);
  aggMax.textContent = formatScore(aggregate.max);
}

/**
 * @param {{
 *   runs: number,
 *   metricId: string | null,
 *   aggregate: { mean: number, min: number, max: number } | null,
 *   results: Array<{ run: number, output: string, error: string | null, status: string, sessionId: string, score: number | null }>
 * }} batch
 */
function renderResults(batch) {
  resultsEmpty.hidden = true;
  resultsList.hidden = false;
  resultsMeta.hidden = false;

  const scored = batch.aggregate != null;
  resultsMeta.textContent = scored
    ? `${batch.runs} run${batch.runs === 1 ? '' : 's'} · metric ${batch.metricId}`
    : `${batch.runs} independent run${batch.runs === 1 ? '' : 's'} · not scored`;

  renderAggregate(batch.aggregate);

  resultsList.innerHTML = batch.results
    .map((result) => {
      const failed = result.status === 'error' || result.error;
      const body = failed
        ? (result.error || 'Run failed')
        : (result.output || '(empty output)');
      const tag = failed
        ? '<span class="tag error">Error</span>'
        : `<span class="tag success">Run ${result.run}</span>`;
      const scoreLabel = formatScore(result.score);
      const scoreHtml = scoreLabel != null
        ? `<span class="eval-result__score body-xsmall">Score <strong>${scoreLabel}</strong></span>`
        : '<span class="eval-result__score body-xsmall eval-result__score--na">No score</span>';
      return `
        <li class="eval-result">
          <div class="eval-result__header">
            <div class="eval-result__header-left">
              ${tag}
              ${scoreHtml}
            </div>
            <span class="body-xxsmall eval-result__session">session ${escapeHtml(result.sessionId)}</span>
          </div>
          <pre class="eval-result__output body-small">${escapeHtml(body)}</pre>
        </li>
      `;
    })
    .join('');
}

async function runEvaluation() {
  showError('');
  const promptTemplate = promptTemplateEl.value;
  const input = evalInputEl.value;
  const expectedAnswer = expectedAnswerEl.value;
  const metricId = metricSelectEl.value;
  const runs = clampRuns(runCountEl.value);
  runCountEl.value = String(runs);

  if (!promptTemplate.trim() && !input.trim()) {
    showError('Enter a prompt template and/or an input before running.');
    return;
  }

  setBusy(true);
  try {
    const res = await fetch('/api/eval/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptTemplate, input, runs, expectedAnswer, metricId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    renderResults(data);
    statusText.textContent = 'Done.';
  } catch (err) {
    console.error('[eval] Run failed:', err);
    showError(err?.message || 'Failed to run evaluation');
    statusText.textContent = '';
  } finally {
    setBusy(false);
  }
}

runBtn.addEventListener('click', () => {
  void runEvaluation();
});

runCountEl.addEventListener('change', () => {
  runCountEl.value = String(clampRuns(runCountEl.value));
});

// Sensible starter values so the first open is runnable and scorable.
if (!promptTemplateEl.value) {
  promptTemplateEl.value =
    'Answer with only the capital city of the country named below. No punctuation.\n\n{{input}}';
}
if (!evalInputEl.value) {
  evalInputEl.value = 'France';
}
if (!expectedAnswerEl.value) {
  expectedAnswerEl.value = 'Paris';
}
