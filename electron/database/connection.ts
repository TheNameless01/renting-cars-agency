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
 * Opens a configured SQLite connection with foreign keys, WAL journal mode, and busy timeout.
 */
export function openSqliteConnection(dbFilePath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const db = new Database(dbFilePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  const fkEnabled = db.pragma('foreign_keys', { simple: true });
  if (fkEnabled !== 1) {
    db.close();
    throw new Error('Failed to enforce SQLite PRAGMA foreign_keys = ON');
  }

  return db;
}
