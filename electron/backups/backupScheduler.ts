import type Database from 'better-sqlite3';
import { createBackup, pruneExpiredBackups } from './backupService.ts';

function readAppSetting(db: Database.Database, key: string, fallback: string): string {
  try {
    const row = db
      .prepare<[string], { setting_value: string }>(
        'SELECT setting_value FROM application_settings WHERE setting_key = ?'
      )
      .get(key);
    return row?.setting_value ?? fallback;
  } catch {
    return fallback;
  }
}

function parseDailyMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 22 * 60;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return h * 60 + min;
}

export async function runScheduledBackupIfDue(options: {
  getDb: () => Database.Database;
  backupDir: string;
  vaultRootDir: string;
  vaultKey: Buffer;
  appVersion: string;
  now?: Date;
}): Promise<{ executed: boolean; reason: string; prunedCount?: number }> {
  const db = options.getDb();
  if (!db.open) {
    return { executed: false, reason: 'db_closed' };
  }

  const enabled = readAppSetting(db, 'app.auto_backup_enabled', 'true') === 'true';
  if (!enabled) {
    return { executed: false, reason: 'disabled' };
  }

  const now = options.now ?? new Date();
  const targetMinutes = parseDailyMinutes(readAppSetting(db, 'app.auto_backup_time', '22:00'));
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (currentMinutes < targetMinutes) {
    return { executed: false, reason: 'before_scheduled_time' };
  }

  const todayPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const alreadyRanToday = db
    .prepare<[string], { cnt: number }>(
      `SELECT COUNT(*) AS cnt
       FROM backup_records
       WHERE backup_type = 'AUTO'
         AND status = 'SUCCESS'
         AND substr(created_at, 1, 10) = ?`
    )
    .get(todayPrefix);

  if ((alreadyRanToday?.cnt ?? 0) > 0) {
    return { executed: false, reason: 'already_completed_today' };
  }

  await createBackup(db, {
    backupDir: options.backupDir,
    vaultRootDir: options.vaultRootDir,
    vaultKey: options.vaultKey,
    appVersion: options.appVersion,
    backupType: 'AUTO',
    encryptionMode: 'VAULT_RECOVERY_KEY',
    notes: `Sauvegarde automatique planifiée (${todayPrefix})`,
    actor: { id: null, username: 'scheduler' },
  });

  const retention = Number(readAppSetting(db, 'app.backup_retention_count', '14')) || 14;
  const pruned = pruneExpiredBackups(db, retention);

  return {
    executed: true,
    reason: 'created',
    prunedCount: pruned.removedIds.length,
  };
}

export interface BackupSchedulerHandle {
  stop: () => void;
  triggerCheck: () => Promise<void>;
}

export function startBackupScheduler(options: {
  getDb: () => Database.Database;
  backupDir: string;
  vaultRootDir: string;
  vaultKey: Buffer;
  appVersion: string;
  intervalMs?: number;
}): BackupSchedulerHandle {
  let running = false;

  const triggerCheck = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledBackupIfDue(options);
    } catch {
      // Failures are automatically recorded to backup_records + audit_logs
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void triggerCheck();
  }, options.intervalMs ?? 60_000);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    triggerCheck,
  };
}
