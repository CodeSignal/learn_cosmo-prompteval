import { describe, it, expect } from 'vitest';
import { renderPromptTemplate, INPUT_PLACEHOLDER } from '../lib/prompt-render.js';

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
});
