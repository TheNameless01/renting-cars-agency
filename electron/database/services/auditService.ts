import type Database from 'better-sqlite3';
import type { AuditLogEntry } from '../../../shared/types/domain.ts';

export interface WriteAuditInput {
  userId: number | null;
  usernameSnapshot: string;
  operation: string;
  entityType: string;
  entityId?: string | number | null;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

export function writeAuditLog(db: Database.Database, input: WriteAuditInput): void {
  db.prepare(
    `INSERT INTO audit_logs (
      user_id, username_snapshot, operation, entity_type, entity_id,
      previous_value_json, new_value_json, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.userId,
    input.usernameSnapshot,
    input.operation,
    input.entityType,
    input.entityId != null ? String(input.entityId) : null,
    input.previousValue !== undefined ? JSON.stringify(input.previousValue) : null,
    input.newValue !== undefined ? JSON.stringify(input.newValue) : null,
    input.reason ?? null
  );
}

interface RawAuditRow {
  id: number;
  user_id: number | null;
  username_snapshot: string;
  operation: string;
  entity_type: string;
  entity_id: string | null;
  previous_value_json: string | null;
  new_value_json: string | null;
  reason: string | null;
  created_at: string;
}

export function listAuditLogs(
  db: Database.Database,
  options?: { limit?: number; entityType?: string; operation?: string }
): AuditLogEntry[] {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (options?.entityType) {
    clauses.push('entity_type = ?');
    params.push(options.entityType);
  }
  if (options?.operation) {
    clauses.push('operation = ?');
    params.push(options.operation);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);

  const rows = db
    .prepare<Array<string | number>, RawAuditRow>(
      `SELECT id, user_id, username_snapshot, operation, entity_type, entity_id,
              previous_value_json, new_value_json, reason, created_at
       FROM audit_logs
       ${where}
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(...params);

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    usernameSnapshot: r.username_snapshot,
    operation: r.operation,
    entityType: r.entity_type,
    entityId: r.entity_id,
    previousValueJson: r.previous_value_json,
    newValueJson: r.new_value_json,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}
