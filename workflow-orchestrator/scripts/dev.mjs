import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import process from 'node:process';
import {build as esbuild} from 'esbuild';
import {createServer} from 'vite';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');

await esbuild({
  entryPoints: [resolve(root, 'src/electron/main.ts')],
  outfile: resolve(root, 'dist/electron/main.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  define: {'import.meta.dirname': '__dirname'},
  external: ['electron', 'node:sqlite'],
});

await esbuild({
  entryPoints: [resolve(root, 'src/electron/preload.ts')],
  outfile: resolve(root, 'dist/electron/preload.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
});

const vite = await createServer({
  configFile: resolve(root, 'renderer/vite.config.ts'),
});
await vite.listen();
const devUrl = `http://127.0.0.1:${vite.config.server.port ?? 5178}`;

const child = spawn(electronBin, [resolve(root, 'dist/electron/main.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {...process.env, ORCH_RENDERER_DEV_URL: devUrl},
});

child.on('exit', async code => {
  await vite.close();
  process.exit(code ?? 0);
});
