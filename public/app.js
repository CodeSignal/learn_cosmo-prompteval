/**
 * Prompt Evaluation Simulator – client (milestone 4: multi-case A vs B).
 * Posts to /api/eval/compare with prompts + cases[].
 */

const promptAEl = document.getElementById('promptA');
const promptBEl = document.getElementById('promptB');
const casesListEl = document.getElementById('casesList');
const addCaseBtn = document.getElementById('addCaseBtn');
const metricSelectEl = document.getElementById('metricSelect');
const runCountEl = document.getElementById('runCount');
const runBtn = document.getElementById('runBtn');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');
const resultsEmpty = document.getElementById('resultsEmpty');
const resultsMeta = document.getElementById('resultsMeta');
const comparisonBody = document.getElementById('comparisonBody');
const verdictBanner = document.getElementById('verdictBanner');
const overallGrid = document.getElementById('overallGrid');
const caseResultsEl = document.getElementById('caseResults');

const MIN_RUNS = 1;
const MAX_RUNS = 5;
const MIN_CASES = 1;
const MAX_CASES = 5;

/** @type {Array<{ id: string, input: string, expectedAnswer: string }>} */
let cases = [];

function clampRuns(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 2;
  return Math.min(MAX_RUNS, Math.max(MIN_RUNS, n));
}

