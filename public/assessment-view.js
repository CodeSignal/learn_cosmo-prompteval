/**
 * Assessment-mode markup for the Prompt Evaluation Simulator client.
 * Pure string builders; app.js owns state and events.
 */

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function percent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>');
}

/**
 * Minimal, escape-first markdown for reference material: headings, bold,
 * inline code, fenced blocks, bullet and numbered lists, paragraphs.
 * @param {string} markdown
 */
export function renderMarkdownLite(markdown) {
  const out = [];
  let list = null;
  let paragraph = [];
  let fence = null;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(renderInline).join('<br />')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of String(markdown ?? '').split(/\r?\n/u)) {
    if (fence) {
      if (line.trim().startsWith('```')) {
        out.push(`<pre class="eval-material__code">${escapeHtml(fence.join('\n'))}</pre>`);
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (line.trim().startsWith('```')) {
      flushParagraph();
      closeList();
      fence = [];
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/u);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/u);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/u);
    if (heading) {
      flushParagraph();
      closeList();
      out.push(`<h4 class="eval-material__heading">${renderInline(heading[2])}</h4>`);
    } else if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li${/^\s{2,}/u.test(line) ? ' class="eval-material__sub"' : ''}>${renderInline((bullet ?? numbered)[1])}</li>`);
    } else if (!line.trim() || /^-{3,}$/u.test(line.trim())) {
      flushParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(line.trim());
    }
  }
  if (fence) out.push(`<pre class="eval-material__code">${escapeHtml(fence.join('\n'))}</pre>`);
  flushParagraph();
  closeList();
  return out.join('');
}

/**
 * @param {Array<{ id: string, title: string, body: string }>} materials
 */
export function renderMaterials(materials) {
  return materials.map((material, index) => `
    <details class="eval-details eval-material"${index === 0 ? ' open' : ''}>
      <summary class="eval-details__summary">
        <span class="body-xsmall eval-details__summary-title">${escapeHtml(material.title)}</span>
      </summary>
      <div class="eval-details__body">
        <div class="eval-material__body body-small">${renderMarkdownLite(material.body)}</div>
      </div>
    </details>
  `).join('');
}

/**
 * Read-only provided cases with an include toggle.
 * @param {Array<{ id: string, label: string, input: string, expectedAnswer: string }>} cases
 * @param {Set<string>} excluded
 * @param {boolean} busy
 */
export function renderProvidedCases(cases, excluded, busy) {
  return cases.map((c) => `
    <article class="eval-case eval-case--provided${excluded.has(c.id) ? ' eval-case--excluded' : ''}" data-provided-id="${escapeHtml(c.id)}">
      <div class="eval-case__header">
        <h4 class="body-xsmall eval-case__title">
          <span>${escapeHtml(c.label)}</span>
          <span class="tag neutral">Provided</span>
        </h4>
        ${renderIncludeToggle(c.id, !excluded.has(c.id), busy)}
      </div>
      <div class="eval-case__body">
        <p class="body-xxsmall eval-field__label">Input</p>
        <pre class="eval-case__readonly body-small">${escapeHtml(c.input || '(empty)')}</pre>
        ${c.expectedAnswer
          ? `<p class="body-xxsmall eval-field__label">Expected answer</p>
             <pre class="eval-case__readonly body-small">${escapeHtml(c.expectedAnswer)}</pre>`
          : ''}
      </div>
    </article>
  `).join('');
}

/**
 * @param {string} id
 * @param {boolean} included
 * @param {boolean} [busy]
 */
export function renderIncludeToggle(id, included, busy = false) {
  return `
    <label class="eval-include body-xxsmall">
      <input type="checkbox" data-include-case="${escapeHtml(id)}"${included ? ' checked' : ''}${busy ? ' disabled' : ''} />
      Include in runs
    </label>
  `;
}

/**
 * Reviewer samples, with the candidate's check verdicts once calibrated.
 * @param {Array<{ id: string, label: string, input: string, output: string, verdict: 'pass' | 'fail', note: string }>} samples
 * @param {null | { criteria?: string, samples?: Array<{ id: string, verdict: string | null, reason?: string, error?: string, agree: boolean }>, agreement?: { agreeing: number, total: number } }} calibration
 * @param {string} currentCriteria
 */
export function renderCalibration(samples, calibration, currentCriteria) {
  const byId = new Map((calibration?.samples ?? []).map((s) => [s.id, s]));
  const stale = calibration && calibration.criteria?.trim() !== currentCriteria.trim();
  const summary = calibration?.agreement
    ? `
      <div class="eval-verdict ${calibration.agreement.agreeing === calibration.agreement.total ? 'eval-verdict--winner' : 'eval-verdict--neutral'}" role="status">
        <p class="body-small eval-verdict__title">
          <strong>Your check agrees with the reviewer on ${calibration.agreement.agreeing} of ${calibration.agreement.total} samples</strong>
        </p>
        <p class="body-xxsmall eval-verdict__detail">
          ${stale
            ? 'You changed the criteria since this test. Test again to see the new agreement.'
            : 'Open a sample to compare your check’s reason with the reviewer’s note.'}
        </p>
      </div>
    `
    : '';
  const rows = samples.map((sample) => {
    const mine = byId.get(sample.id);
    const mineTag = !mine
      ? '<span class="tag neutral">Not tested</span>'
      : mine.verdict == null
        ? '<span class="tag error">No verdict</span>'
        : `<span class="tag ${mine.verdict === 'pass' ? 'success' : 'error'}">${mine.verdict === 'pass' ? 'Pass' : 'Fail'}</span>`;
    const agreeTag = mine
      ? `<span class="eval-agree ${mine.agree ? 'eval-agree--yes' : 'eval-agree--no'}">${mine.agree ? 'Agrees' : 'Disagrees'}</span>`
      : '';
    return `
      <details class="eval-details eval-details--nested eval-sample${mine && !mine.agree ? ' eval-sample--disagree' : ''}">
        <summary class="eval-details__summary eval-details__summary--compact eval-sample__summary">
          <span class="body-xsmall eval-sample__label">${escapeHtml(sample.label)}</span>
          <span class="eval-sample__verdicts body-xxsmall">
            Reviewer <span class="tag ${sample.verdict === 'pass' ? 'success' : 'error'}">${sample.verdict === 'pass' ? 'Pass' : 'Fail'}</span>
            Your check ${mineTag}
            ${agreeTag}
          </span>
        </summary>
        <div class="eval-details__body">
          <p class="body-xxsmall eval-field__label">Input</p>
          <pre class="eval-case__readonly body-small">${escapeHtml(sample.input || '(empty)')}</pre>
          <p class="body-xxsmall eval-field__label">Output being checked</p>
          <pre class="eval-case__readonly body-small">${escapeHtml(sample.output || '(empty)')}</pre>
          ${sample.note ? `<p class="body-xxsmall eval-sample__note"><strong>Reviewer:</strong> ${escapeHtml(sample.note)}</p>` : ''}
          ${mine?.reason ? `<p class="body-xxsmall eval-sample__note"><strong>Your check:</strong> ${escapeHtml(mine.reason)}</p>` : ''}
          ${mine?.error ? `<p class="body-xxsmall eval-sample__note eval-sample__note--error">${escapeHtml(mine.error)}</p>` : ''}
        </div>
      </details>
    `;
  }).join('');
  return `${summary}<div class="eval-samples">${rows}</div>`;
}

/**
 * One-line consistency summary for a prompt card.
 * @param {{ stability: number | null, consistentCases: number, comparedCases: number } | undefined} consistency
 */
export function renderOverallConsistency(consistency) {
  if (!consistency) return '';
  if (consistency.stability == null) {
    return '<p class="body-xxsmall eval-stability">Stability: run each case at least twice to measure it</p>';
  }
  return `
    <p class="body-xxsmall eval-stability">
      Stability <strong>${percent(consistency.stability)}</strong>
      · ${consistency.consistentCases} of ${consistency.comparedCases} case${consistency.comparedCases === 1 ? '' : 's'} gave the same answer every run
    </p>
  `;
}

/**
 * @param {{ agreeing: number, runs: number, distinct: number, basis: string[] } | undefined} consistency
 */
export function renderCaseConsistency(consistency) {
  if (!consistency || consistency.runs < 2) return '';
  const tone = consistency.agreeing === consistency.runs ? 'yes' : 'no';
  return `<span class="eval-agree eval-agree--${tone}">${consistency.agreeing}/${consistency.runs} runs agree${consistency.distinct > 1 ? ` · ${consistency.distinct} different answers` : ''}</span>`;
}

/**
 * Options for a "restore a submitted version" menu: the submitted versions
 * (newest first) that have this field filled in. Empty when there are none.
 * @param {Array<Record<string, string>>} versions newest first
 * @param {'prompt' | 'customCheckCriteria' | 'notes'} field
 * @param {(iso: string) => string} formatTime
 * @returns {string}
 */
export function renderRestoreOptions(versions, field, formatTime) {
  const options = versions
    .filter((v) => String(v[field] ?? '').trim())
    .map((v) => {
      const level = String(v.stageLabel ?? '').split(' · ')[0].trim() || v.stage || 'An earlier level';
      return `<option value="${escapeHtml(v.submittedAt)}">${escapeHtml(`${level} · submitted ${formatTime(v.submittedAt)}`)}</option>`;
    });
  if (options.length === 0) return '';
  return `<option value="">Choose a submission…</option>${options.join('')}`;
}
