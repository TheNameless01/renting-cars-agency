import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Executes ordered SQL migrations inside explicit transactions and records SHA-256 checksums.
 */
export function runMigrations(db: Database.Database, migrationsDir: string): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const appliedStmt = db.prepare<[], { version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations'
  );
  const existing = new Map(appliedStmt.all().map((row) => [row.version, row.checksum]));

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)'
  );

  const applied: string[] = [];
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
      continue;
    }

    const applyTx = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(version, file, checksum);
    });
    applyTx();
    applied.push(file);
  }

  return { applied, alreadyApplied };
}
