import { clampScore } from './types.js';

export const LLM_JUDGE_SYSTEM_PROMPT = `You are an evaluation judge.
Compare the candidate output with the expected answer for correctness.
Return only one number from 0 to 1, where 0 is fully incorrect and 1 is fully correct.
Do not include words, explanations, or punctuation.`;

export default {
  id: 'llm-judge',
  name: 'LLM judge',
  description: 'Uses the configured model to judge semantic correctness against Expected Answer.',
  type: 'llm',
  requiresExpectedAnswer: true,
};

/**
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseJudgeScore(text) {
  const match = String(text ?? '').trim().match(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u);
  if (!match) return null;
  return clampScore(Number.parseFloat(match[0]));
}
