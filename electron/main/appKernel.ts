import path from 'node:path';
import type Database from 'better-sqlite3';
import { startBackupScheduler, type BackupSchedulerHandle } from '../backups/backupScheduler.ts';
import { createPreMigrationSnapshot } from '../backups/backupService.ts';
import { closeSqliteSafely, openSqliteConnection, resolveDatabasePath } from '../database/connection.ts';
import { runMigrations } from '../database/migrator.ts';
import { loadOrCreateVaultKey, type SafeStorageAdapter } from '../security/crypto.ts';
import { SessionStore } from '../security/sessionStore.ts';
import { createIpcHandlers, type IpcHandlerFn } from './ipcRouter.ts';
import type { DesktopPrintAdapter } from './printService.ts';

export interface DesktopKernelConfig {
  productionDbPath: string;
  migrationsDir: string;
  vaultRootDir: string;
  backupDir?: string;
  appVersion?: string;
  safeStorage?: SafeStorageAdapter | null;
  printAdapter?: DesktopPrintAdapter;
  enableAutoBackupScheduler?: boolean;
  pickBackupPath?: (options: {
    mode: 'save' | 'open';
    defaultFileName?: string;
  }) => Promise<{ canceled: boolean; filePath: string | null }>;
}

export interface DesktopKernel {
  db: Database.Database;
  dbPath: string;
  vaultKey: Buffer;
  vaultProtectionMode: 'dpapi_safestorage' | 'local_file_0600';
  backupDir: string;
  sessionStore: SessionStore;
  handlers: Record<string, IpcHandlerFn>;
  shutdown: () => void;
}

/**
 * Boots the Electron desktop backend kernel:
 * 1. Resolves production SQLite path
 * 2. Opens SQLite with FK + WAL + synchronous=FULL + integrity check
 * 3. Creates pre-migration safety backup if migrations are pending on existing data, then runs migrations
 * 4. Initializes isolated desktop SessionStore + DPAPI-protected local vault key
 * 5. Registers validated IPC handlers and optional daily automatic backup scheduler
 */
export function startDesktopKernel(config: DesktopKernelConfig): DesktopKernel {
  const dbPath = resolveDatabasePath({
    scope: 'desktop_production',
    productionDbPath: config.productionDbPath,
  });
  const migrationsDir = path.resolve(config.migrationsDir);
  const backupDir = path.resolve(
    config.backupDir ?? path.join(path.dirname(path.dirname(dbPath)), 'backups')
  );
  const appVersion = config.appVersion ?? '1.0.0';

  let currentDb = openSqliteConnection(dbPath);
  runMigrations(currentDb, migrationsDir, {
    onBeforeApply: (pendingFiles) => {
      createPreMigrationSnapshot(currentDb, {
        dbPath,
        vaultRootDir: config.vaultRootDir,
        backupDir,
        pendingFiles,
      });
    },
  });

  const vaultInfo = loadOrCreateVaultKey(config.vaultRootDir, config.safeStorage);
  const sessionStore = new SessionStore('desktop');
  let scheduler: BackupSchedulerHandle | null = null;

  const kernelObj: DesktopKernel = {
    get db() {
      return currentDb;
    },
    dbPath,
    vaultKey: vaultInfo.key,
    vaultProtectionMode: vaultInfo.protectionMode,
    backupDir,
    sessionStore,
    handlers: {},
    shutdown: () => {
      scheduler?.stop();
      scheduler = null;
      closeSqliteSafely(currentDb);
    },
  };

  kernelObj.handlers = createIpcHandlers(
    currentDb,
    sessionStore,
    {
      vaultRootDir: config.vaultRootDir,
      vaultKey: vaultInfo.key,
      protectionMode: vaultInfo.protectionMode,
    },
    config.printAdapter,
    {
      dbPath,
      migrationsDir,
      backupDir,
      appVersion,
      onDatabaseReplaced: (nextDb) => {
        currentDb = nextDb;
      },
      pickBackupPath: config.pickBackupPath,
    }
  );

  if (config.enableAutoBackupScheduler) {
    scheduler = startBackupScheduler({
      getDb: () => currentDb,
      backupDir,
      vaultRootDir: config.vaultRootDir,
      vaultKey: vaultInfo.key,
      appVersion,
    });
  }

  return kernelObj;
}
