/**
 * Prompt Evaluation Simulator – client.
 * Progressive disclosure: summary results first; case/run detail on demand.
 */

const promptAEl = document.getElementById('promptA');
const promptBEl = document.getElementById('promptB');
const casesListEl = document.getElementById('casesList');
const casesSummaryMeta = document.getElementById('casesSummaryMeta');
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
const caseDetailsPanel = document.getElementById('caseDetailsPanel');

const MIN_RUNS = 1;
const MAX_RUNS = 5;
const MIN_CASES = 1;
const MAX_CASES = 5;

/** @type {Array<{ id: string, input: string, expectedAnswer: string }>} */
let cases = [];

function clampRuns(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 3;
  return Math.min(MAX_RUNS, Math.max(MIN_RUNS, n));
}

function newCaseId() {
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function updateCasesSummary() {
  const n = cases.length;
  casesSummaryMeta.textContent = `${n} case${n === 1 ? '' : 's'}`;
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
    else {
      el.disabled = busy
        || (el.classList.contains('eval-case__remove') && cases.length <= MIN_CASES);
    }
  });
  statusText.textContent = busy
    ? 'Comparing prompts on independent Octavus sessions…'
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
  updateCasesSummary();
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
  updateCasesSummary();
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
      <p class="body-small eval-verdict__title"><strong>No scored winner yet</strong></p>
      <p class="body-xxsmall eval-verdict__detail">
        Add expected answers to your test cases to compare mean scores across ${caseNote}.
      </p>
    `;
    return;
  }

  if (comparison.outcome === 'tie') {
    verdictBanner.className = 'eval-verdict eval-verdict--tie';
    verdictBanner.innerHTML = `
      <p class="body-small eval-verdict__title"><strong>Tie</strong></p>
      <p class="body-xxsmall eval-verdict__detail">
        Both prompts have the same overall mean (${meanA}) across ${caseNote}.
      </p>
    `;
    return;
  }

  const winner = byId[comparison.winnerId];
  verdictBanner.className = 'eval-verdict eval-verdict--winner';
  verdictBanner.innerHTML = `
    <p class="body-small eval-verdict__title">
      <strong>${escapeHtml(winner?.label || `Prompt ${comparison.winnerId}`)} wins</strong>
    </p>
    <p class="body-xxsmall eval-verdict__detail">
      Overall mean — A ${meanA} · B ${meanB} · across ${caseNote}.
      Open case details below to check consistency.
    </p>
  `;
}

function renderOverallCards(data) {
  overallGrid.innerHTML = data.prompts
    .map((prompt) => {
      const isWinner = data.comparison.winnerId === prompt.id;
      const mean = formatScore(prompt.aggregate?.mean);
      return `
        <article class="eval-summary-card ${isWinner ? 'eval-summary-card--winner' : ''}">
          <p class="body-xsmall eval-summary-card__label">${escapeHtml(prompt.label)}</p>
          <p class="heading-small eval-summary-card__mean">
            ${prompt.aggregate ? mean : '—'}
          </p>
          <p class="body-xxsmall eval-summary-card__caption">
            ${prompt.aggregate ? 'overall mean' : 'not scored'}
            ${isWinner ? ' · higher' : ''}
          </p>
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
    caseVerdict = `Prompt ${testCase.comparison.winnerId} higher`;
  }

  const cols = testCase.prompts
    .map((prompt) => {
      const isWinner = testCase.comparison.winnerId === prompt.id;
      const mean = formatScore(prompt.aggregate?.mean);
      const runCount = prompt.results?.length ?? 0;
      return `
        <article class="eval-prompt-col ${isWinner ? 'eval-prompt-col--winner' : ''}">
          <header class="eval-prompt-col__header">
            <h4 class="body-xsmall">${escapeHtml(prompt.label)}</h4>
            <span class="body-xsmall">${prompt.aggregate ? `Mean ${mean}` : '—'}</span>
          </header>
          <details class="eval-details eval-details--nested">
            <summary class="eval-details__summary eval-details__summary--compact">
              <span class="body-xxsmall">Show ${runCount} run${runCount === 1 ? '' : 's'}</span>
            </summary>
            <div class="eval-details__body">
              ${renderRunList(prompt.results)}
            </div>
          </details>
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
            ${escapeHtml(testCase.input || '(empty input)')}
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
  caseDetailsPanel.open = false;

  const { runs, caseCount } = data.conditions;
  resultsMeta.textContent =
    `${caseCount} case${caseCount === 1 ? '' : 's'} · ${runs} run${runs === 1 ? '' : 's'} each`;

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
    showError('Fill in at least one case input before comparing.');
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

if (!promptAEl.value) {
  promptAEl.value =
    'Answer with only the capital city of the country named below. No punctuation.\n\n{{input}}';
}
if (!promptBEl.value) {
  promptBEl.value =
    'What is the capital of the following country? Reply in a full sentence.\n\n{{input}}';
}

// Start with one case so setup stays calm; learners can add more.
cases = [
  { id: newCaseId(), input: 'France', expectedAnswer: 'Paris' },
];
renderCases();