function newCaseId() {
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function setBusy(busy) {
  runBtn.disabled = busy;
  addCaseBtn.disabled = busy || cases.length >= MAX_CASES;
  promptAEl.readOnly = busy;
  promptBEl.readOnly = busy;
  metricSelectEl.disabled = busy;
  runCountEl.readOnly = busy;
  casesListEl.querySelectorAll('textarea, button').forEach((el) => {
    if (el.tagName === 'TEXTAREA') el.readOnly = busy;
    else el.disabled = busy || (el.classList.contains('eval-case__remove') && cases.length <= MIN_CASES);
  });
  statusText.textContent = busy
    ? 'Running Prompt A and Prompt B across test cases on independent Octavus sessions…'
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

function syncCasesFromDom() {
  const cards = [...casesListEl.querySelectorAll('.eval-case')];
  cases = cards.map((card) => ({
    id: card.dataset.caseId,
    input: card.querySelector('[data-field="input"]')?.value ?? '',
    expectedAnswer: card.querySelector('[data-field="expected"]')?.value ?? '',
  }));
}

function renderCases() {
  casesListEl.innerHTML = cases
    .map((c, index) => `
      <article class="eval-case" data-case-id="${escapeHtml(c.id)}">
        <div class="eval-case__header">
          <h4 class="body-xsmall eval-case__title">Case ${index + 1}</h4>
          <button
            type="button"
            class="button button-tertiary eval-case__remove"
            data-remove="${escapeHtml(c.id)}"
            ${cases.length <= MIN_CASES ? 'disabled' : ''}
          >Remove</button>
        </div>
        <label class="eval-field">
          <span class="body-xxsmall eval-field__label">Input</span>
          <textarea class="input" data-field="input" rows="2" spellcheck="false">${escapeHtml(c.input)}</textarea>
        </label>
        <label class="eval-field">
          <span class="body-xxsmall eval-field__label">Expected answer <span class="eval-optional">(optional)</span></span>
          <textarea class="input" data-field="expected" rows="2" spellcheck="false">${escapeHtml(c.expectedAnswer)}</textarea>
        </label>
      </article>
    `)
    .join('');

  addCaseBtn.disabled = cases.length >= MAX_CASES;
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
  const caseNote = `${conditions.caseCount} case${conditions.caseCount === 1 ? '' : 's'}`;

  if (comparison.outcome === 'unscored') {
    verdictBanner.className = 'eval-verdict eval-verdict--neutral';
    verdictBanner.innerHTML = `
      <p class="body-small eval-verdict__title"><strong>No overall winner yet</strong></p>
      <p class="body-xxsmall eval-verdict__detail">
        Add expected answers on your cases to score prompts across ${caseNote}.
      </p>
    `;
    return;
  }

  if (comparison.outcome === 'tie') {
    verdictBanner.className = 'eval-verdict eval-verdict--tie';
    verdictBanner.innerHTML = `
      <p class="body-small eval-verdict__title"><strong>Tie</strong> — same overall mean</p>
      <p class="body-xxsmall eval-verdict__detail">
        Prompt A ${meanA} · Prompt B ${meanB} · across ${caseNote}
        ${conditions.metricId ? ` · ${escapeHtml(conditions.metricId)}` : ''}
      </p>
    `;
    return;
  }

  const winner = byId[comparison.winnerId];
  verdictBanner.className = 'eval-verdict eval-verdict--winner';
  verdictBanner.innerHTML = `
    <p class="body-small eval-verdict__title">
      <strong>${escapeHtml(winner?.label || `Prompt ${comparison.winnerId}`)} wins overall</strong>
    </p>
    <p class="body-xxsmall eval-verdict__detail">
      Prompt A mean ${meanA} · Prompt B mean ${meanB} · across ${caseNote}
      ${conditions.metricId ? ` · ${escapeHtml(conditions.metricId)}` : ''}
      · check per-case results for consistency
    </p>
  `;
}

function renderOverallCards(data) {
  overallGrid.innerHTML = data.prompts
    .map((prompt) => {
      const isWinner = data.comparison.winnerId === prompt.id;
      const mean = formatScore(prompt.aggregate?.mean);
      const min = formatScore(prompt.aggregate?.min);
      const max = formatScore(prompt.aggregate?.max);
      const caseLines = (prompt.caseSummaries || [])
        .map((cs) => {
          const m = formatScore(cs.mean);
          return `<li class="body-xxsmall">${escapeHtml(cs.caseLabel)}: ${m ?? '—'}</li>`;
        })
        .join('');
      return `
        <article class="eval-prompt-col ${isWinner ? 'eval-prompt-col--winner' : ''}">
          <header class="eval-prompt-col__header">
            <h3 class="heading-xsmall">${escapeHtml(prompt.label)} · overall</h3>
            ${isWinner ? '<span class="tag success">Higher mean</span>' : ''}
          </header>
          <div class="eval-prompt-summary">
            <p class="heading-xsmall eval-prompt-summary__mean">
              ${prompt.aggregate ? `Mean ${mean}` : 'Not scored'}
            </p>
            ${prompt.aggregate ? `<p class="body-xxsmall eval-prompt-summary__range">min ${min} · max ${max}</p>` : ''}
          </div>
          <ul class="eval-case-mean-list">${caseLines}</ul>
        </article>
      `;
    })
    .join('');
}

function renderCaseBlock(testCase) {
  const meanA = formatScore(testCase.comparison.means.A);
  const meanB = formatScore(testCase.comparison.means.B);
  let caseVerdict = 'Not scored';
  if (testCase.comparison.outcome === 'tie') caseVerdict = 'Tie';
  if (testCase.comparison.outcome === 'winner') {
    caseVerdict = `Prompt ${testCase.comparison.winnerId} wins`;
  }

  const cols = testCase.prompts
    .map((prompt) => {
      const isWinner = testCase.comparison.winnerId === prompt.id;
      const mean = formatScore(prompt.aggregate?.mean);
      return `
        <article class="eval-prompt-col ${isWinner ? 'eval-prompt-col--winner' : ''}">
          <header class="eval-prompt-col__header">
            <h4 class="body-xsmall">${escapeHtml(prompt.label)}</h4>
            ${isWinner ? '<span class="tag success">Higher mean</span>' : ''}
          </header>
          <div class="eval-prompt-summary">
            <p class="body-xsmall eval-prompt-summary__mean">
              ${prompt.aggregate ? `Mean ${mean}` : 'Not scored'}
            </p>
          </div>
          ${renderRunList(prompt.results)}
        </article>
      `;
    })
    .join('');

  return `
    <section class="eval-case-result">
      <header class="eval-case-result__header">
        <div>
          <h3 class="heading-xsmall">${escapeHtml(testCase.label)}</h3>
          <p class="body-xxsmall eval-case-result__meta">
            Input: ${escapeHtml(testCase.input || '(empty)')}
            ${testCase.expectedAnswer != null ? ` · Expected: ${escapeHtml(testCase.expectedAnswer)}` : ''}
          </p>
        </div>
        <p class="body-xsmall eval-case-result__verdict">
          ${escapeHtml(caseVerdict)}
          ${meanA != null || meanB != null ? ` · A ${meanA ?? '—'} / B ${meanB ?? '—'}` : ''}
        </p>
      </header>
      <div class="eval-compare-grid">${cols}</div>
    </section>
  `;
}

function renderComparison(data) {
  resultsEmpty.hidden = true;
  comparisonBody.hidden = false;
  resultsMeta.hidden = false;

  const { runs, caseCount } = data.conditions;
  resultsMeta.textContent =
    `${caseCount} case${caseCount === 1 ? '' : 's'} · ${runs} run${runs === 1 ? '' : 's'} per prompt per case`;

  renderVerdict(data);
  renderOverallCards(data);
  caseResultsEl.innerHTML = data.cases.map(renderCaseBlock).join('');
}

async function runComparison() {
  showError('');
  syncCasesFromDom();

  const promptA = promptAEl.value;
  const promptB = promptBEl.value;
  const metricId = metricSelectEl.value;
  const runs = clampRuns(runCountEl.value);
  runCountEl.value = String(runs);

  if (!promptA.trim()) {
    showError('Enter Prompt A before comparing.');
    return;
  }
  if (!promptB.trim()) {
    showError('Enter Prompt B before comparing.');
    return;
  }
  if (cases.length < MIN_CASES) {
    showError('Add at least one test case.');
    return;
  }
  if (cases.every((c) => !c.input.trim() && !c.expectedAnswer.trim())) {
    showError('Fill in at least one case input (or expected answer) before comparing.');
    return;
  }

  setBusy(true);
  try {
    const res = await fetch('/api/eval/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promptA,
        promptB,
        cases: cases.map((c, i) => ({
          id: c.id,
          label: `Case ${i + 1}`,
          input: c.input,
          expectedAnswer: c.expectedAnswer,
        })),
        runs,
        metricId,
      }),
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

addCaseBtn.addEventListener('click', () => {
  syncCasesFromDom();
  if (cases.length >= MAX_CASES) return;
  cases.push({ id: newCaseId(), input: '', expectedAnswer: '' });
  renderCases();
});

casesListEl.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-remove]');
  if (!btn) return;
  syncCasesFromDom();
  if (cases.length <= MIN_CASES) return;
  cases = cases.filter((c) => c.id !== btn.getAttribute('data-remove'));
  renderCases();
});

runBtn.addEventListener('click', () => {
  void runComparison();
});

runCountEl.addEventListener('change', () => {
  runCountEl.value = String(clampRuns(runCountEl.value));
});

// Starters: strict vs verbose prompts; capitals across three countries.
if (!promptAEl.value) {
  promptAEl.value =
    'Answer with only the capital city of the country named below. No punctuation.\n\n{{input}}';
}
if (!promptBEl.value) {
  promptBEl.value =
    'What is the capital of the following country? Reply in a full sentence.\n\n{{input}}';
}

cases = [
  { id: newCaseId(), input: 'France', expectedAnswer: 'Paris' },
  { id: newCaseId(), input: 'Japan', expectedAnswer: 'Tokyo' },
  { id: newCaseId(), input: 'Germany', expectedAnswer: 'Berlin' },
];
renderCases();
