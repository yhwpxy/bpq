import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve, relative} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/reference-manifest.json'), 'utf8'));
const failures = [];
for (const [file, expected] of Object.entries(manifest.files)) {
  try {
    const actual = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
    if (actual !== expected) failures.push(`${file}: content differs from ${manifest.commit}`);
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
console.log(`PASS: ${Object.keys(manifest.files).length} reference files match ${manifest.commit}; no extra subsystem source files.`);
