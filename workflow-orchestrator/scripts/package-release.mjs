import {spawnSync} from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {join, resolve} from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const pkgVersion = '0.2.0';
const releaseDir = resolve(root, 'release');

function runChecked(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, {cwd, stdio: 'inherit'});
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function findElectronDistSource() {
  const overrideDir = process.env['ELECTRON_DIST_DIR'];
  if (overrideDir && existsSync(join(overrideDir, 'electron.exe'))) {
    return {type: 'dir', path: overrideDir};
  }

  const localDist = resolve(root, 'node_modules/electron/dist');
  if (existsSync(join(localDist, 'electron.exe'))) {
    return {type: 'dir', path: localDist};
  }

  const overrideZip = process.env['ELECTRON_DIST_ZIP'];
  if (overrideZip && existsSync(overrideZip)) {
    return {type: 'zip', path: overrideZip};
  }

  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) {
    const cacheRoot = join(localAppData, 'electron', 'Cache');
    if (existsSync(cacheRoot)) {
      const zips = [];
      for (const entry of readdirSync(cacheRoot)) {
        const sub = join(cacheRoot, entry);
        if (!statSync(sub).isDirectory()) {
          continue;
        }
        for (const f of readdirSync(sub)) {
          if (/^electron-v44\..*-win32-x64\.zip$/i.test(f)) {
            zips.push(join(sub, f));
          }
        }
      }
      zips.sort();
      if (zips.length > 0) {
        return {type: 'zip', path: zips[zips.length - 1]};
      }
    }
  }
  return null;
}

function zipFolder(sourceFolder, zipPath) {
  rmSync(zipPath, {force: true});
  if (process.platform === 'win32') {
    // Windows 10/11 bsdtar creates standard ZIP cleanly via `-a`
    const tarRes = spawnSync('tar.exe', ['-a', '-c', '-f', zipPath, '.'], {
      cwd: sourceFolder,
      stdio: 'inherit',
    });
    if (tarRes.status === 0 && existsSync(zipPath)) {
      return;
    }
    runChecked(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${sourceFolder}\\*' -DestinationPath '${zipPath}' -Force`,
      ],
      root,
    );
    return;
  }
  runChecked('zip', ['-r', zipPath, '.'], sourceFolder);
}

console.log('1. Building main, preload, runtime, and renderer bundles...');
runChecked(process.execPath, [resolve(root, 'scripts/build.mjs')]);

rmSync(releaseDir, {recursive: true, force: true});
mkdirSync(releaseDir, {recursive: true});

const demoReadme = [
  'Workflow Orchestrator — Design-Spec-to-Execution Customizable SE Workbench (v0.2.0)',
  '====================================================================================',
  '',
  'Quick Demo Guide (ZH / EN):',
  '',
  '1. Windows Desktop (Zero dependencies):',
  '   Unzip WorkflowOrchestrator-v0.2.0-win32-x64-desktop.zip and double-click:',
  '     WorkflowOrchestrator.exe',
  '',
  '2. Cross-Platform Portable Web Workbench (Requires Node.js >= 24):',
  '   - Windows: Double-click Start-Demo.bat',
  '   - macOS / Linux: Run ./start-demo.sh',
  '',
  'What to explore inside the Workbench:',
  '  - Design Studio (编排设计台):',
  '    Click "+ Import Design Spec" to switch between 3 built-in product test cases',
  '    or upload any custom .md/.txt Design Spec, customize the SE workflow template',
  '    (Human Gate / Security Pass / QA / DDD Guard / Parallelism), inspect PM Agent',
  '    decomposition modules & Twin-Graph, export WBS/Mermaid/JSON, run Trial -> Lock v1.0.',
  '  - Live Orchestrator (实时编排控制台):',
  '    Launch a live run, inspect Token & USD telemetry, Ebbinghaus Re-hydration capsule,',
  '    step transcripts/checkpoints, or test Pause/Resume/GhostNode/Restore.',
  '  - Capabilities / SkillsBank / MCP / DDD + Runs & Constitution Tabs:',
  '    Edit sovereignSoul prompts, run Sleep-Time Dreaming, probe MCP tools, manage DDD',
  '    forbidden aliases, and enforce Engineering Constitution blocked-command guardrails.',
  '  - Top-right controls: Switch ZH / EN language or press Ctrl+K.',
  '',
  'Note: Live multi-node execution with Git worktree isolation uses `git` on PATH.',
  'Design Studio, Validation, Change Impact, Trial Run, and FTS5 Audit work without Git.',
  '',
].join('\n');

