import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
  latestVersion: string;
}

export function listMigrationFiles(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Executes ordered SQL migrations inside explicit transactions and records SHA-256 checksums.
 * If existing tables are present and new migrations are pending, runs `onBeforeApply` first
 * (used to automatically snapshot the database prior to schema changes).
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string,
  options?: { onBeforeApply?: (pendingFiles: string[]) => void }
): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const files = listMigrationFiles(migrationsDir);
  const appliedStmt = db.prepare<[], { version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations'
  );
  const existingRows = appliedStmt.all();
  const existing = new Map(existingRows.map((row) => [row.version, row.checksum]));

  // Verify checksums and compute pending list before applying any new migration
  const pending: Array<{ file: string; version: string; sql: string; checksum: string }> = [];
  const alreadyApplied: string[] = [];

  for (const file of files) {
    const version = file.split('_')[0] || file;
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    const prevChecksum = existing.get(version);
    if (prevChecksum) {
      if (prevChecksum !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${file}: database has ${prevChecksum}, disk has ${checksum}`
        );
      }
      alreadyApplied.push(file);
    } else {
      pending.push({ file, version, sql, checksum });
    }
  }

  // Trigger pre-migration safety backup ONLY if database already had prior migrations/data
  if (pending.length > 0 && existingRows.length > 0 && options?.onBeforeApply) {
    options.onBeforeApply(pending.map((p) => p.file));
  }

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)'
  );
  const applied: string[] = [];

  for (const item of pending) {
    const applyTx = db.transaction(() => {
      db.exec(item.sql);
      insertMigration.run(item.version, item.file, item.checksum);
    });
    applyTx();
    applied.push(item.file);
  }

  const latestRow = db
    .prepare<[], { version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
    .get();

  return {
    applied,
    alreadyApplied,
    latestVersion: latestRow?.version ?? '000',
  };
}
