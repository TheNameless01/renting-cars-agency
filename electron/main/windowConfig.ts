import path from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';

export function buildSecureWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1400,
    height: 860,
    minWidth: 1200,
    minHeight: 720,
    title: 'Gestion Agence de Location — تسيير وكالة كراء السيارات',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.resolve(preloadPath),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
}

/**
 * Validates whether a renderer navigation URL is permitted inside the offline desktop shell.
 */
export function isAllowedRendererNavigation(targetUrl: string, isDev: boolean, devServerOrigin = 'http://localhost:3000'): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (isDev && parsed.origin === devServerOrigin) {
      return true;
    }
    return parsed.protocol === 'file:';
  } catch {
    return false;
  }
}
