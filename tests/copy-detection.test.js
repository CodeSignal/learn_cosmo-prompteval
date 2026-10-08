import { describe, it, expect } from 'vitest';
import { COPY_RULE, measureCopying, normalizeForCopy, phrases } from '../lib/copy-detection.js';

const MEMO = Array.from({ length: 40 }, (_, i) => (
  `Rule ${i}: anything cooked with ingredient number ${i} must list allergen number ${i} on our label.`
)).join('\n');

describe('copy detection', () => {
  it('normalizes case, markdown, and punctuation before building four-word phrases', () => {
    expect(normalizeForCopy('**Coconut** is NOT a `tree nut`!')).toBe('coconut is not a tree nut');
    expect([...phrases('One two three four five')]).toEqual(['one two three four', 'two three four five']);
  });

  it('flags a pasted memo, a partial paste, and a lightly edited copy', () => {
    expect(measureCopying(`You label dishes.\n${MEMO}\n{{input}}`, [MEMO]).isCopyPaste).toBe(true);
    expect(measureCopying(MEMO.slice(0, 1200), [MEMO]).isCopyPaste).toBe(true);
    const lightlyEdited = MEMO.split(/(\s+)/u).map((w, i) => (i % 20 === 0 && /\w/u.test(w) ? `${w}s` : w)).join('');
    expect(measureCopying(lightlyEdited, [MEMO]).isCopyPaste).toBe(true);
  });

  it('does not flag an original rewrite that quotes a phrase or two', () => {
    const distilled = 'Label each dish. For ingredient number 3 list allergen number 3. Use only our allergen names and nothing else.';
    const report = measureCopying(distilled, [MEMO]);
    expect(report.isCopyPaste).toBe(false);
    expect(report.copiedPhrases).toBeLessThan(COPY_RULE.minCopiedPhrases);
  });

  it('reports absolute counts', () => {
    const report = measureCopying(MEMO, [MEMO]);
    expect(report).toMatchObject({ isCopyPaste: true });
    expect(report.copiedPhrases).toBe(report.textPhrases);
    expect(report.materialPhrases).toBe(report.textPhrases);
  });
});
