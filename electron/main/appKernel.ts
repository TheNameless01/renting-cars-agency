import path from 'node:path';
import type Database from 'better-sqlite3';
import { openSqliteConnection, resolveDatabasePath } from '../database/connection.ts';
import { runMigrations } from '../database/migrator.ts';
import { getOrCreateLocalVaultKey } from '../security/crypto.ts';
import { SessionStore } from '../security/sessionStore.ts';
import { createIpcHandlers, type IpcHandlerFn } from './ipcRouter.ts';
import type { DesktopPrintAdapter } from './printService.ts';

export interface DesktopKernelConfig {
  productionDbPath: string;
  migrationsDir: string;
  vaultRootDir: string;
  printAdapter?: DesktopPrintAdapter;
}

export interface DesktopKernel {
  db: Database.Database;
  dbPath: string;
  vaultKey: Buffer;
  sessionStore: SessionStore;
  handlers: Record<string, IpcHandlerFn>;
  shutdown: () => void;
}

/**
 * Boots the Electron desktop backend kernel:
 * 1. Resolves production SQLite path
 * 2. Opens SQLite with FK + WAL enabled
 * 3. Runs versioned migrations
 * 4. Initializes isolated desktop SessionStore + local vault key
 * 5. Registers validated IPC handlers
 */
export function startDesktopKernel(config: DesktopKernelConfig): DesktopKernel {
  const dbPath = resolveDatabasePath({
    scope: 'desktop_production',
    productionDbPath: config.productionDbPath,
  });
  const db = openSqliteConnection(dbPath);
  runMigrations(db, path.resolve(config.migrationsDir));

  const vaultKey = getOrCreateLocalVaultKey(config.vaultRootDir);
  const sessionStore = new SessionStore('desktop');
  const handlers = createIpcHandlers(
    db,
    sessionStore,
    {
      vaultRootDir: config.vaultRootDir,
      vaultKey,
    },
    config.printAdapter
  );

  return {
    db,
    dbPath,
    vaultKey,
    sessionStore,
    handlers,
    shutdown: () => {
      if (db.open) {
        db.close();
      }
    },
  };
}
