declare module 'electron' {
  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    title?: string;
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
    once(event: 'ready-to-show', listener: () => void): this;
    webContents: {
      on(event: 'will-navigate', listener: (event: { preventDefault: () => void }, url: string) => void): void;
      setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
    };
    static getAllWindows(): BrowserWindow[];
  }

  export const app: {
    whenReady(): Promise<void>;
    getPath(name: 'userData' | 'temp' | 'documents'): string;
    quit(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
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
