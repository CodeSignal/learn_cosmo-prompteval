/**
 * Prompt Evaluation Simulator – client.
 * Single-prompt first; optional A vs B compare. Cases append under prompts.
 */

import { collectPromptScoresByCase } from '../lib/score-distribution.js';

const promptAEl = document.getElementById('promptA');
const promptBEl = document.getElementById('promptB');
const promptBWrap = document.getElementById('promptBWrap');
const promptGrid = document.getElementById('promptGrid');
const promptALabel = document.getElementById('promptALabel');
const setupHeading = document.getElementById('setupHeading');
const headerLede = document.getElementById('headerLede');
const resultsEmptyCopy = document.getElementById('resultsEmptyCopy');
const enableCompareBtn = document.getElementById('enableCompareBtn');
const disableCompareBtn = document.getElementById('disableCompareBtn');
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

const DEFAULT_PROMPT_A =
  'Answer with only the capital city of the country named below. No punctuation.';
const DEFAULT_PROMPT_B =
  'What is the capital of the following country? Reply in a full sentence.';

/** @type {Array<{ id: string, input: string, expectedAnswer: string }>} */
let cases = [];
/** Whether Prompt B is active for A vs B comparison. */
let compareMode = false;

function clampRuns(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 2;
  return Math.min(MAX_RUNS, Math.max(MIN_RUNS, n));
}

function newCaseId() {
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function updateCasesSummary() {
  const n = cases.length;
  casesSummaryMeta.textContent = `${n} case${n === 1 ? '' : 's'}`;
}

function syncCompareModeUi() {
  promptBWrap.hidden = !compareMode;
  enableCompareBtn.hidden = compareMode;
  disableCompareBtn.hidden = !compareMode;
  promptGrid.classList.toggle('eval-prompt-grid--single', !compareMode);
  promptGrid.classList.toggle('eval-prompt-grid--compare', compareMode);

  setupHeading.textContent = compareMode ? 'Prompts' : 'Prompt';
  promptALabel.textContent = compareMode ? 'Prompt A' : 'Prompt';
  runBtn.textContent = compareMode ? 'Compare prompts' : 'Run evaluation';

  headerLede.textContent = compareMode
    ? 'Compare two prompt versions. Each test question is appended under both prompts so the comparison is fair.'
    : 'Run a prompt across test cases. Each question is appended under your prompt and scored the same way every run.';

  resultsEmptyCopy.textContent = compareMode
    ? 'Run a comparison to see which prompt scores higher — then open details if you want to inspect cases and runs.'
    : 'Run an evaluation to see scores across cases — then open details if you want to inspect individual runs.';
}

function setBusy(busy) {
  runBtn.disabled = busy;
  addCaseBtn.disabled = busy || cases.length >= MAX_CASES;
  enableCompareBtn.disabled = busy;
  disableCompareBtn.disabled = busy;
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
    ? (compareMode
      ? 'Comparing prompts — each run is independent…'
      : 'Running evaluation — each run is independent…')
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

function isMultiPrompt(data) {
  return (data?.prompts?.length ?? 0) > 1;
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
          <span class="body-xxsmall eval-field__label">Question</span>
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
  const multi = isMultiPrompt(data);
  const byId = Object.fromEntries(prompts.map((p) => [p.id, p]));
  const meanA = formatScore(comparison.means.A);
  const meanB = formatScore(comparison.means.B);
  const caseNote = `${conditions.caseCount} case${conditions.caseCount === 1 ? '' : 's'}`;
  const hasScores = prompts.some((p) => p.aggregate);

  if (!multi) {
    verdictBanner.className = 'eval-verdict eval-verdict--neutral';
    if (!hasScores) {
      verdictBanner.innerHTML = `
        <p class="body-small eval-verdict__title"><strong>Not scored yet</strong></p>
        <p class="body-xxsmall eval-verdict__detail">
          Add expected answers to your test cases to see mean scores across ${caseNote}.
        </p>
      `;
      return;
    }
    verdictBanner.innerHTML = `
      <p class="body-small eval-verdict__title"><strong>Evaluation complete</strong></p>
      <p class="body-xxsmall eval-verdict__detail">
        Overall mean ${meanA} across ${caseNote}. Check the score distribution below — a high mean can still hide unstable runs.
      </p>
    `;
    return;
  }

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
      Compare the distributions below, then open case details for consistency.
    </p>
  `;
}

function renderRunBars(scores, titlePrefix = 'Run') {
  return scores
    .map((score, i) => {
      const clamped = Math.min(1, Math.max(0, score));
      const height = Math.max(4, Math.round(clamped * 44));
      const label = formatScore(score);
      return `
        <div class="eval-dist__col" title="${escapeHtml(titlePrefix)} ${i + 1}: ${label}">
          <div class="eval-dist__bar" style="height: ${height}px"></div>
          <span class="body-xxsmall eval-dist__count">${i + 1}</span>
        </div>
      `;
    })
    .join('');
}

function renderDistribution(groups) {
  const allScores = groups.flatMap((g) => g.scores);
  if (!allScores.length) {
    return `
      <div class="eval-dist eval-dist--empty">
        <p class="body-xxsmall eval-dist__caption">No scored runs yet</p>
      </div>
    `;
  }

  const perfectCount = allScores.filter((s) => s === 1).length;
  const multiCase = groups.length > 1;

  const body = multiCase
    ? groups.map((group) => `
        <div class="eval-dist__group">
          <p class="body-xxsmall eval-dist__group-label">${escapeHtml(group.caseLabel)}</p>
          <div class="eval-dist__bars" style="--dist-count: ${group.scores.length}">
            ${renderRunBars(group.scores, group.caseLabel)}
          </div>
        </div>
      `).join('')
    : `
        <div class="eval-dist__bars" style="--dist-count: ${allScores.length}">
          ${renderRunBars(allScores)}
        </div>
      `;

  return `
    <div class="eval-dist" aria-label="Scores by run${multiCase ? ' and case' : ''}">
      <p class="body-xxsmall eval-dist__heading">
        ${multiCase ? 'Each bar is one run, grouped by case' : 'Each bar is one run'}
      </p>
      ${body}
      <p class="body-xxsmall eval-dist__caption">
        ${perfectCount} of ${allScores.length} perfect (score 1)
        ${multiCase ? ` · ${groups.length} cases` : ''}
      </p>
    </div>
  `;
}

function renderOverallCards(data) {
  const multi = isMultiPrompt(data);
  overallGrid.innerHTML = data.prompts
    .map((prompt) => {
      const isWinner = multi && data.comparison.winnerId === prompt.id;
      const mean = formatScore(prompt.aggregate?.mean);
      const groups = collectPromptScoresByCase(data.cases, prompt.id);
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
          ${renderDistribution(groups)}
        </article>
      `;
    })
    .join('');
}

