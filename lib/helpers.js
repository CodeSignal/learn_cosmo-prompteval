import { randomUUID } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';

export async function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Write text via a uniquely named sibling temp file, then rename over the
 * destination. Readers never see a truncated file, and overlapping writers
 * never share a temp file.
 */
export async function writeTextFileAtomic(filePath, text) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, text, 'utf8');
  await fs.rename(tmpPath, filePath);
}

/** Write JSON atomically (see writeTextFileAtomic), e.g. eval-session.json. */
export async function writeJsonFileAtomic(filePath, data) {
  await writeTextFileAtomic(filePath, JSON.stringify(data, null, 2));
}
