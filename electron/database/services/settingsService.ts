import type Database from 'better-sqlite3';
import { writeAuditLog } from './auditService.ts';

export interface SettingItem {
  key: string;
  group: string;
  value: string;
  updatedAt: string;
}

export function getAllSettings(db: Database.Database): Record<string, string> {
  const rows = db
    .prepare<[], { setting_key: string; setting_value: string }>(
      'SELECT setting_key, setting_value FROM application_settings ORDER BY setting_key'
    )
    .all();

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.setting_key] = row.setting_value;
  }
  return result;
}

export function listSettingItems(db: Database.Database): SettingItem[] {
  return db
    .prepare<[], { setting_key: string; setting_group: string; setting_value: string; updated_at: string }>(
      'SELECT setting_key, setting_group, setting_value, updated_at FROM application_settings ORDER BY setting_group, setting_key'
    )
    .all()
    .map((r) => ({
      key: r.setting_key,
      group: r.setting_group,
      value: r.setting_value,
      updatedAt: r.updated_at,
    }));
}

export function updateSettingsBatch(
  db: Database.Database,
  actor: { id: number; username: string },
  updates: Array<{ key: string; group: string; value: string }>
): Record<string, string> {
  const tx = db.transaction(() => {
    const previous = getAllSettings(db);
    const stmt = db.prepare(
      `INSERT INTO application_settings (setting_key, setting_group, setting_value, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_group = excluded.setting_group,
         setting_value = excluded.setting_value,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = excluded.updated_at`
    );

    const changed: Record<string, { before: string | undefined; after: string }> = {};
    for (const item of updates) {
      stmt.run(item.key, item.group, item.value, actor.id);
      if (previous[item.key] !== item.value) {
        changed[item.key] = { before: previous[item.key], after: item.value };
      }
    }

    if (Object.keys(changed).length > 0) {
      writeAuditLog(db, {
        userId: actor.id,
        usernameSnapshot: actor.username,
        operation: 'SETTINGS_UPDATED',
        entityType: 'application_settings',
        entityId: 'batch',
        previousValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.before])),
        newValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.after])),
      });
    }
  });

  tx();
  return getAllSettings(db);
}
