import path from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';

export function buildSecureWindowOptions(
  preloadPath: string,
  options?: { isDev?: boolean; iconPath?: string }
): BrowserWindowConstructorOptions {
  return {
    width: 1400,
    height: 860,
    minWidth: 1200,
    minHeight: 720,
    title: 'Gestion Agence de Location — تسيير وكالة كراء السيارات',
    show: false,
    autoHideMenuBar: true,
    ...(options?.iconPath ? { icon: path.resolve(options.iconPath) } : {}),
    webPreferences: {
      preload: path.resolve(preloadPath),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: Boolean(options?.isDev),
    },
  };
}

/**
 * Validates whether a renderer navigation URL is permitted inside the offline desktop shell.
 */
export function isAllowedRendererNavigation(
  targetUrl: string,
  isDev: boolean,
  devServerOrigin = 'http://localhost:3000'
): boolean {
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

/**
 * Builds strict Content-Security-Policy header for the desktop renderer.
 * Allows blob:/data: URLs for embedded PDF/image document previews while blocking all external origins.
 */
export function buildDesktopCspHeader(isDev: boolean, devServerOrigin = 'http://localhost:3000'): string {
  const wsOrigin = isDev && devServerOrigin ? devServerOrigin.replace(/^http/i, 'ws') : '';
  const connectSources = isDev && devServerOrigin ? `'self' ${devServerOrigin} ${wsOrigin}` : `'self'`;
  const scriptSources = isDev ? `'self' 'unsafe-inline'` : `'self'`;

  return [
    `default-src 'self'`,
    `script-src ${scriptSources}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src ${connectSources}`,
    `frame-src 'self' blob:`,
    `object-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ');
}