function renderCaseBlock(testCase, multi) {
  const meanA = formatScore(testCase.comparison.means.A);
  const meanB = formatScore(testCase.comparison.means.B);
  let caseVerdict = 'Not scored';
  if (!multi) {
    const only = testCase.prompts[0];
    caseVerdict = only?.aggregate
      ? `Mean ${formatScore(only.aggregate.mean)}`
      : 'Not scored';
  } else if (testCase.comparison.outcome === 'tie') {
    caseVerdict = 'Tie';
  } else if (testCase.comparison.outcome === 'winner') {
    caseVerdict = `Prompt ${testCase.comparison.winnerId} higher`;
  }

  const cols = testCase.prompts
    .map((prompt) => {
      const isWinner = multi && testCase.comparison.winnerId === prompt.id;
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

  const meanLine = multi && (meanA != null || meanB != null)
    ? ` · A ${meanA ?? '—'} / B ${meanB ?? '—'}`
    : '';

  return `
    <section class="eval-case-result">
      <header class="eval-case-result__header">
        <div>
          <h3 class="heading-xsmall">${escapeHtml(testCase.label)}</h3>
          <p class="body-xxsmall eval-case-result__meta">
            ${escapeHtml(testCase.input || '(empty question)')}
          </p>
        </div>
        <p class="body-xsmall eval-case-result__verdict">
          ${escapeHtml(caseVerdict)}${meanLine}
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

  const multi = isMultiPrompt(data);
  const { runs, caseCount } = data.conditions;
  resultsMeta.textContent =
    `${caseCount} case${caseCount === 1 ? '' : 's'} · ${runs} run${runs === 1 ? '' : 's'} each`
    + (multi ? ' · A vs B' : '');

  renderVerdict(data);
  renderOverallCards(data);
  caseResultsEl.innerHTML = data.cases.map((c) => renderCaseBlock(c, multi)).join('');
}

async function runEvaluation() {
  showError('');
  syncCasesFromDom();

  const promptA = promptAEl.value;
  const promptB = promptBEl.value;
  const metricId = metricSelectEl.value;
  const runs = clampRuns(runCountEl.value);
  runCountEl.value = String(runs);

  if (!promptA.trim()) {
    showError(compareMode ? 'Enter Prompt A before comparing.' : 'Enter a prompt before running.');
    return;
  }
  if (compareMode && !promptB.trim()) {
    showError('Enter Prompt B before comparing.');
    return;
  }
  if (cases.length < MIN_CASES) {
    showError('Add at least one test case.');
    return;
  }
  if (cases.every((c) => !c.input.trim() && !c.expectedAnswer.trim())) {
    showError('Fill in at least one case question before running.');
    return;
  }

  const body = {
    promptA,
    cases: cases.map((c, i) => ({
      id: c.id,
      label: `Case ${i + 1}`,
      input: c.input,
      expectedAnswer: c.expectedAnswer,
    })),
    runs,
    metricId,
  };
  if (compareMode) body.promptB = promptB;

  setBusy(true);
  try {
    const res = await fetch('/api/eval/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    renderComparison(data);
    statusText.textContent = 'Done.';
  } catch (err) {
    console.error('[eval] Run failed:', err);
    showError(err?.message || (compareMode ? 'Failed to compare prompts' : 'Failed to run evaluation'));
    statusText.textContent = '';
  } finally {
    setBusy(false);
  }
}

enableCompareBtn.addEventListener('click', () => {
  compareMode = true;
  if (!promptBEl.value.trim()) {
    promptBEl.value = DEFAULT_PROMPT_B;
  }
  syncCompareModeUi();
});

disableCompareBtn.addEventListener('click', () => {
  compareMode = false;
  syncCompareModeUi();
});

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
  void runEvaluation();
});

runCountEl.addEventListener('change', () => {
  runCountEl.value = String(clampRuns(runCountEl.value));
});

if (!promptAEl.value) {
  promptAEl.value = DEFAULT_PROMPT_A;
}

cases = [
  { id: newCaseId(), input: 'France', expectedAnswer: 'Paris' },
];
renderCases();
syncCompareModeUi();
