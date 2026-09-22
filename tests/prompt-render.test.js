import { describe, it, expect } from 'vitest';
import {
  EXAMPLES_PLACEHOLDER,
  findPromptPlaceholders,
  formatPromptExamples,
  INPUT_PLACEHOLDER,
  renderPromptTemplate,
} from '../lib/prompt-render.js';

describe('renderPromptTemplate', () => {
  it('substitutes {{input}} placeholders', () => {
    expect(renderPromptTemplate(`Hello ${INPUT_PLACEHOLDER}!`, 'world')).toBe('Hello world!');
  });

  it('substitutes every {{input}} occurrence', () => {
    expect(renderPromptTemplate('A {{input}} B {{input}}', 'x')).toBe('A x B x');
  });

  it('appends input when the template has no placeholder', () => {
    expect(renderPromptTemplate('Prefix', 'suffix')).toBe('Prefix\n\nsuffix');
  });

  it('returns template alone when input is blank and no placeholder', () => {
    expect(renderPromptTemplate('Only template', '   ')).toBe('Only template');
  });

  it('returns input alone when template is blank', () => {
    expect(renderPromptTemplate('', 'just input')).toBe('just input');
  });

  it('fills named variables and shared examples', () => {
    const rendered = renderPromptTemplate(
      `You are a {{role}}.\n\n${EXAMPLES_PLACEHOLDER}\n\nQuestion: ${INPUT_PLACEHOLDER}`,
      'Where is my refund?',
      {
        variables: { role: 'support agent' },
        examples: [{ input: 'I was charged twice.', idealOutput: 'billing' }],
        strict: true,
      },
    );

    expect(rendered).toContain('You are a support agent.');
    expect(rendered).toContain('Example 1\nInput: I was charged twice.\nIdeal output: billing');
    expect(rendered).toContain('Question: Where is my refund?');
  });

  it('finds unique named placeholders', () => {
    expect(findPromptPlaceholders('{{role}} {{input}} {{role}}')).toEqual(['role', 'input']);
  });

  it('formats multiple examples consistently', () => {
    expect(formatPromptExamples([
      { input: 'a', idealOutput: 'A' },
      { input: 'b', idealOutput: 'B' },
    ])).toBe(
      'Example 1\nInput: a\nIdeal output: A\n\n'
      + 'Example 2\nInput: b\nIdeal output: B',
    );
  });

  it('fails clearly when strict templating has missing values', () => {
    expect(() => renderPromptTemplate('{{role}}: {{input}}', 'Hello', {
      strict: true,
    })).toThrow(/Missing values for: \{\{role\}\}/);
  });

  it('omits shared examples when the template has no {{examples}} slot', () => {
    expect(renderPromptTemplate('Question: {{input}}', 'Hello', {
      examples: [{ input: 'a', idealOutput: 'A' }],
      strict: true,
    })).toBe('Question: Hello');
  });
});

