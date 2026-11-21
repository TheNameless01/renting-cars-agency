import type Database from 'better-sqlite3';
import { writeAuditLog } from './auditService.ts';

export interface WilayaRecord {
  code: string;
  nameFr: string;
  nameAr: string;
  isNewlyCreated2026: boolean;
  parentWilayaCode: string | null;
  decreeReference: string | null;
  effectiveYear: number;
  isActive: boolean;
  notes: string | null;
  updatedAt: string;
}

interface RawWilayaRow {
  code: string;
  name_fr: string;
  name_ar: string;
  is_newly_created_2026: number;
  parent_wilaya_code: string | null;
  decree_reference: string | null;
  effective_year: number;
  is_active: number;
  notes: string | null;
  updated_at: string;
}

function mapWilaya(row: RawWilayaRow): WilayaRecord {
  return {
    code: row.code,
    nameFr: row.name_fr,
    nameAr: row.name_ar,
    isNewlyCreated2026: row.is_newly_created_2026 === 1,
    parentWilayaCode: row.parent_wilaya_code,
    decreeReference: row.decree_reference,
    effectiveYear: row.effective_year,
    isActive: row.is_active === 1,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export function listWilayas(db: Database.Database, activeOnly = false): WilayaRecord[] {
  const sql = activeOnly
    ? 'SELECT * FROM wilayas WHERE is_active = 1 ORDER BY CAST(code AS INTEGER), code'
    : 'SELECT * FROM wilayas ORDER BY CAST(code AS INTEGER), code';
  return db.prepare<[], RawWilayaRow>(sql).all().map(mapWilaya);
}

export function upsertWilaya(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    code: string;
    nameFr: string;
    nameAr: string;
    isNewlyCreated2026: boolean;
    parentWilayaCode: string | null;
    decreeReference: string | null;
    effectiveYear: number;
    isActive: boolean;
    notes: string | null;
  }
): WilayaRecord {
  const tx = db.transaction(() => {
    const existing = db.prepare<[string], RawWilayaRow>('SELECT * FROM wilayas WHERE code = ?').get(input.code);

    db.prepare(
      `INSERT INTO wilayas (
        code, name_fr, name_ar, is_newly_created_2026, parent_wilaya_code,
        decree_reference, effective_year, is_active, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(code) DO UPDATE SET
        name_fr = excluded.name_fr,
        name_ar = excluded.name_ar,
        is_newly_created_2026 = excluded.is_newly_created_2026,
        parent_wilaya_code = excluded.parent_wilaya_code,
        decree_reference = excluded.decree_reference,
        effective_year = excluded.effective_year,
        is_active = excluded.is_active,
        notes = excluded.notes,
        updated_at = excluded.updated_at`
    ).run(
      input.code.trim(),
      input.nameFr.trim(),
      input.nameAr.trim(),
      input.isNewlyCreated2026 ? 1 : 0,
      input.parentWilayaCode || null,
      input.decreeReference || null,
      input.effectiveYear,
      input.isActive ? 1 : 0,
      input.notes || null
    );

    const updated = db.prepare<[string], RawWilayaRow>('SELECT * FROM wilayas WHERE code = ?').get(input.code.trim())!;

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: existing ? 'WILAYA_UPDATED' : 'WILAYA_CREATED',
      entityType: 'wilayas',
      entityId: input.code.trim(),
      previousValue: existing ? mapWilaya(existing) : null,
      newValue: mapWilaya(updated),
    });

    return mapWilaya(updated);
  });

  return tx();
}
