import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve, relative} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/reference-manifest.json'), 'utf8'));
const localFixes = manifest.localFixes ?? {};
for (const [file, fix] of Object.entries(localFixes)) {
  assert.ok(file in manifest.files, `${file}: local fix must name an existing reference file`);
  assert.ok(fix.reason && /^[a-f0-9]{64}$/.test(fix.sha256), `${file}: local fix needs a reason and exact SHA-256`);
}
const failures = [];
for (const [file, expected] of Object.entries(manifest.files)) {
  try {
    const actual = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
    if (actual !== (localFixes[file]?.sha256 ?? expected)) {
      failures.push(`${file}: content differs from ${localFixes[file] ? 'documented local fix' : manifest.commit}`);
    }
  } catch (error) { failures.push(`${file}: ${error.code ?? error.message}`); }
}
const ignored = new Set(['node_modules', 'dist', '.orchestrator', 'release', 'tmp', '.git']);
function walk(directory) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|tsx|mjs|css|html)$/.test(entry.name)) {
      const file = relative(root, path).replaceAll('\\', '/');
      if (!(file in manifest.files)) failures.push(`${file}: extra source file not present in reference`);
    }
  }
}
for (const directory of manifest.subsystems) walk(resolve(root, directory));
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`PASS: ${Object.keys(manifest.files).length} reference files checked against ${manifest.commit}, with ${Object.keys(localFixes).length} documented local fixes; no extra subsystem source files.`);
