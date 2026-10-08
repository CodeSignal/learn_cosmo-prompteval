/**
 * How much of a candidate's text is copied from the reference material (for
 * example a policy memo pasted into the prompt). Deterministic, so hidden
 * tests and rubric graders apply the same verdict.
 *
 * Measured with four-word phrases: a light edit (changing one word in ten)
 * still leaves most phrases intact, while a genuine rewrite into instructions
 * shares only a few. Counts are absolute so a rubric can quote them.
 */

const PHRASE_WORDS = 4;

/**
 * Flag a copy when enough phrases match and they make up most of the text, or
 * much of the material. Quoting some lists or rules from the material is fine.
 */
export const COPY_RULE = {
  minCopiedPhrases: 60,
  textShare: 0.5,
  materialShare: 0.4,
};

/**
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeForCopy(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * @param {unknown} text
 * @returns {Set<string>}
 */
export function phrases(text) {
  const words = normalizeForCopy(text).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + PHRASE_WORDS <= words.length; i += 1) {
    out.add(words.slice(i, i + PHRASE_WORDS).join(' '));
  }
  return out;
}

/**
 * @typedef {object} CopyReport
 * @property {number} copiedPhrases the text's four-word phrases also found in the material
 * @property {number} textPhrases all four-word phrases in the text
 * @property {number} materialPhrases all four-word phrases in the material
 * @property {boolean} isCopyPaste
 */

/**
 * @param {string} text candidate text (prompt or check criteria)
 * @param {string[]} materials reference material bodies
 * @returns {CopyReport}
 */
export function measureCopying(text, materials) {
  const material = new Set((materials ?? []).flatMap((body) => [...phrases(body)]));
  const own = phrases(text);
  let copied = 0;
  for (const phrase of own) {
    if (material.has(phrase)) copied += 1;
  }
  const isCopyPaste = copied >= COPY_RULE.minCopiedPhrases && (
    copied >= own.size * COPY_RULE.textShare
    || copied >= material.size * COPY_RULE.materialShare
  );
  return {
    copiedPhrases: copied,
    textPhrases: own.size,
    materialPhrases: material.size,
    isCopyPaste,
  };
}
