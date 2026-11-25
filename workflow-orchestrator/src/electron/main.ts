/**
 * Electron 44 DirectUI Main Entry:
 * Boots the in-process loopback Orchestrator runtime, registers security
 * navigation guards, and opens the crisp light workbench window.
 */

import {app, BrowserWindow, shell} from 'electron';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {
  createOrchestratorRuntime,
  type OrchestratorRuntime,
} from '../server/runtime.ts';

let runtime: OrchestratorRuntime | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(apiUrl: string, token: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#f8fafc',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? {color: '#f8fafc', symbolColor: '#0f172a', height: 40}
        : undefined,
    webPreferences: {
      preload: resolve(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--orch-api=${apiUrl}`, `--orch-token=${token}`],
    },
  });

  win.webContents.setWindowOpenHandler(({url}) => {
    void shell.openExternal(url);
    return {action: 'deny'};
  });

  const devUrl = process.env['ORCH_RENDERER_DEV_URL'];
  const packagedHtml = resolve(import.meta.dirname, '../renderer/index.html');
  const query = `?apiBaseUrl=${encodeURIComponent(apiUrl)}&token=${encodeURIComponent(token)}`;

  if (devUrl) {
    void win.loadURL(`${devUrl}${query}`);
  } else if (existsSync(packagedHtml)) {
    void win.loadFile(packagedHtml, {
      query: {apiBaseUrl: apiUrl, token},
    });
  } else {
    void win.loadURL(`${apiUrl}${query}`);
  }

  return win;
}

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    const dataDir =
      process.env['ORCH_DATA_DIR'] ?? join(app.getPath('userData'), 'state');
    const rendererDir = resolve(import.meta.dirname, '../renderer');
    runtime = await createOrchestratorRuntime({
      dataDir,
      staticDir: existsSync(rendererDir) ? rendererDir : null,
      seedSample: true,
    });

    mainWindow = createWindow(runtime.baseUrl, runtime.sessionToken);

    if (process.env['ORCH_SMOKE_EXIT'] === '1') {
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          app.quit();
        }, 400);
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', async () => {
    if (runtime) {
      await runtime.stop();
      runtime = null;
    }
  });
}
