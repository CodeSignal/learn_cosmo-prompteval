import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessmentPaths } from '../lib/assessment-store.js';
import {
  MAX_SUBMITTED_VERSIONS,
  readSubmittedVersions,
  recordSubmittedVersion,
  recordSubmittedWork,
  submittedVersionFrom,
  withSubmittedVersion,
} from '../lib/submitted-versions.js';

async function workspace(submission) {
  const paths = assessmentPaths(await fs.mkdtemp(path.join(os.tmpdir(), 'submitted-versions-')));
  await fs.mkdir(paths.dir, { recursive: true });
  if (submission) await fs.writeFile(paths.submissionJson, JSON.stringify(submission));
  return paths;
}

const submission = (stage, prompt, criteria = '', notes = '') => ({
  stage,
  stageLabel: `${stage} label`,
  prompt: { template: prompt, version: 'x' },
  customCheck: { criteria, version: 'y' },
  notes,
});

describe('submitted versions', () => {
  it('keeps only the restorable fields of a submission', () => {
    expect(submittedVersionFrom(submission('level-2', 'P', 'C', 'N'), 'T')).toEqual({
      submittedAt: 'T',
      stage: 'level-2',
      stageLabel: 'level-2 label',
      prompt: 'P',
      customCheckCriteria: 'C',
      notes: 'N',
    });
  });

  it('skips an identical resubmission at the same level and caps the list', () => {
    const a = submittedVersionFrom(submission('level-1', 'P'), 'T1');
    const list = withSubmittedVersion([], a);
    expect(withSubmittedVersion(list, { ...a, submittedAt: 'T2' })).toBe(list);
    expect(withSubmittedVersion(list, { ...a, stage: 'level-2', submittedAt: 'T2' })).toHaveLength(2);
    let long = [];
    for (let i = 0; i < MAX_SUBMITTED_VERSIONS + 5; i += 1) {
      long = withSubmittedVersion(long, { ...a, prompt: `P${i}`, submittedAt: `T${i}` });
    }
    expect(long).toHaveLength(MAX_SUBMITTED_VERSIONS);
    expect(long.at(-1).prompt).toBe(`P${MAX_SUBMITTED_VERSIONS + 4}`);
  });

  it('records the work in submission.json and reads it back', async () => {
    const paths = await workspace(submission('level-1', 'First prompt'));
    expect(await recordSubmittedVersion(paths, 'T1')).toMatchObject({ prompt: 'First prompt' });
    await fs.writeFile(paths.submissionJson, JSON.stringify(submission('level-2', 'First prompt', 'Criteria')));
    await recordSubmittedVersion(paths, 'T2');
    expect((await readSubmittedVersions(paths.submittedVersions)).map((v) => [v.stage, v.customCheckCriteria]))
      .toEqual([['level-1', ''], ['level-2', 'Criteria']]);
  });

  it('records from a simulator directory for the submit hook', async () => {
    const paths = await workspace(submission('level-3', 'P', 'C', 'N'));
    expect(await recordSubmittedWork(path.dirname(paths.dir))).toMatchObject({ stage: 'level-3', notes: 'N' });
    expect(await readSubmittedVersions(paths.submittedVersions)).toHaveLength(1);
  });

  it('records nothing before the simulator has saved any work', async () => {
    const paths = await workspace(null);
    expect(await recordSubmittedVersion(paths, 'T1')).toBeNull();
    expect(await readSubmittedVersions(paths.submittedVersions)).toEqual([]);
  });

  it('ignores a malformed file', async () => {
    const paths = await workspace(null);
    await fs.writeFile(paths.submittedVersions, '{"versions":[{"prompt":"no timestamp"}, 3]}');
    expect(await readSubmittedVersions(paths.submittedVersions)).toEqual([]);
  });
});
