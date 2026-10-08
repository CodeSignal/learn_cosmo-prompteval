#!/usr/bin/env node
/**
 * Builds a runnable release tree into dist/ and archives it as dist.tar.gz.
 *
 * The tarball is the client bundle + a single-file server bundle + the static
 * files Express serves. No node_modules. Extract and `node server.js`.
 *
 * Usage:
 *   node scripts/pack-dist.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TAR = path.join(ROOT, 'dist.tar.gz');

// Modules hidden assessment tests import by path (see README "Assessment
// mode"). They are bundled to the same paths under dist/lib so a grader works
// against a release exactly as against the source tree.
const GRADING_ENTRIES = [
  'lib/grading.js',
  'lib/session-config.js',
  'lib/llm/provider.js',
  'lib/helpers.js',
  'lib/copy-detection.js',
  'lib/eval-compare.js',
  'lib/metrics/index.js',
  'lib/consistency.js',
  'lib/custom-check-calibration.js',
  'lib/submitted-versions.js',
];

const NODE_REQUIRE_BANNER = "import { createRequire } from 'module'; const require = createRequire(import.meta.url);";

function copy(src, dest, filter) {
  fs.cpSync(src, dest, { recursive: true, filter });
}

function bytes(file) {
  return fs.statSync(file).size;
}

function formatSize(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function distSize(rel) {
  const full = path.join(DIST, rel);
  if (!fs.existsSync(full)) return 0;
  const st = fs.statSync(full);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    total += distSize(child);
  }
  return total;
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'public'), { recursive: true });

await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ['public/app.js'],
  bundle: true,
  outfile: 'dist/public/app.bundle.js',
  format: 'esm',
  platform: 'browser',
  minify: true,
  logLevel: 'warning',
});

await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ['server.js'],
  bundle: true,
  outfile: 'dist/server.js',
  format: 'esm',
  platform: 'node',
  minify: true,
  banner: { js: NODE_REQUIRE_BANNER },
  logLevel: 'warning',
});

// Code splitting keeps one copy of shared modules (and their state) across
// the grading entry points.
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: GRADING_ENTRIES,
  outbase: 'lib',
  outdir: 'dist/lib',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  minify: true,
  banner: { js: NODE_REQUIRE_BANNER },
  logLevel: 'warning',
});

copy(path.join(ROOT, 'public/index.html'), path.join(DIST, 'public/index.html'));
copy(path.join(ROOT, 'public/app.css'), path.join(DIST, 'public/app.css'));
copy(path.join(ROOT, 'public/Images'), path.join(DIST, 'public/Images'));
copy(path.join(ROOT, 'design-system'), path.join(DIST, 'design-system'), (src) => {
  const rel = path.relative(path.join(ROOT, 'design-system'), src);
  return !rel.split(path.sep).includes('.git');
});
// Bundled server resolves import.meta.url to dist/, so keep the prompt beside it.
copy(
  path.join(ROOT, 'lib/eval-system-prompt.md'),
  path.join(DIST, 'eval-system-prompt.md'),
);
// The grading bundles' shared chunk sits in dist/lib and reads it from there.
copy(
  path.join(ROOT, 'lib/eval-system-prompt.md'),
  path.join(DIST, 'lib/eval-system-prompt.md'),
);
copy(path.join(ROOT, '.env.example'), path.join(DIST, '.env.example'));
copy(
  path.join(ROOT, 'session.config.example.json'),
  path.join(DIST, 'session.config.example.json'),
);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(DIST, 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: 'module',
      scripts: {
        start: 'node server.js',
      },
    },
    null,
    2,
  )}\n`,
);

for (const rel of [
  'public/app.bundle.js',
  'public/app.css',
  'public/index.html',
  'server.js',
  'eval-system-prompt.md',
  'lib/eval-system-prompt.md',
  ...GRADING_ENTRIES,
]) {
  if (!fs.existsSync(path.join(DIST, rel))) throw new Error(`missing ${rel} in dist/`);
}

process.env.NODE_ENV = 'test';
const { app } = await import(pathToFileURL(path.join(DIST, 'server.js')).href);
const server = await new Promise((resolve, reject) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
  s.on('error', reject);
});
try {
  const port = server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/api/session-config`);
  if (!health.ok) throw new Error(`session-config check failed (${health.status})`);
  await health.json();
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

// Every grading module loads, and a prompt grades end to end (system prompt
// file included) with a stub provider.
for (const rel of GRADING_ENTRIES) {
  await import(pathToFileURL(path.join(DIST, rel)).href);
}
{
  const grading = await import(pathToFileURL(path.join(DIST, 'lib/grading.js')).href);
  const [graded] = await grading.gradePrompt({
    llm: { name: 'stub', model: 'stub', complete: async () => ({ text: 'Label: yes' }) },
    promptA: 'Answer:\n{{input}}',
    cases: [{ id: 'c1', input: 'x', expected: { Label: 'yes' } }],
    runs: 1,
    fields: ['Label'],
  });
  if (graded?.errors !== 0 || graded?.fieldAccuracy?.Label !== 1) {
    throw new Error(`grading check failed: ${JSON.stringify(graded)}`);
  }
}

if (fs.existsSync(TAR)) fs.unlinkSync(TAR);
execFileSync('tar', ['-czf', TAR, '-C', DIST, '.'], { cwd: ROOT });

const entries = [
  'server.js',
  'public/app.bundle.js',
  'public',
  'design-system',
  'eval-system-prompt.md',
  'lib',
];
console.log('Packed dist/ (no node_modules):');
for (const rel of entries) {
  console.log(`  ${rel.padEnd(24)} ${formatSize(distSize(rel))}`);
}
console.log(`  ${'dist.tar.gz'.padEnd(24)} ${formatSize(bytes(TAR))}`);
