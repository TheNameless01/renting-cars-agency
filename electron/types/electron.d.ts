declare module 'electron' {
  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    title?: string;
    icon?: string;
    show?: boolean;
    autoHideMenuBar?: boolean;
    webPreferences?: {
      preload?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
      webSecurity?: boolean;
      allowRunningInsecureContent?: boolean;
      devTools?: boolean;
    };
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string): Promise<void>;
    show(): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: 'ready-to-show', listener: () => void): this;
    webContents: {
      on(event: 'will-navigate', listener: (event: { preventDefault: () => void }, url: string) => void): void;
      on(event: 'will-attach-webview', listener: (event: { preventDefault: () => void }) => void): void;
      setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
      print(options?: Record<string, unknown>, callback?: (success: boolean, failureReason: string) => void): void;
      getPrintersAsync?(): Promise<Array<{ name: string; displayName?: string; isDefault?: boolean }>>;
    };
    static getAllWindows(): BrowserWindow[];
    static getFocusedWindow(): BrowserWindow | null;
  }

  export const app: {
    whenReady(): Promise<void>;
    getPath(name: 'userData' | 'temp' | 'documents'): string;
    getAppPath(): string;
    getVersion(): string;
    quit(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  };

  export const safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
  };

  export const session: {
    defaultSession: {
      setPermissionRequestHandler(
        handler: (webContents: unknown, permission: string, callback: (permissionGranted: boolean) => void) => void
      ): void;
      setPermissionCheckHandler(handler: (webContents: unknown, permission: string) => boolean): void;
      webRequest: {
        onHeadersReceived(
          listener: (
            details: { responseHeaders?: Record<string, string[]> },
            callback: (resp: { responseHeaders?: Record<string, string[]> }) => void
          ) => void
        ): void;
      };
    };
  };

  export const dialog: {
    showSaveDialog(
      window: BrowserWindow | undefined,
      options: {
        title?: string;
        defaultPath?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }
    ): Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog(
      window: BrowserWindow | undefined,
      options: {
        title?: string;
        properties?: string[];
        filters?: Array<{ name: string; extensions: string[] }>;
      }
    ): Promise<{ canceled: boolean; filePaths: string[] }>;
  };

  export const ipcMain: {
    handle(channel: string, listener: (event: unknown, payload?: unknown) => Promise<unknown> | unknown): void;
    removeHandler(channel: string): void;
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: unknown): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, payload?: unknown): Promise<unknown>;
  };
}
