/**
 * Versions of the candidate's scored work saved on every Submit, so later
 * levels can restore what was submitted (as with a coding task's submissions).
 *
 * Only the scored text fields are kept: the prompt, the custom check criteria
 * and the notes. Own test cases are not restorable.
 *
 * UNUSUAL BUT DELIBERATE: call this from the task's hidden tests, not from
 * main.sh. On CodeSignal, Submit runs the test runner in the live workspace
 * with the hidden files readable, while Run executes main.sh with the hidden
 * files moved away. So a hook in the hidden tests fires on Submit only, and a
 * hook in main.sh would fire on every Run instead.
 */

import fs from 'fs/promises';
import { writeJsonFileAtomic } from './helpers.js';
import { assessmentPaths, readSubmission } from './assessment-store.js';

export const SUBMITTED_VERSIONS_VERSION = 1;
export const MAX_SUBMITTED_VERSIONS = 30;

/** Restorable fields, in the order the simulator shows them. */
export const RESTORABLE_FIELDS = /** @type {const} */ (['prompt', 'customCheckCriteria', 'notes']);

/**
 * @typedef {object} SubmittedVersion
 * @property {string} submittedAt ISO timestamp
 * @property {string} stage level id from session.config.json
 * @property {string} stageLabel
 * @property {string} prompt
 * @property {string} customCheckCriteria
 * @property {string} notes
 */

/**
 * @param {unknown} value
 * @returns {SubmittedVersion | null}
 */
function normalizeVersion(value) {
  if (!value || typeof value !== 'object') return null;
  const v = /** @type {Record<string, unknown>} */ (value);
  if (typeof v.submittedAt !== 'string' || !v.submittedAt) return null;
  return {
    submittedAt: v.submittedAt,
    stage: typeof v.stage === 'string' ? v.stage : '',
    stageLabel: typeof v.stageLabel === 'string' ? v.stageLabel : '',
    prompt: typeof v.prompt === 'string' ? v.prompt : '',
    customCheckCriteria: typeof v.customCheckCriteria === 'string' ? v.customCheckCriteria : '',
    notes: typeof v.notes === 'string' ? v.notes : '',
  };
}

/**
 * @param {string} filePath
 * @returns {Promise<SubmittedVersion[]>} oldest first
 */
export async function readSubmittedVersions(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const list = Array.isArray(parsed?.versions) ? parsed.versions : [];
    return list.map(normalizeVersion).filter((v) => v !== null);
  } catch {
    return [];
  }
}

/**
 * The restorable fields of a submission.json written by the simulator.
 * @param {Record<string, any>} submission
 * @param {string} submittedAt
 * @returns {SubmittedVersion}
 */
export function submittedVersionFrom(submission, submittedAt) {
  return {
    submittedAt,
    stage: String(submission?.stage ?? ''),
    stageLabel: String(submission?.stageLabel ?? ''),
    prompt: String(submission?.prompt?.template ?? ''),
    customCheckCriteria: String(submission?.customCheck?.criteria ?? ''),
    notes: String(submission?.notes ?? ''),
  };
}

/**
 * Append a version, skipping a resubmission of identical work at the same level.
 * @param {SubmittedVersion[]} versions oldest first
 * @param {SubmittedVersion} entry
 * @returns {SubmittedVersion[]} the same array when nothing changed
 */
export function withSubmittedVersion(versions, entry) {
  const last = versions.at(-1);
  if (last && last.stage === entry.stage && RESTORABLE_FIELDS.every((f) => last[f] === entry[f])) {
    return versions;
  }
  return [...versions, entry].slice(-MAX_SUBMITTED_VERSIONS);
}

/**
 * Save the work currently in submission.json as a submitted version. Called by
 * the task's submit-time tests, which run only when the candidate submits.
 * @param {ReturnType<typeof import('./assessment-store.js').assessmentPaths>} paths
 * @param {string} [submittedAt]
 * @returns {Promise<SubmittedVersion | null>} the saved entry, or null when there is no work yet
 */
export async function recordSubmittedVersion(paths, submittedAt = new Date().toISOString()) {
  const submission = await readSubmission(paths.submissionJson);
  if (!submission.prompt) return null;
  const entry = submittedVersionFrom(submission, submittedAt);
  const versions = await readSubmittedVersions(paths.submittedVersions);
  const next = withSubmittedVersion(versions, entry);
  if (next !== versions) {
    await fs.mkdir(paths.dir, { recursive: true });
    await writeJsonFileAtomic(paths.submittedVersions, { version: SUBMITTED_VERSIONS_VERSION, versions: next });
  }
  return entry;
}

/**
 * Entry point for a task's submit hook in its hidden tests (see the note at
 * the top of this file for why not main.sh).
 * @param {string} rootDir the simulator's directory
 */
export async function recordSubmittedWork(rootDir) {
  return recordSubmittedVersion(assessmentPaths(rootDir));
}