// Package 1: Cross-platform portable Web Workbench (<1 MB)
const webStageName = `WorkflowOrchestrator-v${pkgVersion}-portable-web`;
const webStage = join(releaseDir, webStageName);
mkdirSync(join(webStage, 'dist', 'server'), {recursive: true});
mkdirSync(join(webStage, 'dist', 'renderer'), {recursive: true});
mkdirSync(join(webStage, 'scripts'), {recursive: true});

cpSync(
  resolve(root, 'dist/server/runtime.cjs'),
  join(webStage, 'dist', 'server', 'runtime.cjs'),
);
cpSync(
  resolve(root, 'dist/renderer'),
  join(webStage, 'dist', 'renderer'),
  {recursive: true},
);
cpSync(
  resolve(root, 'scripts/serve-web.mjs'),
  join(webStage, 'scripts', 'serve-web.mjs'),
);
writeFileSync(
  join(webStage, 'package.json'),
  JSON.stringify(
    {
      name: 'workflow-orchestrator-demo',
      version: pkgVersion,
      private: true,
      type: 'module',
    },
    null,
    2,
  ),
  'utf8',
);
writeFileSync(
  join(webStage, 'Start-Demo.bat'),
  [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo Node.js ^>= 24 is required for Web Demo mode. Or download the Windows Desktop zip instead.',
    '  pause',
    '  exit /b 1',
    ')',
    'node scripts\\serve-web.mjs --open',
    'pause',
    '',
  ].join('\r\n'),
  'utf8',
);
writeFileSync(
  join(webStage, 'start-demo.sh'),
  [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'node scripts/serve-web.mjs --open',
    '',
  ].join('\n'),
  'utf8',
);
writeFileSync(join(webStage, 'README-DEMO.txt'), demoReadme, 'utf8');

const webZip = join(releaseDir, `${webStageName}.zip`);
zipFolder(webStage, webZip);
rmSync(webStage, {recursive: true, force: true});
console.log(`Created portable web release: ${webZip}`);

// Package 2: Zero-dependency Windows x64 Electron Desktop App
const electronSrc = findElectronDistSource();
if (electronSrc) {
  const winStageName = `WorkflowOrchestrator-v${pkgVersion}-win32-x64-desktop`;
  const winStage = join(releaseDir, winStageName);
  mkdirSync(winStage, {recursive: true});

  if (electronSrc.type === 'dir') {
    cpSync(electronSrc.path, winStage, {recursive: true});
  } else {
    console.log(`2. Unpacking cached Electron runtime: ${electronSrc.path}`);
    runChecked(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${electronSrc.path}' -DestinationPath '${winStage}' -Force`,
      ],
      root,
    );
  }

  rmSync(join(winStage, 'resources', 'default_app.asar'), {force: true});
  const appDir = join(winStage, 'resources', 'app');
  mkdirSync(join(appDir, 'dist', 'electron'), {recursive: true});
  mkdirSync(join(appDir, 'dist', 'renderer'), {recursive: true});

  cpSync(
    resolve(root, 'dist/electron/main.cjs'),
    join(appDir, 'dist', 'electron', 'main.cjs'),
  );
  cpSync(
    resolve(root, 'dist/electron/preload.cjs'),
    join(appDir, 'dist', 'electron', 'preload.cjs'),
  );
  cpSync(
    resolve(root, 'dist/renderer'),
    join(appDir, 'dist', 'renderer'),
    {recursive: true},
  );
  writeFileSync(
    join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'workflow-orchestrator',
        version: pkgVersion,
        private: true,
        main: 'dist/electron/main.cjs',
      },
      null,
      2,
    ),
    'utf8',
  );

  const srcExe = join(winStage, 'electron.exe');
  const dstExe = join(winStage, 'WorkflowOrchestrator.exe');
  if (existsSync(srcExe)) {
    renameSync(srcExe, dstExe);
  }
  writeFileSync(join(winStage, 'README-DEMO.txt'), demoReadme, 'utf8');

  const winZip = join(releaseDir, `${winStageName}.zip`);
  console.log(`3. Archiving Windows Desktop release -> ${winZip}`);
  zipFolder(winStage, winZip);
  rmSync(winStage, {recursive: true, force: true});
  console.log(`Created desktop release: ${winZip}`);
} else {
  console.warn(
    'Electron runtime binary not found in node_modules or local cache; skipped win32-x64 desktop zip.',
  );
}
