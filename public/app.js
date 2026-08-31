/**
 * Prompt Evaluation Simulator – client (milestone 3: A vs B).
 * Posts to /api/eval/compare under shared conditions.
 */

const promptAEl = document.getElementById('promptA');
const promptBEl = document.getElementById('promptB');
const evalInputEl = document.getElementById('evalInput');
const expectedAnswerEl = document.getElementById('expectedAnswer');
const metricSelectEl = document.getElementById('metricSelect');
const runCountEl = document.getElementById('runCount');
const runBtn = document.getElementById('runBtn');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');
const resultsEmpty = document.getElementById('resultsEmpty');
const resultsMeta = document.getElementById('resultsMeta');
const comparisonBody = document.getElementById('comparisonBody');
const verdictBanner = document.getElementById('verdictBanner');
const compareGrid = document.getElementById('compareGrid');

const MIN_RUNS = 1;
const MAX_RUNS = 5;

function clampRuns(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 3;
  return Math.min(MAX_RUNS, Math.max(MIN_RUNS, n));
}

function setBusy(busy) {
  runBtn.disabled = busy;
  promptAEl.readOnly = busy;
  promptBEl.readOnly = busy;
  evalInputEl.readOnly = busy;
  expectedAnswerEl.readOnly = busy;
  metricSelectEl.disabled = busy;
  runCountEl.readOnly = busy;
  statusText.textContent = busy
    ? 'Running Prompt A and Prompt B on independent Octavus sessions…'
    : '';
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

function formatScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score.toFixed(2);
}

function renderRunList(results) {
  return `
    <ol class="eval-results">
      ${results.map((result) => {
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
      }).join('')}
    </ol>
  `;
}

function renderVerdict(data) {
  const { comparison, prompts, conditions } = data;
  const byId = Object.fromEntries(prompts.map((p) => [p.id, p]));
  const meanA = formatScore(comparison.means.A);
  const meanB = formatScore(comparison.means.B);

  if (comparison.outcome === 'unscored') {
    verdictBanner.className = 'eval-verdict eval-verdict--neutral';
    verdictBanner.innerHTML = `
      <p class="body-small eval-verdict__title"><strong>No winner yet</strong></p>
      <p class="body-xxsmall eval-verdict__detail">
        Add an expected answer to score both prompts and compare mean scores.
        Individual outputs are still shown below.
      </p>
    `;
    return;
  }

  if (comparison.outcome === 'tie') {
    verdictBanner.className = 'eval-verdict eval-verdict--tie';
    verdictBanner.innerHTML = `
      <p class="body-small eval-verdict__title"><strong>Tie</strong> — same mean score</p>
      <p class="body-xxsmall eval-verdict__detail">
        Prompt A mean ${meanA} · Prompt B mean ${meanB}
        ${conditions.metricId ? ` · metric ${escapeHtml(conditions.metricId)}` : ''}
      </p>
    `;
    return;
  }

  const winner = byId[comparison.winnerId];
  const loserId = comparison.winnerId === 'A' ? 'B' : 'A';
  verdictBanner.className = 'eval-verdict eval-verdict--winner';
  verdictBanner.innerHTML = `
    <p class="body-small eval-verdict__title">
      <strong>${escapeHtml(winner?.label || `Prompt ${comparison.winnerId}`)} wins</strong>
      on mean score
    </p>
    <p class="body-xxsmall eval-verdict__detail">
      Prompt A mean ${meanA} · Prompt B mean ${meanB}
      ${conditions.metricId ? ` · metric ${escapeHtml(conditions.metricId)}` : ''}
      · check per-run scores below for consistency
    </p>
    <p class="visually-hidden">
      Winner ${comparison.winnerId}; loser ${loserId}.
    </p>
  `;
}

function renderPromptColumn(prompt, isWinner) {
  const mean = formatScore(prompt.aggregate?.mean);
  const min = formatScore(prompt.aggregate?.min);
  const max = formatScore(prompt.aggregate?.max);
  const winnerBadge = isWinner ? '<span class="tag success">Higher mean</span>' : '';

  const summary = prompt.aggregate
    ? `
      <div class="eval-prompt-summary">
        <p class="heading-xsmall eval-prompt-summary__mean">Mean ${mean}</p>
        <p class="body-xxsmall eval-prompt-summary__range">min ${min} · max ${max}</p>
      </div>
    `
    : `
      <div class="eval-prompt-summary">
        <p class="body-xsmall eval-prompt-summary__mean">Not scored</p>
      </div>
    `;

  return `
    <article class="eval-prompt-col ${isWinner ? 'eval-prompt-col--winner' : ''}">
      <header class="eval-prompt-col__header">
        <h3 class="heading-xsmall">${escapeHtml(prompt.label)}</h3>
        ${winnerBadge}
      </header>
      ${summary}
      ${renderRunList(prompt.results)}
    </article>
  `;
}

function renderComparison(data) {
  resultsEmpty.hidden = true;
  comparisonBody.hidden = false;
  resultsMeta.hidden = false;

  const runs = data.conditions.runs;
  resultsMeta.textContent = `${runs} run${runs === 1 ? '' : 's'} each · shared input & metric`;

  renderVerdict(data);
  compareGrid.innerHTML = data.prompts
    .map((p) => renderPromptColumn(p, data.comparison.winnerId === p.id))
    .join('');
}

async function runComparison() {
  showError('');
  const promptA = promptAEl.value;
  const promptB = promptBEl.value;
  const input = evalInputEl.value;
  const expectedAnswer = expectedAnswerEl.value;
  const metricId = metricSelectEl.value;
  const runs = clampRuns(runCountEl.value);
  runCountEl.value = String(runs);

  if (!promptA.trim() && !input.trim()) {
    showError('Enter Prompt A (and optionally an input) before comparing.');
    return;
  }
  if (!promptB.trim() && !input.trim()) {
    showError('Enter Prompt B (and optionally an input) before comparing.');
    return;
  }

  setBusy(true);
  try {
    const res = await fetch('/api/eval/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptA, promptB, input, runs, expectedAnswer, metricId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    renderComparison(data);
    statusText.textContent = 'Done.';
  } catch (err) {
    console.error('[eval] Compare failed:', err);
    showError(err?.message || 'Failed to compare prompts');
    statusText.textContent = '';
  } finally {
    setBusy(false);
  }
}

runBtn.addEventListener('click', () => {
  void runComparison();
});

runCountEl.addEventListener('change', () => {
  runCountEl.value = String(clampRuns(runCountEl.value));
});

// Starter pair: A is strict/short; B tends to add extra words (worse for exact match).
if (!promptAEl.value) {
  promptAEl.value =
    'Answer with only the capital city of the country named below. No punctuation.\n\n{{input}}';
}
if (!promptBEl.value) {
  promptBEl.value =
    'What is the capital of the following country? Reply in a full sentence.\n\n{{input}}';
}
if (!evalInputEl.value) {
  evalInputEl.value = 'France';
}
if (!expectedAnswerEl.value) {
  expectedAnswerEl.value = 'Paris';
}
