import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { startDesktopKernel, type DesktopKernel } from './appKernel.ts';
import { createElectronPrintAdapter } from './printService.ts';
import { buildSecureWindowOptions, isAllowedRendererNavigation } from './windowConfig.ts';

let kernel: DesktopKernel | null = null;

async function createMainWindow(): Promise<void> {
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const win = new BrowserWindow(buildSecureWindowOptions(preloadPath));

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, targetUrl) => {
    const devOrigin = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : '';
    if (!isAllowedRendererNavigation(targetUrl, isDev, devOrigin)) {
      event.preventDefault();
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
  const userDataDir = app.getPath('userData');
  const migrationsDir = path.resolve(__dirname, '../database/migrations');

  kernel = startDesktopKernel({
    productionDbPath: path.join(userDataDir, 'data', 'agency_erp.db'),
    migrationsDir,
    vaultRootDir: path.join(userDataDir, 'secure_vault'),
    printAdapter: createElectronPrintAdapter({ BrowserWindow }),
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
