/**
 * Prompt Evaluation Simulator – client.
 * Single-prompt first; optional A vs B compare. Cases append under prompts.
 */

import { isRenderableResult, normalizeEvalSession } from '../lib/eval-session.js';
import { formatDuration } from '../lib/format-duration.js';
import {
  EXAMPLES_PLACEHOLDER,
  findPromptPlaceholders,
  renderPromptTemplate,
} from '../lib/prompt-render.js';
import { collectPromptScoresByCase } from '../lib/score-distribution.js';
import { enqueueSessionsWrite } from '../lib/sessions-file.js';
import {
  DEFAULT_PROMPT_TEMPLATING,
  FALLBACK_DEFAULTS,
  findAllowedModel,
  normalizeSessionConfig,
} from '../lib/session-config.js';

const promptAEl = document.getElementById('promptA');
const promptBEl = document.getElementById('promptB');
const promptBWrap = document.getElementById('promptBWrap');
const promptGrid = document.getElementById('promptGrid');
const promptALabel = document.getElementById('promptALabel');
const promptBLabel = document.getElementById('promptBLabel');
const strictTemplateEditor = document.getElementById('strictTemplateEditor');
const strictTemplateParts = document.getElementById('strictTemplateParts');
const strictTemplateAdd = document.getElementById('strictTemplateAdd');
const strictTemplateAddButtons = document.getElementById('strictTemplateAddButtons');
const promptBuilder = document.getElementById('promptBuilder');
const instructionInput = document.getElementById('instructionInput');
const builderComponents = document.getElementById('builderComponents');
const addComponentButtons = document.getElementById('addComponentButtons');
const templateTools = document.getElementById('templateTools');
const examplesDetails = document.getElementById('examplesDetails');
const examplesHint = document.getElementById('examplesHint');
const examplesSummaryMeta = document.getElementById('examplesSummaryMeta');
const examplesListEl = document.getElementById('examplesList');
const addExampleBtn = document.getElementById('addExampleBtn');
const removeExamplesComponentBtn = document.getElementById('removeExamplesComponentBtn');
const templatePreviewDetails = document.getElementById('templatePreviewDetails');
const previewPromptWrap = document.getElementById('previewPromptWrap');
const previewPromptSelect = document.getElementById('previewPromptSelect');
const previewCaseSelect = document.getElementById('previewCaseSelect');
const previewWarning = document.getElementById('previewWarning');
const templatePreview = document.getElementById('templatePreview');
const setupHeading = document.getElementById('setupHeading');
const headerLede = document.getElementById('headerLede');
const resultsEmptyCopy = document.getElementById('resultsEmptyCopy');
const compareToggleRow = document.getElementById('compareToggleRow');
const enableCompareBtn = document.getElementById('enableCompareBtn');
const disableCompareBtn = document.getElementById('disableCompareBtn');
const casesListEl = document.getElementById('casesList');
const casesSummaryMeta = document.getElementById('casesSummaryMeta');
const casesHeading = document.getElementById('casesHeading');
const casesHint = document.getElementById('casesHint');
const addCaseBtn = document.getElementById('addCaseBtn');
const metricSelectEl = document.getElementById('metricSelect');
const llmJudgeHelp = document.getElementById('llmJudgeHelp');
const llmJudgeHelpNote = document.getElementById('llmJudgeHelpNote');
const regexMatchHelp = document.getElementById('regexMatchHelp');
const validJsonHelp = document.getElementById('validJsonHelp');
const modelSelectWrap = document.getElementById('modelSelectWrap');
const modelSelectEl = document.getElementById('modelSelect');
const runCountEl = document.getElementById('runCount');
const runCountLabel = document.getElementById('runCountLabel');
const runBtn = document.getElementById('runBtn');
const statusText = document.getElementById('statusText');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const errorText = document.getElementById('errorText');
const resultsEmpty = document.getElementById('resultsEmpty');
const resultsMeta = document.getElementById('resultsMeta');
const comparisonBody = document.getElementById('comparisonBody');
const verdictBanner = document.getElementById('verdictBanner');
const overallGrid = document.getElementById('overallGrid');
const caseResultsEl = document.getElementById('caseResults');
const caseDetailsPanel = document.getElementById('caseDetailsPanel');
const caseDetailsTitle = document.getElementById('caseDetailsTitle');

let MIN_RUNS = FALLBACK_DEFAULTS.minRuns;
let MAX_RUNS = FALLBACK_DEFAULTS.maxRuns;
let MIN_CASES = FALLBACK_DEFAULTS.minCases;
let MAX_CASES = FALLBACK_DEFAULTS.maxCases;
let ALLOW_USER_MODEL_SELECTION = false;
let ALLOW_COMPARE = false;
let CONFIG_MODEL = '';
let ALLOWED_MODELS = [];
let ALLOWED_METRIC_IDS = [];
let LLM_JUDGE_MODEL = '';
let PROMPT_TEMPLATING = { ...DEFAULT_PROMPT_TEMPLATING };

const COMPONENT_META = {
  context: {
    label: 'Context',
    hint: 'What background information does the model need?',
    placeholder: 'Add relevant background information…',
  },
  examples: {
    label: 'Examples',
    hint: 'Show the model sample inputs and ideal outputs.',
  },
  constraints: {
    label: 'Constraints',
    hint: 'What rules or limits should the response follow?',
    placeholder: 'Add rules the response must follow…',
  },
  outputFormat: {
    label: 'Output format',
    hint: 'How should the answer be structured?',
    placeholder: 'Describe the required response format…',
  },
};

function isBuilderMode() {
  return PROMPT_TEMPLATING.enabled && PROMPT_TEMPLATING.builder?.enabled;
}

function isStrictTemplateMode() {
  return PROMPT_TEMPLATING.enabled && PROMPT_TEMPLATING.strictFields;
}

function maxVisibleInputs() {
  return isBuilderMode() && !PROMPT_TEMPLATING.builder.allowMultipleInputs ? 1 : MAX_CASES;
}

