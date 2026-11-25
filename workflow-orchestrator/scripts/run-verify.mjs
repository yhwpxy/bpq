import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const verifyDir = resolve(root, 'verify');
const require = createRequire(import.meta.url);
const tsxCli = resolve(root, 'node_modules/tsx/dist/cli.mjs');

const files = readdirSync(verifyDir)
  .filter(f => f.endsWith('.verify.ts'))
  .sort();

if (files.length === 0) {
  console.log('No verify/*.verify.ts files found.');
  process.exit(0);
}

for (const file of files) {
  console.log(`\n>>> Running verification gate: ${file}`);
  const res = spawnSync(process.execPath, [tsxCli, join(verifyDir, file)], {
    cwd: root,
    env: {...process.env, ORCH_OFFLINE_VERIFY: '1'},
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.error(`FAILED verification gate: ${file}`);
    process.exit(res.status ?? 1);
  }
}

void require;
console.log('\nALL VERIFICATION GATES PASSED.');
