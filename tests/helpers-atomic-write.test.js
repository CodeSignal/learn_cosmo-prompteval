import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJsonFile, writeJsonFileAtomic } from '../lib/helpers.js';

describe('writeJsonFileAtomic', () => {
  /** @type {string | undefined} */
  let dir;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('never exposes truncated JSON to concurrent readers', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'eval-session-'));
    const file = path.join(dir, 'eval-session.json');
    const makeSession = (n) => ({
      promptA: `prompt-${n}-${'x'.repeat(8000)}`,
      promptB: '',
      compareMode: false,
      cases: [{ id: 'c1', input: 'France', expectedAnswer: 'Paris' }],
      metricId: 'exact-match',
      runs: 2,
      lastResult: null,
    });

    await writeJsonFileAtomic(file, makeSession(0));

    const reads = [];
    let writing = true;
    const reader = (async () => {
      while (writing) {
        const raw = await readJsonFile(file, null);
        reads.push(raw);
      }
    })();

    for (let i = 1; i <= 25; i += 1) {
      await writeJsonFileAtomic(file, makeSession(i));
    }
    writing = false;
    await reader;

    expect(reads.length).toBeGreaterThan(0);
    for (const raw of reads) {
      // Truncated in-place writes make JSON.parse fail, so readJsonFile
      // returns null — the same signal the client treats as "no session".
      expect(raw).not.toBeNull();
      expect(raw.promptA.startsWith('prompt-')).toBe(true);
      expect(raw.cases).toEqual([
        { id: 'c1', input: 'France', expectedAnswer: 'Paris' },
      ]);
    }
  });
});
