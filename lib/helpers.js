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
 * Write JSON via a sibling temp file, then rename over the destination.
 * Readers never see a truncated eval-session.json.
 */
export async function writeJsonFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
  await fs.rename(tmpPath, filePath);
}
