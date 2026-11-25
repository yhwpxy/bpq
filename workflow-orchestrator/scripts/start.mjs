import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const mainEntry = resolve(root, 'dist/electron/main.cjs');

if (!existsSync(mainEntry)) {
  console.error('dist/electron/main.cjs missing. Run `npm run build` first.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const electronBin = require('electron');
const child = spawn(electronBin, [mainEntry], {
  cwd: root,
  stdio: 'inherit',
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
