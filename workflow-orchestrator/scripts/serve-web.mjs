import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const runtimeEntry = resolve(root, 'dist/server/runtime.cjs');

if (!existsSync(runtimeEntry)) {
  console.error('dist/server/runtime.cjs missing. Run `npm run build` first.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const {createOrchestratorRuntime} = require(runtimeEntry);

const rendererDir = resolve(root, 'dist/renderer');
const port = Number(process.env['ORCH_PORT'] ?? '4190');

const runtime = await createOrchestratorRuntime({
  dataDir: process.env['ORCH_DATA_DIR'] ?? resolve(root, '.orchestrator'),
  port: Number.isFinite(port) ? port : 4190,
  staticDir: existsSync(rendererDir) ? rendererDir : null,
  seedSample: true,
});

const url = `${runtime.baseUrl}/?apiBaseUrl=${encodeURIComponent(runtime.baseUrl)}&token=${encodeURIComponent(runtime.sessionToken)}`;
console.log(`Workflow Orchestrator Web Workbench ready:\n${url}`);

if (process.env['ORCH_SMOKE_EXIT'] === '1') {
  const res = await fetch(`${runtime.baseUrl}/api/health`);
  console.log(`Smoke /api/health HTTP ${res.status}`);
  await runtime.stop();
  process.exit(res.ok ? 0 : 1);
}

if (process.argv.includes('--open')) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], {detached: true, stdio: 'ignore'}).unref();
    } else {
      spawn('xdg-open', [url], {detached: true, stdio: 'ignore'}).unref();
    }
  } catch {
    // Non-fatal if browser open is unsupported in headless environments
  }
}

const shutdown = async () => {
  await runtime.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
