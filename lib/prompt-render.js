/**
 * Render a learner prompt template against a single evaluation input.
 *
 * Supported placeholder: {{input}} (case-sensitive).
 * If the template has no {{input}} and `input` is non-empty, the input is
 * appended after a blank line so learners can still experiment without the
 * placeholder. Empty inputs leave the template unchanged.
 */

const INPUT_PLACEHOLDER = '{{input}}';

/**
 * @param {string} template
 * @param {string} input
 * @returns {string}
 */
export function renderPromptTemplate(template, input) {
  const safeTemplate = typeof template === 'string' ? template : '';
  const safeInput = typeof input === 'string' ? input : '';

  if (safeTemplate.includes(INPUT_PLACEHOLDER)) {
    return safeTemplate.split(INPUT_PLACEHOLDER).join(safeInput);
  }

  if (safeInput.trim() === '') return safeTemplate;
  if (safeTemplate.trim() === '') return safeInput;
  return `${safeTemplate.replace(/\s+$/, '')}\n\n${safeInput}`;
}

export { INPUT_PLACEHOLDER };
