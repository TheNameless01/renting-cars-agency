import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron';
import { startDesktopKernel, type DesktopKernel } from './appKernel.ts';
import { createElectronPrintAdapter } from './printService.ts';
import {
  buildDesktopCspHeader,
  buildSecureWindowOptions,
  isAllowedRendererNavigation,
} from './windowConfig.ts';

let kernel: DesktopKernel | null = null;
let mainWindow: BrowserWindow | null = null;

function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../electron/database/migrations'),
    path.resolve(__dirname, '../database/migrations'),
    path.resolve(app.getAppPath(), 'electron/database/migrations'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

function resolveWindowIconPath(): string | undefined {
  const candidates = [
    path.resolve(__dirname, '../../build/icon.png'),
    path.resolve(app.getAppPath(), 'build/icon.png'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

async function createMainWindow(): Promise<void> {
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  const devOrigin = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : '';
  const preloadPath = path.join(__dirname, '../preload/index.js');

  const win = new BrowserWindow(
    buildSecureWindowOptions(preloadPath, {
      isDev,
      iconPath: resolveWindowIconPath(),
    })
  );
  mainWindow = win;

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedRendererNavigation(targetUrl, isDev, devOrigin)) {
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.resolve(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  const devOrigin = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : '';

  // Enforce strict offline desktop session security & CSP
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = buildDesktopCspHeader(isDev, devOrigin);
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  const userDataDir = app.getPath('userData');
  const migrationsDir = resolveMigrationsDir();

  kernel = startDesktopKernel({
    productionDbPath: path.join(userDataDir, 'data', 'agency_erp.db'),
    migrationsDir,
    vaultRootDir: path.join(userDataDir, 'secure_vault'),
    backupDir: path.join(userDataDir, 'backups'),
    appVersion: app.getVersion(),
    safeStorage,
    enableAutoBackupScheduler: true,
    printAdapter: createElectronPrintAdapter({ BrowserWindow }),
    pickBackupPath: async ({ mode, defaultFileName }) => {
      const parentWin = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
      if (mode === 'save') {
        const res = await dialog.showSaveDialog(parentWin as BrowserWindow, {
          title: 'Exporter la sauvegarde chiffrée',
          defaultPath: defaultFileName || 'AGL-BACKUP.agbkp',
          filters: [{ name: 'Sauvegarde Agence Chiffrée', extensions: ['agbkp'] }],
        });
        return { canceled: res.canceled, filePath: res.filePath || null };
      }
      const res = await dialog.showOpenDialog(parentWin as BrowserWindow, {
        title: 'Sélectionner un fichier de sauvegarde chiffré (.agbkp)',
        properties: ['openFile'],
        filters: [{ name: 'Sauvegarde Agence Chiffrée', extensions: ['agbkp'] }],
      });
      return { canceled: res.canceled, filePath: res.filePaths[0] || null };
    },
  });

  for (const [channel, handler] of Object.entries(kernel.handlers)) {
    ipcMain.handle(channel, async (_event, payload) => handler(payload));
  }

  await createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  kernel?.shutdown();
  kernel = null;
});
