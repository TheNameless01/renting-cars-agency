import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DatabaseRuntimeScope = 'desktop_production' | 'browser_preview_temp';

export interface DatabaseConnectionOptions {
  scope: DatabaseRuntimeScope;
  /**
   * Required for desktop_production (e.g. app.getPath('userData')/data/agency_erp.db).
   * Ignored for browser_preview_temp, which is strictly confined to os.tmpdir().
   */
  productionDbPath?: string;
}

/**
 * Resolves the safe SQLite file path.
 * SECURITY INVARIANT: browser_preview_temp MUST NEVER point to any production desktop database file.
 */
export function resolveDatabasePath(options: DatabaseConnectionOptions): string {
  if (options.scope === 'browser_preview_temp') {
    const tempDir = path.join(os.tmpdir(), 'algeria_car_rental_erp_preview');
    fs.mkdirSync(tempDir, { recursive: true });
    return path.join(tempDir, 'preview_isolated.sqlite');
  }

  if (!options.productionDbPath) {
    throw new Error('productionDbPath is required for desktop_production database scope');
  }

  const resolved = path.resolve(options.productionDbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

/**
 * Opens a configured SQLite connection with foreign keys, WAL journal mode, FULL durability, and busy timeout.
 * Never truncates or resets an existing database file on error.
 */
export function openSqliteConnection(dbFilePath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const existed = fs.existsSync(dbFilePath) && fs.statSync(dbFilePath).size > 0;
  const db = new Database(dbFilePath);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('wal_autocheckpoint = 1000');
    db.pragma('temp_store = MEMORY');
    db.pragma('busy_timeout = 5000');

    const fkEnabled = db.pragma('foreign_keys', { simple: true });
    if (fkEnabled !== 1) {
      throw new Error('Failed to enforce SQLite PRAGMA foreign_keys = ON');
    }

    if (existed) {
      const quick = db.pragma('quick_check(1)', { simple: true });
      if (String(quick).toLowerCase() !== 'ok') {
        throw new Error(`SQLite database corruption detected on open: ${String(quick)}`);
      }
    }
    return db;
  } catch (err) {
    try {
      if (db.open) db.close();
    } catch {
      // ignore secondary close error
    }
    throw err;
  }
}

/**
 * Flushes WAL frames cleanly into the main SQLite file and closes the handle.
 */
export function closeSqliteSafely(db: Database.Database | null | undefined): void {
  if (!db || !db.open) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // best-effort checkpoint even if read-only
  }
  db.close();
}
