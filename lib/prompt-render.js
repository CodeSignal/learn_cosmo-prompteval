/**
 * Render a learner prompt template against a single evaluation input.
 *
 * Supported by default: {{input}} (case-sensitive).
 * Config-gated templating can also provide named variables and {{examples}}.
 * If the template has no {{input}} and `input` is non-empty, the input is
 * appended after a blank line so learners can still experiment without the
 * placeholder. Empty inputs leave the template unchanged.
 */

const INPUT_PLACEHOLDER = '{{input}}';
export const EXAMPLES_PLACEHOLDER = '{{examples}}';
const PLACEHOLDER_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/gu;

/**
 * @param {Array<{ input?: string, idealOutput?: string }>} examples
 * @returns {string}
 */
export function formatPromptExamples(examples) {
  if (!Array.isArray(examples)) return '';
  return examples
    .filter((example) => example && typeof example === 'object')
    .map((example, index) => {
      const input = typeof example.input === 'string' ? example.input : '';
      const idealOutput = typeof example.idealOutput === 'string' ? example.idealOutput : '';
      return `Example ${index + 1}\nInput: ${input}\nIdeal output: ${idealOutput}`;
    })
    .join('\n\n');
}

/**
 * @param {string} template
 * @returns {string[]}
 */
export function findPromptPlaceholders(template) {
  const source = typeof template === 'string' ? template : '';
  return [...new Set([...source.matchAll(PLACEHOLDER_RE)].map((match) => match[1]))];
}

/**
 * @param {string} template
 * @param {string} input
 * @param {{
 *   variables?: Record<string, string>,
 *   examples?: Array<{ input?: string, idealOutput?: string }>,
 *   strict?: boolean,
 * }} [options]
 * @returns {string}
 */
export function renderPromptTemplate(template, input, options = {}) {
  const safeTemplate = typeof template === 'string' ? template : '';
  const safeInput = typeof input === 'string' ? input : '';
  const variables = options.variables && typeof options.variables === 'object'
    ? options.variables
    : {};
  const examples = Array.isArray(options.examples) ? options.examples : [];
  const values = {
    ...Object.fromEntries(Object.entries(variables).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : '',
    ])),
    input: safeInput,
    examples: formatPromptExamples(examples),
  };

  // {{examples}} is opt-in per template so A/B compare can put few-shot only in one prompt.

  let rendered = safeTemplate.replace(PLACEHOLDER_RE, (placeholder, name) => (
    Object.hasOwn(values, name) ? values[name] : placeholder
  ));

  if (options.strict) {
    const unresolved = findPromptPlaceholders(rendered);
    if (unresolved.length > 0) {
      const err = new Error(`Missing values for: ${unresolved.map((name) => `{{${name}}}`).join(', ')}`);
      err.code = 'UNRESOLVED_PLACEHOLDER';
      throw err;
    }
  }

  if (safeTemplate.includes(INPUT_PLACEHOLDER)) {
    return rendered;
  }

  if (safeInput.trim() === '') return rendered;
  if (rendered.trim() === '') return safeInput;
  return `${rendered.replace(/\s+$/, '')}\n\n${safeInput}`;
}

export { INPUT_PLACEHOLDER };
