import {resolve} from 'node:path';
import {build as esbuild} from 'esbuild';
import {build as viteBuild} from 'vite';

const root = resolve(import.meta.dirname, '..');

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

await esbuild({
  entryPoints: [resolve(root, 'src/server/runtime.ts')],
  outfile: resolve(root, 'dist/server/runtime.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  define: {'import.meta.dirname': '__dirname'},
  external: ['node:sqlite'],
});

if (!process.argv.includes('--main-only')) {
  await viteBuild({
    configFile: resolve(root, 'renderer/vite.config.ts'),
  });
}