function defaultTemplateFieldLabel(name) {
  return name
    .replace(/_/gu, ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function activeTemplateFields() {
  if (!PROMPT_TEMPLATING.enabled) return [];
  if (!PROMPT_TEMPLATING.dynamicFields) return PROMPT_TEMPLATING.fields;
  const templates = [promptAEl.value, ...(session.compareMode ? [promptBEl.value] : [])];
  const names = [...new Set(templates.flatMap(findPromptPlaceholders))]
    .filter((name) => (
      !['examples', '__proto__', 'prototype', 'constructor'].includes(name)
    ));
  return names.map((name) => {
    const configured = PROMPT_TEMPLATING.fields.find((field) => field.name === name);
    return configured ?? {
      name,
      label: defaultTemplateFieldLabel(name),
      multiline: true,
    };
  });
}

function fieldPromptUsageNote(fieldName) {
  if (!session.compareMode || !PROMPT_TEMPLATING.dynamicFields) return '';
  const inA = findPromptPlaceholders(promptAEl.value).includes(fieldName);
  const inB = findPromptPlaceholders(promptBEl.value).includes(fieldName);
  if (inA && inB) return '';
  if (inA) return 'A only';
  if (inB) return 'B only';
  return '';
}

function parseTemplateParts(template) {
  const parts = [];
  const source = String(template ?? '');
  const placeholderPattern = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/gu;
  let cursor = 0;
  for (const match of source.matchAll(placeholderPattern)) {
    parts.push({ type: 'text', value: source.slice(cursor, match.index) });
    parts.push({ type: 'field', name: match[1] });
    cursor = match.index + match[0].length;
  }
  parts.push({ type: 'text', value: source.slice(cursor) });
  return parts;
}

function syncStrictTemplateFromDom() {
  if (!isStrictTemplateMode()) return;
  const template = [...strictTemplateParts.children]
    .map((part) => (
      part.dataset.templatePart === 'field'
        ? `{{${part.dataset.fieldName}}}`
        : part.innerText
    ))
    .join('');
  promptAEl.value = template;
  session.promptA = template;
}

function renderStrictTemplateEditor() {
  if (!isStrictTemplateMode()) return;
  const fragment = document.createDocumentFragment();
  for (const part of parseTemplateParts(promptAEl.value)) {
    if (part.type === 'text') {
      const text = document.createElement('div');
      text.className = 'eval-strict-template__text';
      text.dataset.templatePart = 'text';
      text.contentEditable = 'true';
      text.setAttribute('role', 'textbox');
      text.setAttribute('aria-label', 'Prompt text');
      text.spellcheck = false;
      text.textContent = part.value;
      fragment.append(text);
      continue;
    }
    const configured = PROMPT_TEMPLATING.fields.find((field) => field.name === part.name);
    const token = document.createElement('div');
    token.className = 'eval-template-token';
    token.dataset.templatePart = 'field';
    token.dataset.fieldName = part.name;
    const label = document.createElement('span');
    label.className = 'body-xsmall';
    const friendlyLabel = configured?.label ?? defaultTemplateFieldLabel(part.name);
    label.textContent = `{{${part.name}}}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-tertiary eval-template-token__remove';
    remove.dataset.removeTemplateField = part.name;
    remove.setAttribute('aria-label', `Remove ${friendlyLabel} field`);
    remove.textContent = 'Remove';
    token.append(label, remove);
    fragment.append(token);
  }
  strictTemplateParts.replaceChildren(fragment);

  const activeNames = new Set(findPromptPlaceholders(promptAEl.value));
  strictTemplateAddButtons.innerHTML = PROMPT_TEMPLATING.fields
    .filter((field) => !activeNames.has(field.name))
    .map((field) => `
      <button type="button" class="button button-secondary" data-add-template-field="${escapeHtml(field.name)}">
        + ${escapeHtml(field.label)}
      </button>
    `)
    .join('');
  strictTemplateAdd.hidden = strictTemplateAddButtons.children.length === 0;
}

/** @type {ReturnType<typeof normalizeEvalSession>} */
let session = normalizeEvalSession({});
let persistEnabled = false;
let saveTimer = null;
const SAVE_DEBOUNCE_MS = 300;
const persistWrite = { chain: Promise.resolve() };

function sessionLimits() {
  return {
    minRuns: MIN_RUNS,
    maxRuns: MAX_RUNS,
    maxCases: MAX_CASES,
    allowedMetricIds: ALLOWED_METRIC_IDS,
    promptTemplating: PROMPT_TEMPLATING,
  };
}

function clampRuns(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  const fallback = Math.min(MAX_RUNS, Math.max(MIN_RUNS, 2));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_RUNS, Math.max(MIN_RUNS, n));
}

function newCaseId() {
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function newExampleId() {
  return `example-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function updateCasesSummary() {
  const n = session.cases.length;
  casesSummaryMeta.textContent = isBuilderMode()
    ? `${n} input${n === 1 ? '' : 's'}`
    : `${n} case${n === 1 ? '' : 's'}`;
}

function syncCompareModeUi() {
  if (!ALLOW_COMPARE || isBuilderMode()) {
    session.compareMode = false;
  }
  compareToggleRow.hidden = !ALLOW_COMPARE || isBuilderMode();
  promptBWrap.hidden = !session.compareMode;
  enableCompareBtn.hidden = !ALLOW_COMPARE || session.compareMode;
  disableCompareBtn.hidden = !ALLOW_COMPARE || !session.compareMode;
  promptGrid.classList.toggle('eval-prompt-grid--single', !session.compareMode);
  promptGrid.classList.toggle('eval-prompt-grid--compare', session.compareMode);

  setupHeading.textContent = isBuilderMode()
    ? 'Build your prompt'
    : PROMPT_TEMPLATING.enabled
    ? (session.compareMode ? 'Prompt templates' : 'Prompt template')
    : (session.compareMode ? 'Prompts' : 'Prompt');
  promptALabel.textContent = PROMPT_TEMPLATING.enabled
    ? (session.compareMode
      ? `Prompt template A${PROMPT_TEMPLATING.templateEditable ? '' : ' (provided)'}`
      : `Prompt template${PROMPT_TEMPLATING.templateEditable ? '' : ' (provided)'}`)
    : (session.compareMode ? 'Prompt A' : 'Prompt');
  promptBLabel.textContent = PROMPT_TEMPLATING.enabled
    ? `Prompt template B${PROMPT_TEMPLATING.templateEditable ? '' : ' (provided)'}`
    : 'Prompt B';
  runBtn.textContent = isBuilderMode()
    ? 'Run prompt'
    : (session.compareMode ? 'Compare prompts' : 'Run evaluation');

  headerLede.textContent = isBuilderMode()
    ? 'Build a prompt from reusable components, try it with an input, and inspect exactly what the model receives.'
    : PROMPT_TEMPLATING.dynamicFields
      ? 'Write a reusable prompt template. Every placeholder becomes a field that can vary across cases.'
    : PROMPT_TEMPLATING.enabled
    ? (session.compareMode
      ? 'Compare two reusable templates. Every case fills the same blanks so the comparison stays fair.'
      : 'Write reusable instructions with blanks, fill them from each case, and preview the exact prompt sent to the model.')
    : (session.compareMode
      ? 'Compare two prompt versions. Each test question is appended under both prompts so the comparison is fair.'
      : 'Run a prompt across test cases. Each question is appended under your prompt and scored the same way every run.');

  resultsEmptyCopy.textContent = isBuilderMode()
    ? 'Run your prompt to see the model response and optional score.'
    : session.compareMode
    ? 'Run a comparison to see which prompt scores higher — then open details if you want to inspect cases and runs.'
    : 'Run an evaluation to see scores across cases — then open details if you want to inspect individual runs.';
  updateTemplatePreview();
}

function setBusy(busy) {
  runBtn.disabled = busy;
  addCaseBtn.disabled = busy || session.cases.length >= maxVisibleInputs();
  enableCompareBtn.disabled = busy;
  disableCompareBtn.disabled = busy;
  const templateLocked = PROMPT_TEMPLATING.enabled && !PROMPT_TEMPLATING.templateEditable;
  promptAEl.readOnly = busy || templateLocked;
  promptBEl.readOnly = busy || templateLocked;
  strictTemplateParts.querySelectorAll('[contenteditable]').forEach((el) => {
    el.contentEditable = busy ? 'false' : 'true';
  });
  strictTemplateEditor.querySelectorAll('button').forEach((el) => {
    el.disabled = busy;
  });
  instructionInput.readOnly = busy;
  builderComponents.querySelectorAll('textarea').forEach((el) => {
    el.readOnly = busy;
  });
  builderComponents.querySelectorAll('button').forEach((el) => {
    el.disabled = busy;
  });
  addComponentButtons.querySelectorAll('button').forEach((el) => {
    el.disabled = busy;
  });
  metricSelectEl.disabled = busy;
  modelSelectEl.disabled = busy || !ALLOW_USER_MODEL_SELECTION;
  runCountEl.readOnly = busy;
  casesListEl.querySelectorAll('textarea, button').forEach((el) => {
    if (el.tagName === 'TEXTAREA') el.readOnly = busy;
    else {
      el.disabled = busy
        || (el.classList.contains('eval-case__remove') && session.cases.length <= MIN_CASES);
    }
  });
  templateTools.querySelectorAll('textarea, select, button').forEach((el) => {
    if (el === previewPromptSelect || el === previewCaseSelect) {
      el.disabled = false;
    } else if (el.tagName === 'TEXTAREA') {
      el.readOnly = busy;
    } else {
      el.disabled = busy;
    }
  });
  if (!busy && PROMPT_TEMPLATING.allowExamples) {
    addExampleBtn.disabled = (session.examples?.length ?? 0) >= 5;
  }
  if (busy) {
    setProgress({
      message: session.compareMode
        ? 'Comparing prompts…'
        : 'Running evaluation…',
      completed: 0,
      total: 0,
    });
  } else if (!statusText.textContent) {
    clearProgress();
  }
}

/**
 * @param {{ message?: string, completed?: number, total?: number }} progress
 */
function setProgress(progress) {
  if (progressWrap) progressWrap.hidden = false;
  if (typeof progress.message === 'string') {
    statusText.textContent = progress.message;
  }
  const done = statusText.textContent === 'Done.';
  statusText.classList.toggle('eval-status--done', done);
  if (progressWrap) progressWrap.classList.toggle('eval-progress--done', done);
  const total = Number(progress.total);
  const completed = Number(progress.completed);
  const percent = Number.isFinite(total) && total > 0 && Number.isFinite(completed)
    ? Math.min(100, Math.round((completed / total) * 100))
    : 0;
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (progressBar) progressBar.setAttribute('aria-valuenow', String(percent));
}

function clearProgress() {
  if (progressWrap) {
    progressWrap.hidden = true;
    progressWrap.classList.remove('eval-progress--done');
  }
  statusText.textContent = '';
  statusText.classList.remove('eval-status--done');
  if (progressFill) progressFill.style.width = '0%';
  if (progressBar) progressBar.setAttribute('aria-valuenow', '0');
}

/**
 * POST /api/eval/compare with SSE progress events (JSON fallback).
 * @param {object} body
 * @returns {Promise<object>}
 */
async function fetchEvalComparison(body) {
  const res = await fetch('api/eval/compare', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  /** @type {object | null} */
  let finalResult = null;
  /** @type {string | null} */
  let streamError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let eventName = 'message';
      const dataLines = [];
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      let payload;
      try {
        payload = JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }
      if (eventName === 'progress') {
        setProgress({
          message: payload.message,
          completed: payload.completed,
          total: payload.total,
        });
      } else if (eventName === 'result') {
        finalResult = payload;
      } else if (eventName === 'error') {
        streamError = payload.error || 'Failed to compare prompts';
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!finalResult) throw new Error('Evaluation ended without a result');
  return finalResult;
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

function buildStructuredPrompt(components) {
  const active = new Set(components?.active ?? []);
  const parts = [];
  if (components?.instruction?.trim()) parts.push(components.instruction.trim());
  if (active.has('context') && components.context.trim()) {
    parts.push(`Context:\n${components.context.trim()}`);
  }
  if (active.has('examples')) parts.push(`Examples:\n${EXAMPLES_PLACEHOLDER}`);
  if (active.has('constraints') && components.constraints.trim()) {
    parts.push(`Constraints:\n${components.constraints.trim()}`);
  }
  if (active.has('outputFormat') && components.outputFormat.trim()) {
    parts.push(`Output format:\n${components.outputFormat.trim()}`);
  }
  parts.push('Input:\n{{input}}');
  return parts.join('\n\n');
}

function syncBuilderFromDom() {
  if (!isBuilderMode()) return;
  session.promptComponents ??= {
    active: [],
    instruction: '',
    context: '',
    constraints: '',
    outputFormat: '',
  };
  session.promptComponents.instruction = instructionInput.value;
  for (const id of ['context', 'constraints', 'outputFormat']) {
    const input = builderComponents.querySelector(`[data-component-input="${id}"]`);
    if (input) session.promptComponents[id] = input.value;
  }
  session.promptA = buildStructuredPrompt(session.promptComponents);
  promptAEl.value = session.promptA;
}

function renderBuilder() {
  if (!isBuilderMode()) return;
  const components = session.promptComponents ?? {
    active: [],
    instruction: '',
    context: '',
    constraints: '',
    outputFormat: '',
  };
  const active = new Set(components.active);
  instructionInput.value = components.instruction;
  builderComponents.innerHTML = PROMPT_TEMPLATING.builder.availableComponents
    .filter((id) => id !== 'examples' && active.has(id))
    .map((id) => {
      const meta = COMPONENT_META[id];
      return `
        <article class="eval-component-card" data-component="${id}">
          <div class="eval-component-card__header">
            <div>
              <h3 class="body-xsmall eval-component-card__title">${escapeHtml(meta.label)}</h3>
              <p class="body-xxsmall eval-component-card__hint">${escapeHtml(meta.hint)}</p>
            </div>
            <button type="button" class="button button-tertiary" data-remove-component="${id}">Remove</button>
          </div>
          <textarea
            class="input"
            data-component-input="${id}"
            rows="3"
            placeholder="${escapeHtml(meta.placeholder)}"
            spellcheck="false"
          >${escapeHtml(components[id])}</textarea>
        </article>
      `;
    })
    .join('');

  addComponentButtons.innerHTML = PROMPT_TEMPLATING.builder.availableComponents
    .filter((id) => !active.has(id))
    .map((id) => `
      <button type="button" class="button button-secondary" data-add-component="${id}">
        + ${escapeHtml(COMPONENT_META[id].label)}
      </button>
    `)
    .join('');
  document.getElementById('addComponents').hidden = addComponentButtons.children.length === 0;
  syncBuilderFromDom();
}

function syncCasesFromDom() {
  const cards = [...casesListEl.querySelectorAll('.eval-case')];
  session.cases = cards.map((card) => {
    const previous = session.cases.find((testCase) => testCase.id === card.dataset.caseId);
    return {
      id: card.dataset.caseId,
      input: PROMPT_TEMPLATING.enabled && !isBuilderMode()
        ? (card.querySelector('[data-template-field="input"]')?.value ?? previous?.input ?? '')
        : (card.querySelector('[data-field="input"]')?.value ?? ''),
      expectedAnswer: card.querySelector('[data-field="expected"]')?.value
        ?? previous?.expectedAnswer
        ?? '',
      ...(PROMPT_TEMPLATING.enabled && !isBuilderMode()
        ? {
          variables: Object.fromEntries(activeTemplateFields()
            .filter((field) => field.name !== 'input')
            .map((field) => [
            field.name,
            card.querySelector(`[data-variable="${CSS.escape(field.name)}"]`)?.value
              ?? previous?.variables?.[field.name]
              ?? '',
          ])),
        }
        : {}),
    };
  });
  updateCasesSummary();
}

function renderCases() {
  const openPreviews = new Set(
    [...casesListEl.querySelectorAll('.eval-case-prompt-preview[open]')]
      .map((el) => el.closest('.eval-case')?.dataset.caseId)
      .filter(Boolean),
  );
  const hadPreviews = casesListEl.querySelectorAll('.eval-case-prompt-preview').length > 0;
  casesListEl.innerHTML = session.cases
    .map((c, index) => {
      const templateFieldsHtml = PROMPT_TEMPLATING.enabled && !isBuilderMode()
        ? `
          <div class="eval-case__variables">
            ${activeTemplateFields().map((field) => {
              const value = field.name === 'input'
                ? c.input
                : (c.variables?.[field.name] ?? '');
              const usageNote = fieldPromptUsageNote(field.name);
              return `
              <label class="eval-field">
                <span class="body-xxsmall eval-field__label">
                  ${escapeHtml(field.label)}
                  ${usageNote
                    ? `<span class="eval-field__usage">${escapeHtml(usageNote)}</span>`
                    : ''}
                </span>
                <textarea
                  class="input"
                  ${field.name === 'input'
                    ? 'data-template-field="input"'
                    : `data-variable="${escapeHtml(field.name)}"`}
                  rows="${field.multiline ? '2' : '1'}"
                  spellcheck="false"
                >${escapeHtml(value)}</textarea>
              </label>
            `;
            }).join('')}
          </div>
        `
        : '';
      const legacyInputHtml = PROMPT_TEMPLATING.enabled && !isBuilderMode()
        ? ''
        : `
          <label class="eval-field">
            <span class="body-xxsmall eval-field__label">${isBuilderMode() ? 'Input' : 'Question'}</span>
            <textarea class="input" data-field="input" rows="2" spellcheck="false">${escapeHtml(c.input)}</textarea>
          </label>
        `;
      const expectedHtml = !isBuilderMode() || PROMPT_TEMPLATING.builder.showExpectedAnswer
        ? `
          <label class="eval-field">
            <span class="body-xxsmall eval-field__label">${PROMPT_TEMPLATING.dynamicFields
              ? 'Expected output'
              : `Expected ${isBuilderMode() ? 'result' : 'answer'}`} <span class="eval-optional">(optional)</span></span>
            <textarea class="input" data-field="expected" rows="2" spellcheck="false">${escapeHtml(c.expectedAnswer)}</textarea>
          </label>
        `
        : '';
      const previewOpen = !hadPreviews || openPreviews.has(c.id);
      const casePreviewHtml = PROMPT_TEMPLATING.dynamicFields && PROMPT_TEMPLATING.showPreview
        ? (
          session.compareMode
            ? `
          <details class="eval-case-prompt-preview"${previewOpen ? ' open' : ''}>
            <summary class="eval-case-prompt-preview__summary">
              <span class="eval-case-prompt-preview__heading">
                <span class="body-xsmall eval-case-prompt-preview__title">Full prompts for this case</span>
                <span class="body-xxsmall eval-case-prompt-preview__hint">Exact text sent for Prompt A and Prompt B</span>
              </span>
            </summary>
            <p class="body-xxsmall eval-case-prompt-preview__prompt-label">Prompt A</p>
            <pre class="eval-template-preview body-small" data-case-prompt-preview="A"></pre>
            <p class="body-xxsmall eval-case-prompt-preview__prompt-label">Prompt B</p>
            <pre class="eval-template-preview body-small" data-case-prompt-preview="B"></pre>
          </details>
        `
            : `
          <details class="eval-case-prompt-preview"${previewOpen ? ' open' : ''}>
            <summary class="eval-case-prompt-preview__summary">
              <span class="eval-case-prompt-preview__heading">
                <span class="body-xsmall eval-case-prompt-preview__title">Full prompt for this case</span>
                <span class="body-xxsmall eval-case-prompt-preview__hint">Exact text sent to the model</span>
              </span>
            </summary>
            <pre class="eval-template-preview body-small" data-case-prompt-preview="A"></pre>
          </details>
        `
        )
        : '';
      return `
      <article class="eval-case" data-case-id="${escapeHtml(c.id)}">
        <div class="eval-case__header">
          <h4 class="body-xsmall eval-case__title">${isBuilderMode() ? `Input ${index + 1}` : `Case ${index + 1}`}</h4>
          <button
            type="button"
            class="button button-tertiary eval-case__remove"
            data-remove="${escapeHtml(c.id)}"
            ${session.cases.length <= MIN_CASES ? 'disabled' : ''}
          >Remove</button>
        </div>
        ${legacyInputHtml}
        ${templateFieldsHtml}
        ${casePreviewHtml}
        ${expectedHtml}
      </article>
    `;
    })
    .join('');

  addCaseBtn.disabled = session.cases.length >= maxVisibleInputs();
  updateCasesSummary();
  updateTemplatePreview();
}

function syncExamplesFromDom() {
  if (!PROMPT_TEMPLATING.allowExamples) return;
  session.examples = [...examplesListEl.querySelectorAll('.eval-example')].map((card) => ({
    id: card.dataset.exampleId,
    input: card.querySelector('[data-example-field="input"]')?.value ?? '',
    idealOutput: card.querySelector('[data-example-field="output"]')?.value ?? '',
  }));
  examplesSummaryMeta.textContent = `${session.examples.length} example${session.examples.length === 1 ? '' : 's'}`;
}

function renderExamples() {
  if (!PROMPT_TEMPLATING.allowExamples) return;
  const examples = session.examples ?? [];
  examplesListEl.innerHTML = examples.map((example, index) => `
    <article class="eval-example" data-example-id="${escapeHtml(example.id)}">
      <div class="eval-example__header">
        <h4 class="body-xsmall eval-example__title">Example ${index + 1}</h4>
        <button
          type="button"
          class="button button-tertiary"
          data-remove-example="${escapeHtml(example.id)}"
        >Remove</button>
      </div>
      <label class="eval-field">
        <span class="body-xxsmall eval-field__label">Example input</span>
        <textarea class="input" data-example-field="input" rows="2" spellcheck="false">${escapeHtml(example.input)}</textarea>
      </label>
      <label class="eval-field">
        <span class="body-xxsmall eval-field__label">Ideal output</span>
        <textarea class="input" data-example-field="output" rows="2" spellcheck="false">${escapeHtml(example.idealOutput)}</textarea>
      </label>
    </article>
  `).join('');
  examplesSummaryMeta.textContent = `${examples.length} example${examples.length === 1 ? '' : 's'}`;
  addExampleBtn.disabled = examples.length >= 5;
  updateTemplatePreview();
}

function configureTemplateTools() {
  templateTools.hidden = !PROMPT_TEMPLATING.enabled
    || (PROMPT_TEMPLATING.dynamicFields && !PROMPT_TEMPLATING.allowExamples);
  if (!PROMPT_TEMPLATING.enabled) return;

  const examplesActive = !isBuilderMode()
    || session.promptComponents?.active?.includes('examples');
  examplesHint.textContent = isBuilderMode()
    ? 'Add sample inputs and ideal outputs to demonstrate the behavior you want.'
    : 'Add sample inputs and ideal outputs, then place them in the prompt with {{examples}}.';
  examplesDetails.hidden = !PROMPT_TEMPLATING.allowExamples || !examplesActive;
  removeExamplesComponentBtn.hidden = !isBuilderMode();
  templatePreviewDetails.hidden = !PROMPT_TEMPLATING.showPreview
    || PROMPT_TEMPLATING.dynamicFields;
  renderExamples();
}

function updatePreviewSelectors() {
  if (!PROMPT_TEMPLATING.enabled || !PROMPT_TEMPLATING.showPreview) return;
  const previousCase = previewCaseSelect.value;
  previewCaseSelect.replaceChildren(...session.cases.map((_, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = isBuilderMode() ? `Input ${index + 1}` : `Case ${index + 1}`;
    return option;
  }));
  if ([...previewCaseSelect.options].some((option) => option.value === previousCase)) {
    previewCaseSelect.value = previousCase;
  }
  previewPromptWrap.hidden = !session.compareMode;
  if (!session.compareMode) previewPromptSelect.value = 'A';
}

function updateTemplatePreview() {
  updateInlineCasePreviews();
  if (!PROMPT_TEMPLATING.enabled || !PROMPT_TEMPLATING.showPreview) return;
  updatePreviewSelectors();
  const caseIndex = Number.parseInt(previewCaseSelect.value || '0', 10);
  const testCase = session.cases[caseIndex] ?? session.cases[0];
  const template = previewPromptSelect.value === 'B' && session.compareMode
    ? promptBEl.value
    : promptAEl.value;
  if (!testCase) {
    templatePreview.textContent = isBuilderMode()
      ? 'Add an input to preview the rendered prompt.'
      : 'Add a test case to preview the filled-in prompt.';
    previewWarning.hidden = true;
    return;
  }

  const examples = PROMPT_TEMPLATING.allowExamples ? (session.examples ?? []) : [];
  const placeholders = findPromptPlaceholders(template);
  const known = new Set([
    'input',
    'examples',
    ...(PROMPT_TEMPLATING.dynamicFields
      ? activeTemplateFields().map((field) => field.name)
      : PROMPT_TEMPLATING.variableNames),
  ]);
  const unknown = placeholders.filter((name) => !known.has(name));
  const missingExamplesSlot = examples.length > 0 && !template.includes(EXAMPLES_PLACEHOLDER);
  const warnings = [
    ...(unknown.length > 0
      ? [`Missing case values for ${unknown.map((name) => `{{${name}}}`).join(', ')}.`]
      : []),
    ...(missingExamplesSlot && !isBuilderMode()
      ? ['Add {{examples}} to the prompt to include the shared examples.']
      : []),
  ];
  previewWarning.textContent = warnings.join(' ');
  previewWarning.hidden = warnings.length === 0;
  templatePreview.textContent = renderPromptTemplate(template, testCase.input, {
    variables: testCase.variables,
    examples,
  }) || '(empty prompt)';
}

function updateInlineCasePreviews() {
  if (!PROMPT_TEMPLATING.dynamicFields || !PROMPT_TEMPLATING.showPreview) return;
  const examples = PROMPT_TEMPLATING.allowExamples ? (session.examples ?? []) : [];
  [...casesListEl.querySelectorAll('.eval-case')].forEach((card, index) => {
    const previewA = card.querySelector('[data-case-prompt-preview="A"]')
      ?? card.querySelector('[data-case-prompt-preview]');
    const previewB = card.querySelector('[data-case-prompt-preview="B"]');
    const testCase = session.cases[index];
    if (!testCase) return;
    if (previewA) {
      previewA.textContent = renderPromptTemplate(promptAEl.value, testCase.input, {
        variables: testCase.variables,
        examples,
      }) || '(empty prompt)';
    }
    if (previewB) {
      previewB.textContent = renderPromptTemplate(promptBEl.value, testCase.input, {
        variables: testCase.variables,
        examples,
      }) || '(empty prompt)';
    }
  });
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
  const caseNote = isBuilderMode()
    ? `${conditions.caseCount} input${conditions.caseCount === 1 ? '' : 's'}`
    : `${conditions.caseCount} case${conditions.caseCount === 1 ? '' : 's'}`;
  const hasScores = prompts.some((p) => p.aggregate);

  if (!multi) {
    verdictBanner.className = 'eval-verdict eval-verdict--neutral';
    if (!hasScores) {
      verdictBanner.innerHTML = `
        <p class="body-small eval-verdict__title"><strong>Not scored yet</strong></p>
        <p class="body-xxsmall eval-verdict__detail">
          Add expected ${isBuilderMode() ? 'results' : 'answers to your test cases'} to see mean scores across ${caseNote}.
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
        Add expected ${isBuilderMode() ? 'results' : 'answers to your test cases'} to compare mean scores across ${caseNote}.
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
          <p class="eval-summary-card__score">
            <span class="heading-small eval-summary-card__mean">
              ${prompt.aggregate ? mean : '—'}
            </span>
            <span class="body-xxsmall eval-summary-card__caption">
              ${prompt.aggregate ? 'overall mean' : 'not scored'}
              ${isWinner ? ' · higher' : ''}
            </span>
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
  const {
    runs,
    caseCount,
    durationMs,
    judgeModel,
  } = data.conditions;
  const duration = formatDuration(durationMs);
  resultsMeta.textContent = [
    isBuilderMode()
      ? `${caseCount} input${caseCount === 1 ? '' : 's'}`
      : `${caseCount} case${caseCount === 1 ? '' : 's'}`,
    `${runs} run${runs === 1 ? '' : 's'} each`,
    duration,
    multi ? 'A vs B' : '',
    judgeModel ? `Judge: ${judgeModel}` : '',
  ].filter(Boolean).join(' · ');

  renderVerdict(data);
  renderOverallCards(data);
  caseResultsEl.innerHTML = data.cases.map((c) => renderCaseBlock(c, multi)).join('');
}

async function runEvaluation() {
  showError('');
  pullSessionFromDom();

  const {
    model,
    promptA,
    promptB,
    compareMode,
    cases,
    metricId,
    runs,
  } = session;
  runCountEl.value = String(runs);

  if (!promptA.trim()) {
    showError(isBuilderMode()
      ? 'Add an instruction before running the prompt.'
      : (compareMode ? 'Enter Prompt A before comparing.' : 'Enter a prompt before running.'));
    return;
  }
  if (compareMode && !promptB.trim()) {
    showError('Enter Prompt B before comparing.');
    return;
  }
  if (cases.length < MIN_CASES) {
    showError(isBuilderMode() ? 'Add at least one input.' : 'Add at least one test case.');
    return;
  }
  if (cases.every((c) => (
    !c.input.trim()
    && !c.expectedAnswer.trim()
    && !Object.values(c.variables ?? {}).some((value) => value.trim())
  ))) {
    showError(isBuilderMode()
      ? 'Fill in at least one input before running.'
      : 'Fill in at least one case question before running.');
    return;
  }

  const body = {
    model,
    promptA,
    cases: cases.map((c, i) => ({
      id: c.id,
      label: isBuilderMode() ? `Input ${i + 1}` : `Case ${i + 1}`,
      input: c.input,
      expectedAnswer: c.expectedAnswer,
      ...(PROMPT_TEMPLATING.enabled ? { variables: c.variables } : {}),
    })),
    runs,
    metricId,
    ...(PROMPT_TEMPLATING.allowExamples
      && (!isBuilderMode() || session.promptComponents?.active?.includes('examples'))
      ? { examples: session.examples ?? [] }
      : {}),
  };
  if (compareMode) body.promptB = promptB;

  setBusy(true);
  try {
    const data = await fetchEvalComparison(body);
    session.lastResult = data;
    renderComparison(data);
    persistSessionNow();
    setProgress({
      message: 'Done.',
      completed: 1,
      total: 1,
    });
  } catch (err) {
    console.error('[eval] Run failed:', err);
    showError(err?.message || (compareMode ? 'Failed to compare prompts' : 'Failed to run evaluation'));
    clearProgress();
  } finally {
    setBusy(false);
  }
}

function applyDefaults(defaults) {
  MIN_RUNS = defaults.minRuns;
  MAX_RUNS = defaults.maxRuns;
  MIN_CASES = defaults.minCases;
  MAX_CASES = defaults.maxCases;
  runCountEl.min = String(MIN_RUNS);
  runCountEl.max = String(MAX_RUNS);
  runCountEl.value = String(clampRuns(defaults.runs));
  if (runCountLabel) {
    runCountLabel.textContent = `Runs each (${MIN_RUNS}–${MAX_RUNS})`;
  }
}

function updateMetricHelp() {
  const metricId = metricSelectEl.value;
  llmJudgeHelp.hidden = metricId !== 'llm-judge';
  regexMatchHelp.hidden = metricId !== 'regex-match';
  validJsonHelp.hidden = metricId !== 'valid-json';
  if (metricId !== 'llm-judge') return;

  const generationModel = ALLOW_USER_MODEL_SELECTION
    ? modelSelectEl.value
    : CONFIG_MODEL;
  const judgeModel = LLM_JUDGE_MODEL || generationModel;
  llmJudgeHelpNote.textContent = [
    'Expected Answer is required',
    `Judge model: ${judgeModel}`,
    '2 model calls per run',
  ].join(' · ');
}

function configureModelSelection(config) {
  ALLOW_USER_MODEL_SELECTION = config.allowUserModelSelection;
  ALLOW_COMPARE = config.allowCompare === true;
  CONFIG_MODEL = config.model;
  ALLOWED_MODELS = config.allowedModels;
  ALLOWED_METRIC_IDS = config.allowedMetricIds;
  LLM_JUDGE_MODEL = config.llmJudgeModel || '';

  modelSelectEl.replaceChildren(...ALLOWED_MODELS.map((model) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    return option;
  }));
  modelSelectWrap.hidden = !ALLOW_USER_MODEL_SELECTION;
  modelSelectEl.disabled = !ALLOW_USER_MODEL_SELECTION;

  metricSelectEl.querySelectorAll('option').forEach((option) => {
    if (!ALLOWED_METRIC_IDS.includes(option.value)) option.remove();
  });
  if (!ALLOWED_METRIC_IDS.includes(metricSelectEl.value)) {
    metricSelectEl.value = ALLOWED_METRIC_IDS[0];
  }
  updateMetricHelp();
}

function configureFeatures(config) {
  PROMPT_TEMPLATING = config.features?.promptTemplating ?? { ...DEFAULT_PROMPT_TEMPLATING };
  const templateLocked = PROMPT_TEMPLATING.enabled && !PROMPT_TEMPLATING.templateEditable;
  promptBuilder.hidden = !isBuilderMode();
  strictTemplateEditor.hidden = !isStrictTemplateMode();
  promptGrid.hidden = isBuilderMode() || isStrictTemplateMode();
  promptAEl.readOnly = templateLocked;
  promptBEl.readOnly = templateLocked;
  casesHeading.textContent = isBuilderMode() ? 'Try your prompt' : 'Test cases';
  caseDetailsTitle.textContent = isBuilderMode() ? 'Input details' : 'Case details';
  addCaseBtn.textContent = isBuilderMode() ? 'Add another input' : 'Add case';
  addCaseBtn.hidden = isBuilderMode() && !PROMPT_TEMPLATING.builder.allowMultipleInputs;
  casesHint.textContent = isBuilderMode()
    ? 'Enter something for the model to process. The expected result is optional and is used only for scoring.'
    : PROMPT_TEMPLATING.dynamicFields
      ? 'Each placeholder in the prompt has a matching value for this case. Expected output is used only for scoring.'
    : PROMPT_TEMPLATING.enabled
    ? 'Fill the configured case fields below. Their values replace the matching {{blanks}} in the prompt template.'
    : 'Each case has a question (appended under the prompt) and an optional expected answer for scoring.';
  configureTemplateTools();
}

function resolveSessionModel(savedModel) {
  if (!ALLOW_USER_MODEL_SELECTION) return CONFIG_MODEL;
  return findAllowedModel(savedModel, ALLOWED_MODELS)
    ?? findAllowedModel(CONFIG_MODEL, ALLOWED_MODELS)
    ?? CONFIG_MODEL;
}

function pullSessionFromDom() {
  syncStrictTemplateFromDom();
  syncBuilderFromDom();
  syncCasesFromDom();
  syncExamplesFromDom();
  session = normalizeEvalSession({
    ...session,
    model: ALLOW_USER_MODEL_SELECTION ? modelSelectEl.value : CONFIG_MODEL,
    promptA: promptAEl.value,
    promptB: promptBEl.value,
    compareMode: session.compareMode,
    ...(isBuilderMode() ? { promptComponents: session.promptComponents } : {}),
    cases: session.cases,
    ...(PROMPT_TEMPLATING.allowExamples ? { examples: session.examples } : {}),
    metricId: metricSelectEl.value,
    runs: clampRuns(runCountEl.value),
  }, sessionLimits());
  runCountEl.value = String(session.runs);
}

function applySessionToDom() {
  session.model = resolveSessionModel(session.model);
  if (ALLOW_USER_MODEL_SELECTION) {
    modelSelectEl.value = session.model;
  }
  promptAEl.value = session.promptA;
  promptBEl.value = session.promptB;
  if (isStrictTemplateMode()) {
    renderStrictTemplateEditor();
  }
  if (isBuilderMode()) {
    renderBuilder();
    configureTemplateTools();
  }
  if ([...metricSelectEl.options].some((opt) => opt.value === session.metricId)) {
    metricSelectEl.value = session.metricId;
  }
  updateMetricHelp();
  runCountEl.value = String(clampRuns(session.runs));
  renderCases();
  renderExamples();
  syncCompareModeUi();
  updateTemplatePreview();
}

function applyInitialSession(initial) {
  const startInCompare = ALLOW_COMPARE && initial.promptB.trim() !== '';
  session = normalizeEvalSession({
    model: resolveSessionModel(''),
    promptA: initial.promptA,
    promptB: initial.promptB,
    compareMode: startInCompare,
    ...(isBuilderMode() ? { promptComponents: initial.promptComponents } : {}),
    cases: (initial.cases ?? []).map((c) => ({
      id: newCaseId(),
      input: c.input,
      expectedAnswer: c.expectedAnswer,
      ...(PROMPT_TEMPLATING.enabled ? { variables: c.variables } : {}),
    })),
    ...(PROMPT_TEMPLATING.allowExamples
      ? {
        examples: (initial.examples ?? []).map((example) => ({
          id: newExampleId(),
          input: example.input,
          idealOutput: example.idealOutput,
        })),
      }
      : {}),
    metricId: metricSelectEl.value,
    runs: clampRuns(runCountEl.value),
    lastResult: null,
  }, sessionLimits());
}

async function persistSession() {
  if (!persistEnabled) return;
  pullSessionFromDom();
  const snapshot = JSON.parse(JSON.stringify(session));
  try {
    await enqueueSessionsWrite(async () => {
      const res = await fetch('api/eval/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) {
        console.error('[eval] Failed to persist session:', res.status);
      }
    }, persistWrite);
  } catch (err) {
    console.error('[eval] Failed to persist session:', err);
  }
}

function scheduleSave() {
  if (!persistEnabled) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persistSession();
  }, SAVE_DEBOUNCE_MS);
}

function persistSessionNow() {
  if (!persistEnabled) return;
  clearTimeout(saveTimer);
  void persistSession();
}

async function loadSessionConfig() {
  try {
    const res = await fetch('api/session-config');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return normalizeSessionConfig({});
    return normalizeSessionConfig(data);
  } catch {
    return normalizeSessionConfig({});
  }
}

async function loadEvalSession() {
  try {
    const res = await fetch('api/eval/session');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return data.session ?? null;
  } catch {
    return null;
  }
}

async function init() {
  const [config, saved] = await Promise.all([
    loadSessionConfig(),
    loadEvalSession(),
  ]);
  applyDefaults(config.defaults);
  configureFeatures(config);
  configureModelSelection(config);
  if (saved) {
    session = normalizeEvalSession(saved, sessionLimits());
    if (!ALLOW_COMPARE) session.compareMode = false;
    applySessionToDom();
    if (isRenderableResult(session.lastResult)) {
      renderComparison(session.lastResult);
    }
  } else {
    applyInitialSession(config.initialSession);
    applySessionToDom();
  }
  persistEnabled = true;
}

enableCompareBtn.addEventListener('click', () => {
  if (!ALLOW_COMPARE) return;
  syncCasesFromDom();
  session.compareMode = true;
  syncCompareModeUi();
  if (PROMPT_TEMPLATING.dynamicFields) renderCases();
  persistSessionNow();
});

disableCompareBtn.addEventListener('click', () => {
  syncCasesFromDom();
  session.compareMode = false;
  syncCompareModeUi();
  if (PROMPT_TEMPLATING.dynamicFields) renderCases();
  persistSessionNow();
});

strictTemplateParts.addEventListener('input', () => {
  syncStrictTemplateFromDom();
  updateInlineCasePreviews();
  scheduleSave();
});

strictTemplateEditor.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-template-field]');
  const addButton = event.target.closest('[data-add-template-field]');
  if (!removeButton && !addButton) return;
  syncStrictTemplateFromDom();
  if (removeButton) {
    const name = removeButton.dataset.removeTemplateField;
    promptAEl.value = promptAEl.value.replaceAll(`{{${name}}}`, '');
  } else {
    const name = addButton.dataset.addTemplateField;
    const field = PROMPT_TEMPLATING.fields.find((item) => item.name === name);
    const separator = promptAEl.value.trim() ? '\n\n' : '';
    promptAEl.value = `${promptAEl.value.trimEnd()}${separator}${field.label}:\n{{${name}}}`;
  }
  session.promptA = promptAEl.value;
  syncCasesFromDom();
  renderStrictTemplateEditor();
  renderCases();
  persistSessionNow();
});

promptBuilder.addEventListener('click', (event) => {
  const addButton = event.target.closest('[data-add-component]');
  const removeButton = event.target.closest('[data-remove-component]');
  if (!addButton && !removeButton) return;
  syncBuilderFromDom();
  const id = addButton?.dataset.addComponent ?? removeButton?.dataset.removeComponent;
  const active = new Set(session.promptComponents.active);
  if (addButton) active.add(id);
  else active.delete(id);
  session.promptComponents.active = PROMPT_TEMPLATING.builder.availableComponents
    .filter((componentId) => active.has(componentId));
  renderBuilder();
  configureTemplateTools();
  updateTemplatePreview();
  persistSessionNow();
});

promptBuilder.addEventListener('input', () => {
  syncBuilderFromDom();
  updateTemplatePreview();
  scheduleSave();
});

addCaseBtn.addEventListener('click', () => {
  syncCasesFromDom();
  if (session.cases.length >= maxVisibleInputs()) return;
  session.cases.push({
    id: newCaseId(),
    input: '',
    expectedAnswer: '',
    ...(PROMPT_TEMPLATING.enabled && !isBuilderMode()
      ? {
        variables: Object.fromEntries(activeTemplateFields()
          .filter((field) => field.name !== 'input')
          .map((field) => [field.name, ''])),
      }
      : {}),
  });
  renderCases();
  persistSessionNow();
});

casesListEl.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-remove]');
  if (!btn) return;
  syncCasesFromDom();
  if (session.cases.length <= MIN_CASES) return;
  session.cases = session.cases.filter((c) => c.id !== btn.getAttribute('data-remove'));
  renderCases();
  persistSessionNow();
});

casesListEl.addEventListener('input', () => {
  syncCasesFromDom();
  updateTemplatePreview();
  scheduleSave();
});

promptAEl.addEventListener('input', () => {
  session.promptA = promptAEl.value;
  if (PROMPT_TEMPLATING.dynamicFields) {
    syncCasesFromDom();
    renderCases();
  } else {
    updateTemplatePreview();
  }
  scheduleSave();
});

promptBEl.addEventListener('input', () => {
  session.promptB = promptBEl.value;
  if (PROMPT_TEMPLATING.dynamicFields) {
    syncCasesFromDom();
    renderCases();
  } else {
    updateTemplatePreview();
  }
  scheduleSave();
});

addExampleBtn.addEventListener('click', () => {
  syncExamplesFromDom();
  if ((session.examples?.length ?? 0) >= 5) return;
  session.examples ??= [];
  session.examples.push({ id: newExampleId(), input: '', idealOutput: '' });
  renderExamples();
  persistSessionNow();
});

removeExamplesComponentBtn.addEventListener('click', () => {
  if (!isBuilderMode()) return;
  syncBuilderFromDom();
  session.promptComponents.active = session.promptComponents.active
    .filter((id) => id !== 'examples');
  renderBuilder();
  configureTemplateTools();
  updateTemplatePreview();
  persistSessionNow();
});

examplesListEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-example]');
  if (!button) return;
  syncExamplesFromDom();
  session.examples = (session.examples ?? [])
    .filter((example) => example.id !== button.dataset.removeExample);
  renderExamples();
  persistSessionNow();
});

examplesListEl.addEventListener('input', () => {
  syncExamplesFromDom();
  updateTemplatePreview();
  scheduleSave();
});

previewPromptSelect.addEventListener('change', updateTemplatePreview);
previewCaseSelect.addEventListener('change', updateTemplatePreview);

metricSelectEl.addEventListener('change', () => {
  session.metricId = metricSelectEl.value;
  updateMetricHelp();
  persistSessionNow();
});

modelSelectEl.addEventListener('change', () => {
  session.model = modelSelectEl.value;
  updateMetricHelp();
  persistSessionNow();
});

runBtn.addEventListener('click', () => {
  void runEvaluation();
});

runCountEl.addEventListener('change', () => {
  runCountEl.value = String(clampRuns(runCountEl.value));
  session.runs = clampRuns(runCountEl.value);
  persistSessionNow();
});

void init();
