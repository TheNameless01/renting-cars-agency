import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  MaintenancePartInput,
  MaintenanceRecord,
  MaintenanceStatus,
  MaintenanceType,
  VehicleMaintenanceSchedule,
} from '../../../shared/types/domain.ts';
import { decryptBuffer, encryptBuffer, resolveConfinedPath } from '../../security/crypto.ts';
import { validateAndDecodeUpload } from '../../security/fileValidation.ts';
import { AuthError } from '../../security/rbac.ts';
import {
  getVehicleMaintenanceDueSummary,
  listOperationalAlerts,
  syncOperationalAlerts,
  type VehicleMaintenanceDueItem,
} from './alertService.ts';
import { writeAuditLog } from './auditService.ts';
import { checkVehicleAvailability, recomputeVehicleStatus } from './availabilityService.ts';
import { recordExpense } from './expenseService.ts';

function addDaysToDate(dateStr: string, days: number): string {
  const base = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateStr.slice(0, 10);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function generateMaintenanceNumber(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const row = db
    .prepare<[], { max_id: number }>('SELECT COALESCE(MAX(id), 0) AS max_id FROM maintenance_records')
    .get();
  const seq = (row?.max_id ?? 0) + 1;
  return `MNT-${year}-${String(seq).padStart(5, '0')}`;
}

function mapMaintenanceType(r: any): MaintenanceType {
  return {
    id: Number(r.id),
    code: r.code,
    nameFr: r.name_fr,
    nameAr: r.name_ar,
    defaultKmInterval: r.default_km_interval != null ? Number(r.default_km_interval) : null,
    defaultDayInterval: r.default_day_interval != null ? Number(r.default_day_interval) : null,
    kmWarningThreshold: Number(r.km_warning_threshold ?? 1000),
    dayWarningThreshold: Number(r.day_warning_threshold ?? 14),
    isActive: r.is_active === 1,
  };
}

function mapSchedule(r: any): VehicleMaintenanceSchedule {
  return {
    id: Number(r.id),
    vehicleId: Number(r.vehicle_id),
    maintenanceTypeId: Number(r.maintenance_type_id),
    kmInterval: r.km_interval != null ? Number(r.km_interval) : null,
    dayInterval: r.day_interval != null ? Number(r.day_interval) : null,
    kmWarningThreshold: Number(r.km_warning_threshold ?? 1000),
    dayWarningThreshold: Number(r.day_warning_threshold ?? 14),
    isActive: r.is_active === 1,
    notes: r.notes ?? null,
    updatedByUserId: r.updated_by_user_id != null ? Number(r.updated_by_user_id) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMaintenanceRecord(r: any): MaintenanceRecord & {
  vehicleLabel: string;
  vehicleMatricule: string;
  maintenanceTypeCode: string;
  maintenanceTypeNameFr: string;
  maintenanceTypeNameAr: string;
  supplierName: string | null;
  recordedByUsername: string;
  linkedExpenseId: number | null;
  linkedExpenseNumber: string | null;
  blockIsActive: boolean;
} {
  return {
    id: Number(r.id),
    recordNumber: r.record_number ?? `MNT-${r.id}`,
    vehicleId: Number(r.vehicle_id),
    maintenanceTypeId: Number(r.maintenance_type_id),
    supplierId: r.supplier_id != null ? Number(r.supplier_id) : null,
    status: (r.status ?? 'COMPLETED') as MaintenanceStatus,
    isEmergency: r.is_emergency === 1,
    workDescription: r.work_description,
    performedDate: r.performed_date,
    scheduledStartDate: r.scheduled_start_date ?? null,
    scheduledEndDate: r.scheduled_end_date ?? null,
    odometerKm: Number(r.odometer_km),
    nextDueDate: r.next_due_date ?? null,
    nextDueOdometerKm: r.next_due_odometer_km != null ? Number(r.next_due_odometer_km) : null,
    laborCostMinor: Number(r.labor_cost_minor ?? 0),
    partsCostMinor: Number(r.parts_cost_minor ?? 0),
    totalCostMinor: Number(r.total_cost_minor ?? 0),
    technicianName: r.technician_name ?? null,
    notes: r.notes ?? null,
    invoiceFilePath: r.invoice_file_path ?? null,
    invoiceOriginalName: r.invoice_original_name ?? null,
    invoiceMimeType: r.invoice_mime_type ?? null,
    blockedPeriodId: r.blocked_period_id != null ? Number(r.blocked_period_id) : null,
    partsConsumedLocked: r.parts_consumed_locked === 1,
    recordedByUserId: Number(r.recorded_by_user_id),
    completedAt: r.completed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    vehicleLabel: r.vehicle_label,
    vehicleMatricule: r.vehicle_matricule,
    maintenanceTypeCode: r.maintenance_type_code,
    maintenanceTypeNameFr: r.maintenance_type_name_fr,
    maintenanceTypeNameAr: r.maintenance_type_name_ar,
    supplierName: r.supplier_name ?? null,
    recordedByUsername: r.recorded_by_username,
    linkedExpenseId: r.linked_expense_id != null ? Number(r.linked_expense_id) : null,
    linkedExpenseNumber: r.linked_expense_number ?? null,
    blockIsActive: r.block_is_active === 1,
  };
}

export function listMaintenanceTypes(db: Database.Database, includeInactive = true): MaintenanceType[] {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return db
    .prepare<[], any>(`SELECT * FROM maintenance_types ${where} ORDER BY id ASC`)
    .all()
    .map(mapMaintenanceType);
}

export function upsertMaintenanceType(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    id?: number;
    code: string;
    nameFr: string;
    nameAr: string;
    defaultKmInterval?: number | null;
    defaultDayInterval?: number | null;
    kmWarningThreshold: number;
    dayWarningThreshold: number;
    isActive: boolean;
  }
): MaintenanceType {
  const tx = db.transaction(() => {
    const cleanCode = input.code.trim().toUpperCase().replace(/\s+/g, '_');
    if (input.id) {
      const existing = db.prepare<[number], any>('SELECT * FROM maintenance_types WHERE id = ?').get(input.id);
      if (!existing) throw new AuthError('NOT_FOUND', 'Type de maintenance introuvable');

      const dup = db
        .prepare<[string, number], { id: number }>('SELECT id FROM maintenance_types WHERE code = ? AND id != ?')
        .get(cleanCode, input.id);
      if (dup) throw new AuthError('CONFLICT', `Code type déjà utilisé: ${cleanCode}`);

      db.prepare(
        `UPDATE maintenance_types
         SET code = ?, name_fr = ?, name_ar = ?, default_km_interval = ?, default_day_interval = ?,
             km_warning_threshold = ?, day_warning_threshold = ?, is_active = ?
         WHERE id = ?`
      ).run(
        cleanCode,
        input.nameFr.trim(),
        input.nameAr.trim(),
        input.defaultKmInterval ?? null,
        input.defaultDayInterval ?? null,
        input.kmWarningThreshold,
        input.dayWarningThreshold,
        input.isActive ? 1 : 0,
        input.id
      );

      const updated = mapMaintenanceType(
        db.prepare<[number], any>('SELECT * FROM maintenance_types WHERE id = ?').get(input.id)
      );
      writeAuditLog(db, {
        userId: actor.id,
        usernameSnapshot: actor.username,
        operation: 'MAINTENANCE_TYPE_UPDATED',
        entityType: 'maintenance_types',
        entityId: input.id,
        previousValue: mapMaintenanceType(existing),
        newValue: updated,
      });
      syncOperationalAlerts(db);
      return updated;
    }

    const dup = db.prepare<[string], { id: number }>('SELECT id FROM maintenance_types WHERE code = ?').get(cleanCode);
    if (dup) throw new AuthError('CONFLICT', `Code type déjà utilisé: ${cleanCode}`);

    const res = db
      .prepare(
        `INSERT INTO maintenance_types (
          code, name_fr, name_ar, default_km_interval, default_day_interval,
          km_warning_threshold, day_warning_threshold, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cleanCode,
        input.nameFr.trim(),
        input.nameAr.trim(),
        input.defaultKmInterval ?? null,
        input.defaultDayInterval ?? null,
        input.kmWarningThreshold,
        input.dayWarningThreshold,
        input.isActive ? 1 : 0
      );

    const id = Number(res.lastInsertRowid);
    const created = mapMaintenanceType(
      db.prepare<[number], any>('SELECT * FROM maintenance_types WHERE id = ?').get(id)
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'MAINTENANCE_TYPE_CREATED',
      entityType: 'maintenance_types',
      entityId: id,
      newValue: created,
    });
    syncOperationalAlerts(db);
    return created;
  });

  return tx();
}

export function upsertVehicleMaintenanceSchedule(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    vehicleId: number;
    maintenanceTypeId: number;
    kmInterval?: number | null;
    dayInterval?: number | null;
    kmWarningThreshold: number;
    dayWarningThreshold: number;
    isActive: boolean;
    notes?: string | null;
  }
): { schedule: VehicleMaintenanceSchedule; dueItem: VehicleMaintenanceDueItem } {
  const tx = db.transaction(() => {
    const v = db.prepare<[number], { id: number }>('SELECT id FROM vehicles WHERE id = ?').get(input.vehicleId);
    if (!v) throw new AuthError('NOT_FOUND', 'Véhicule introuvable');
    const mt = db
      .prepare<[number], { id: number }>('SELECT id FROM maintenance_types WHERE id = ?')
      .get(input.maintenanceTypeId);
    if (!mt) throw new AuthError('NOT_FOUND', 'Type de maintenance introuvable');

    const existing = db
      .prepare<[number, number], any>(
        'SELECT * FROM vehicle_maintenance_schedules WHERE vehicle_id = ? AND maintenance_type_id = ?'
      )
      .get(input.vehicleId, input.maintenanceTypeId);

    let schedId: number;
    if (existing) {
      db.prepare(
        `UPDATE vehicle_maintenance_schedules
         SET km_interval = ?, day_interval = ?, km_warning_threshold = ?, day_warning_threshold = ?,
             is_active = ?, notes = ?, updated_by_user_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(
        input.kmInterval ?? null,
        input.dayInterval ?? null,
        input.kmWarningThreshold,
        input.dayWarningThreshold,
        input.isActive ? 1 : 0,
        input.notes?.trim() || null,
        actor.id,
        existing.id
      );
      schedId = Number(existing.id);
    } else {
      const res = db
        .prepare(
          `INSERT INTO vehicle_maintenance_schedules (
            vehicle_id, maintenance_type_id, km_interval, day_interval,
            km_warning_threshold, day_warning_threshold, is_active, notes, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.vehicleId,
          input.maintenanceTypeId,
          input.kmInterval ?? null,
          input.dayInterval ?? null,
          input.kmWarningThreshold,
          input.dayWarningThreshold,
          input.isActive ? 1 : 0,
          input.notes?.trim() || null,
          actor.id
        );
      schedId = Number(res.lastInsertRowid);
    }

    const schedule = mapSchedule(
      db.prepare<[number], any>('SELECT * FROM vehicle_maintenance_schedules WHERE id = ?').get(schedId)
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_MAINTENANCE_SCHEDULE_SAVED',
      entityType: 'vehicle_maintenance_schedules',
      entityId: schedId,
      previousValue: existing ? mapSchedule(existing) : null,
      newValue: schedule,
    });

    syncOperationalAlerts(db);
    const dueItem = getVehicleMaintenanceDueSummary(db, input.vehicleId).find(
      (d) => d.maintenanceTypeId === input.maintenanceTypeId
    )!;

    return { schedule, dueItem };
  });

  return tx();
}

export function listMaintenanceRecords(
  db: Database.Database,
  filters?: {
    vehicleId?: number;
    maintenanceTypeId?: number;
    status?: MaintenanceStatus | 'ALL';
    isEmergency?: boolean;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }
) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.vehicleId) {
    clauses.push('mr.vehicle_id = ?');
    params.push(filters.vehicleId);
  }
  if (filters?.maintenanceTypeId) {
    clauses.push('mr.maintenance_type_id = ?');
    params.push(filters.maintenanceTypeId);
  }
  if (filters?.status && filters.status !== 'ALL') {
    clauses.push('mr.status = ?');
    params.push(filters.status);
  }
  if (filters?.isEmergency) {
    clauses.push('mr.is_emergency = 1');
  }
  if (filters?.dateFrom) {
    clauses.push('substr(mr.performed_date, 1, 10) >= ?');
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters?.dateTo) {
    clauses.push('substr(mr.performed_date, 1, 10) <= ?');
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(COALESCE(mr.record_number, '') LIKE ? OR mr.work_description LIKE ? OR v.matricule LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR mt.name_fr LIKE ? OR COALESCE(s.name, '') LIKE ?)`
    );
    params.push(q, q, q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT mr.*,
              v.brand || ' ' || v.model || ' (' || v.matricule || ')' AS vehicle_label,
              v.matricule AS vehicle_matricule,
              mt.code AS maintenance_type_code,
              mt.name_fr AS maintenance_type_name_fr,
              mt.name_ar AS maintenance_type_name_ar,
              s.name AS supplier_name,
              u.username AS recorded_by_username,
              e.id AS linked_expense_id,
              e.expense_number AS linked_expense_number,
              COALESCE(vbp.is_active, 0) AS block_is_active
       FROM maintenance_records mr
       JOIN vehicles v ON v.id = mr.vehicle_id
       JOIN maintenance_types mt ON mt.id = mr.maintenance_type_id
       LEFT JOIN suppliers s ON s.id = mr.supplier_id
       JOIN users u ON u.id = mr.recorded_by_user_id
       LEFT JOIN expenses e ON e.maintenance_record_id = mr.id AND e.status = 'POSTED'
       LEFT JOIN vehicle_blocked_periods vbp ON vbp.id = mr.blocked_period_id
       ${where}
       ORDER BY mr.performed_date DESC, mr.id DESC`
    )
    .all(...params);

  return rows.map(mapMaintenanceRecord);
}

export function getMaintenanceRecordDetail(db: Database.Database, recordId: number) {
  const row = listMaintenanceRecords(db).find((r) => r.id === recordId);
  if (!row) throw new AuthError('NOT_FOUND', 'Intervention de maintenance introuvable');

  const parts = db
    .prepare<[number], any>(
      `SELECT mp.*, ip.part_code, ip.part_name
       FROM maintenance_parts mp
       JOIN inventory_parts ip ON ip.id = mp.part_id
       WHERE mp.maintenance_record_id = ?
       ORDER BY mp.id ASC`
    )
    .all(recordId)
    .map((p) => ({
      id: Number(p.id),
      maintenanceRecordId: Number(p.maintenance_record_id),
      partId: Number(p.part_id),
      partCode: p.part_code as string,
      partName: p.part_name as string,
      quantityUsed: Number(p.quantity_used),
      unitCostMinor: Number(p.unit_cost_minor),
      totalCostMinor: Number(p.total_cost_minor),
    }));

  const blockedPeriod = row.blockedPeriodId
    ? db
        .prepare<[number], any>('SELECT * FROM vehicle_blocked_periods WHERE id = ?')
        .get(row.blockedPeriodId)
    : null;

  return {
    record: row,
    parts,
    blockedPeriod: blockedPeriod
      ? {
          id: Number(blockedPeriod.id),
          startDate: blockedPeriod.start_date as string,
          endDate: blockedPeriod.end_date as string,
          isActive: blockedPeriod.is_active === 1,
          reason: blockedPeriod.reason as string,
        }
      : null,
  };
}

export function getVehicleMaintenanceOverview(db: Database.Database, vehicleId: number) {
  const v = db.prepare<[number], any>('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  if (!v) throw new AuthError('NOT_FOUND', 'Véhicule introuvable');

  const dueSummary = getVehicleMaintenanceDueSummary(db, vehicleId);
  const records = listMaintenanceRecords(db, { vehicleId });
  const alerts = listOperationalAlerts(db, { vehicleId, includeResolved: false });

  return {
    vehicleId: Number(v.id),
    currentOdometerKm: Number(v.current_odometer_km),
    status: v.status as string,
    dueSummary,
    records,
    alerts,
  };
}

function saveEncryptedInvoice(
  vaultRootDir: string,
  vaultKey: Buffer,
  doc: { originalFileName: string; mimeType: string; base64Data: string }
) {
  const validated = validateAndDecodeUpload({
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    base64Data: doc.base64Data,
  });
  const encrypted = encryptBuffer(validated.bytes, vaultKey);
  const opaqueName = `mnt_${crypto.randomUUID()}.enc`;
  const relPath = path.join('maintenance', opaqueName);
  const fullPath = resolveConfinedPath(vaultRootDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, encrypted, { mode: 0o600 });
  return {
    filePath: relPath,
    originalName: validated.safeFileName,
    mimeType: validated.mimeType,
  };
}

function computeNextDueDefaults(
  db: Database.Database,
  vehicleId: number,
  maintenanceTypeId: number,
  performedDate: string,
  odometerKm: number,
  explicitNextDate?: string | null,
  explicitNextKm?: number | null
): { nextDueDate: string | null; nextDueOdometerKm: number | null } {
  if (explicitNextDate !== undefined && explicitNextKm !== undefined) {
    return {
      nextDueDate: explicitNextDate || null,
      nextDueOdometerKm: explicitNextKm ?? null,
    };
  }

  const sched = db
    .prepare<[number, number], any>(
      'SELECT km_interval, day_interval, is_active FROM vehicle_maintenance_schedules WHERE vehicle_id = ? AND maintenance_type_id = ?'
    )
    .get(vehicleId, maintenanceTypeId);
  const mt = db
    .prepare<[number], any>('SELECT default_km_interval, default_day_interval FROM maintenance_types WHERE id = ?')
    .get(maintenanceTypeId);

  const kmInterval = sched ? sched.km_interval : mt?.default_km_interval;
  const dayInterval = sched ? sched.day_interval : mt?.default_day_interval;
  const isActive = sched ? sched.is_active === 1 : true;

  const computedDate =
    explicitNextDate !== undefined
      ? explicitNextDate || null
      : isActive && dayInterval != null
        ? addDaysToDate(performedDate, Number(dayInterval))
        : null;

  const computedKm =
    explicitNextKm !== undefined
      ? explicitNextKm ?? null
      : isActive && kmInterval != null
        ? odometerKm + Number(kmInterval)
        : null;

  return { nextDueDate: computedDate, nextDueOdometerKm: computedKm };
}

function syncMaintenanceExpenseOnce(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  params: {
    maintenanceRecordId: number;
    recordNumber: string;
    vehicleId: number;
    supplierId: number | null;
    totalCostMinor: number;
    performedDate: string;
    workDescription: string;
    financeCategory: 'MAINTENANCE' | 'REPAIRS';
    paymentMethod: 'CASH' | 'CCP' | 'BARIDIMOB' | 'BANK_TRANSFER' | 'OTHER';
    paymentReference?: string | null;
  }
) {
  if (params.totalCostMinor <= 0) return null;

  const existingPosted = db
    .prepare<[number], { id: number }>(
      "SELECT id FROM expenses WHERE maintenance_record_id = ? AND status = 'POSTED' LIMIT 1"
    )
    .get(params.maintenanceRecordId);

  if (existingPosted) {
    return existingPosted.id;
  }

  const exp = recordExpense(db, actor, vaultRootDir, vaultKey, {
    category: params.financeCategory,
    vehicleId: params.vehicleId,
    supplierId: params.supplierId,
    maintenanceRecordId: params.maintenanceRecordId,
    amountMinor: params.totalCostMinor,
    currency: 'DZD',
    expenseDate: params.performedDate.slice(0, 10),
    paymentMethod: params.paymentMethod,
    paymentReference: params.paymentReference ?? null,
    description: `${params.recordNumber} · ${params.workDescription}`,
  });

  return exp.id;
}

function syncMaintenancePartsRows(
  db: Database.Database,
  recordId: number,
  partsUsed: MaintenancePartInput[]
): number {
  const merged = new Map<number, { quantityUsed: number; unitCostOverride?: number }>();
  for (const item of partsUsed) {
    const existing = merged.get(item.partId);
    if (existing) {
      existing.quantityUsed += item.quantityUsed;
      if (item.unitCostMinor !== undefined) existing.unitCostOverride = item.unitCostMinor;
    } else {
      merged.set(item.partId, {
        quantityUsed: item.quantityUsed,
        unitCostOverride: item.unitCostMinor,
      });
    }
  }

  db.prepare('DELETE FROM maintenance_parts WHERE maintenance_record_id = ?').run(recordId);

  let computedPartsCost = 0;
  const insertStmt = db.prepare(
    `INSERT INTO maintenance_parts (
      maintenance_record_id, part_id, quantity_used, unit_cost_minor, total_cost_minor
    ) VALUES (?, ?, ?, ?, ?)`
  );

  for (const [partId, entry] of merged.entries()) {
    const part = db
      .prepare<[number], { id: number; part_code: string; part_name: string; unit_purchase_price_minor: number; is_archived: number }>(
        'SELECT id, part_code, part_name, unit_purchase_price_minor, COALESCE(is_archived, 0) AS is_archived FROM inventory_parts WHERE id = ?'
      )
      .get(partId);
    if (!part) throw new AuthError('NOT_FOUND', `Pièce détachée #${partId} introuvable`);
    if (part.is_archived === 1) {
      throw new AuthError('CONFLICT', `La pièce ${part.part_code} est archivée`);
    }

    const unitCost = entry.unitCostOverride !== undefined ? Number(entry.unitCostOverride) : Number(part.unit_purchase_price_minor ?? 0);
    const totalLine = unitCost * entry.quantityUsed;
    computedPartsCost += totalLine;
    insertStmt.run(recordId, partId, entry.quantityUsed, unitCost, totalLine);
  }

  return computedPartsCost;
}

function consumeLockedMaintenancePartsOnce(
  db: Database.Database,
  actor: { id: number; username: string },
  params: {
    recordId: number;
    recordNumber: string;
    vehicleId: number;
    performedDate: string;
  }
) {
  const rec = db
    .prepare<[number], { parts_consumed_locked: number }>('SELECT parts_consumed_locked FROM maintenance_records WHERE id = ?')
    .get(params.recordId);
  if (!rec || rec.parts_consumed_locked === 1) {
    return;
  }

  const rows = db
    .prepare<[number], { id: number; part_id: number; quantity_used: number; unit_cost_minor: number }>(
      'SELECT id, part_id, quantity_used, unit_cost_minor FROM maintenance_parts WHERE maintenance_record_id = ? ORDER BY id ASC'
    )
    .all(params.recordId);

  if (rows.length === 0) {
    return;
  }

  const movDate = params.performedDate.slice(0, 10);
  for (const row of rows) {
    const part = db
      .prepare<[number], { id: number; part_code: string; part_name: string; quantity_available: number }>(
        'SELECT id, part_code, part_name, quantity_available FROM inventory_parts WHERE id = ?'
      )
      .get(row.part_id);
    if (!part) {
      throw new AuthError('NOT_FOUND', `Pièce détachée #${row.part_id} introuvable`);
    }
    const available = Number(part.quantity_available ?? 0);
    const needed = Number(row.quantity_used);
    if (available < needed) {
      throw new AuthError(
        'CONFLICT',
        `Stock insuffisant pour ${part.part_code} (${part.part_name}) : disponible ${available}, requis ${needed}.`
      );
    }

    db.prepare(
      `UPDATE inventory_parts
       SET quantity_available = quantity_available - ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(needed, part.id);

    db.prepare(
      `INSERT INTO inventory_movements (
        part_id, movement_type, quantity_delta, unit_cost_minor,
        maintenance_record_id, vehicle_id, reference_code, movement_date,
        notes, recorded_by_user_id
      ) VALUES (?, 'MAINTENANCE_USE', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      part.id,
      -needed,
      Number(row.unit_cost_minor),
      params.recordId,
      params.vehicleId,
      params.recordNumber,
      movDate,
      `Consommation atelier (${params.recordNumber})`,
      actor.id
    );
  }

  db.prepare('UPDATE maintenance_records SET parts_consumed_locked = 1 WHERE id = ?').run(params.recordId);
}

export function createMaintenanceRecord(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
    vehicleId: number;
    maintenanceTypeId: number;
    supplierId?: number | null;
    status?: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
    isEmergency?: boolean;
    workDescription: string;
    performedDate: string;
    scheduledStartDate?: string | null;
    scheduledEndDate?: string | null;
    odometerKm: number;
    nextDueDate?: string | null;
    nextDueOdometerKm?: number | null;
    laborCostMinor?: number;
    partsCostMinor?: number;
    partsUsed?: MaintenancePartInput[];
    technicianName?: string | null;
    notes?: string | null;
    blockVehicle?: boolean;
    recordInFinance?: boolean;
    financeCategory?: 'MAINTENANCE' | 'REPAIRS';
    financeExpenseScope?: 'TOTAL' | 'LABOR_ONLY';
    paymentMethod?: 'CASH' | 'CCP' | 'BARIDIMOB' | 'BANK_TRANSFER' | 'OTHER';
    paymentReference?: string | null;
    invoiceDoc?: {
      originalFileName: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
      base64Data: string;
    } | null;
  }
) {
  const tx = db.transaction(() => {
    const vehicle = db
      .prepare<[number], any>('SELECT * FROM vehicles WHERE id = ? AND is_archived = 0')
      .get(input.vehicleId);
    if (!vehicle) throw new AuthError('NOT_FOUND', 'Véhicule introuvable ou archivé');

    const mt = db
      .prepare<[number], any>('SELECT * FROM maintenance_types WHERE id = ?')
      .get(input.maintenanceTypeId);
    if (!mt) throw new AuthError('NOT_FOUND', 'Type de maintenance introuvable');

    if (input.supplierId != null) {
      const sup = db.prepare<[number], { id: number }>('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId);
      if (!sup) throw new AuthError('NOT_FOUND', 'Fournisseur / Garage introuvable');
    }

    const status: MaintenanceStatus = input.status ?? 'COMPLETED';
    const laborCostMinor = Number(input.laborCostMinor ?? 0);
    const partsCostMinor = Number(input.partsCostMinor ?? 0);
    const totalCostMinor = laborCostMinor + partsCostMinor;

    if (
      input.scheduledStartDate &&
      input.scheduledEndDate &&
      Date.parse(input.scheduledEndDate) <= Date.parse(input.scheduledStartDate)
    ) {
      throw new AuthError('VALIDATION_ERROR', 'La date de fin prévue doit être postérieure au début');
    }

    const shouldBlock = Boolean(input.blockVehicle) && (status === 'SCHEDULED' || status === 'IN_PROGRESS');
    let blockedPeriodId: number | null = null;
    const recordNumber = generateMaintenanceNumber(db);

    if (shouldBlock) {
      const bStart =
        input.scheduledStartDate?.trim() ||
        (input.performedDate.length === 10 ? `${input.performedDate}T08:00` : input.performedDate);
      const bEnd =
        input.scheduledEndDate?.trim() ||
        `${addDaysToDate(bStart, 1)}T18:00`;

      const avail = checkVehicleAvailability(db, {
        vehicleId: input.vehicleId,
        startDate: bStart,
        endDate: bEnd,
        allowVehicleInMaintenance: true,
      });
      if (!avail.available) {
        throw new AuthError(
          'CONFLICT',
          `Impossible de bloquer le véhicule: ${avail.conflicts.map((c) => c.details).join(', ')}`
        );
      }

      const bRes = db
        .prepare(
          `INSERT INTO vehicle_blocked_periods (
            vehicle_id, block_type, start_date, end_date, reason, is_active, created_by_user_id
          ) VALUES (?, 'MAINTENANCE', ?, ?, ?, 1, ?)`
        )
        .run(
          input.vehicleId,
          bStart,
          bEnd,
          `${recordNumber} · ${mt.name_fr}: ${input.workDescription.trim()}`,
          actor.id
        );
      blockedPeriodId = Number(bRes.lastInsertRowid);
    }

    let nextDueDate = input.nextDueDate ?? null;
    let nextDueOdometerKm = input.nextDueOdometerKm ?? null;
    if (status === 'COMPLETED') {
      const defaults = computeNextDueDefaults(
        db,
        input.vehicleId,
        input.maintenanceTypeId,
        input.performedDate,
        input.odometerKm,
        input.nextDueDate,
        input.nextDueOdometerKm
      );
      nextDueDate = defaults.nextDueDate;
      nextDueOdometerKm = defaults.nextDueOdometerKm;
    }

    let invoiceFilePath: string | null = null;
    let invoiceOriginalName: string | null = null;
    let invoiceMimeType: string | null = null;
    if (input.invoiceDoc) {
      const savedDoc = saveEncryptedInvoice(vaultRootDir, vaultKey, input.invoiceDoc);
      invoiceFilePath = savedDoc.filePath;
      invoiceOriginalName = savedDoc.originalName;
      invoiceMimeType = savedDoc.mimeType;
    }

    const completedAt = status === 'COMPLETED' ? new Date().toISOString() : null;

    const res = db
      .prepare(
        `INSERT INTO maintenance_records (
          record_number, vehicle_id, maintenance_type_id, supplier_id, status, is_emergency,
          work_description, performed_date, scheduled_start_date, scheduled_end_date,
          odometer_km, next_due_date, next_due_odometer_km,
          labor_cost_minor, parts_cost_minor, total_cost_minor,
          technician_name, notes, invoice_file_path, invoice_original_name, invoice_mime_type,
          blocked_period_id, recorded_by_user_id, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
      )
      .run(
        recordNumber,
        input.vehicleId,
        input.maintenanceTypeId,
        input.supplierId ?? null,
        status,
        input.isEmergency ? 1 : 0,
        input.workDescription.trim(),
        input.performedDate,
        input.scheduledStartDate?.trim() || null,
        input.scheduledEndDate?.trim() || null,
        input.odometerKm,
        nextDueDate,
        nextDueOdometerKm,
        laborCostMinor,
        partsCostMinor,
        totalCostMinor,
        input.technicianName?.trim() || null,
        input.notes?.trim() || null,
        invoiceFilePath,
        invoiceOriginalName,
        invoiceMimeType,
        blockedPeriodId,
        actor.id,
        completedAt
      );

    const recordId = Number(res.lastInsertRowid);

    let effectivePartsCostMinor = partsCostMinor;
    if (input.partsUsed && input.partsUsed.length > 0) {
      effectivePartsCostMinor = syncMaintenancePartsRows(db, recordId, input.partsUsed);
      const recomputedTotal = laborCostMinor + effectivePartsCostMinor;
      db.prepare('UPDATE maintenance_records SET parts_cost_minor = ?, total_cost_minor = ? WHERE id = ?').run(
        effectivePartsCostMinor,
        recomputedTotal,
        recordId
      );
      if (status === 'COMPLETED') {
        consumeLockedMaintenancePartsOnce(db, actor, {
          recordId,
          recordNumber,
          vehicleId: input.vehicleId,
          performedDate: input.performedDate,
        });
      }
    }

    const effectiveTotalCostMinor = laborCostMinor + effectivePartsCostMinor;

    // Monotonic odometer update on vehicle
    db.prepare(
      `UPDATE vehicles
       SET current_odometer_km = MAX(current_odometer_km, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.odometerKm, input.vehicleId);

    recomputeVehicleStatus(db, input.vehicleId);

    const financeAmountMinor =
      input.financeExpenseScope === 'LABOR_ONLY' ? laborCostMinor : effectiveTotalCostMinor;
    if (input.recordInFinance && financeAmountMinor > 0) {
      syncMaintenanceExpenseOnce(db, actor, vaultRootDir, vaultKey, {
        maintenanceRecordId: recordId,
        recordNumber,
        vehicleId: input.vehicleId,
        supplierId: input.supplierId ?? null,
        totalCostMinor: financeAmountMinor,
        performedDate: input.performedDate,
        workDescription:
          input.financeExpenseScope === 'LABOR_ONLY'
            ? `${input.workDescription} (Main d'œuvre)`
            : input.workDescription,
        financeCategory: input.financeCategory ?? (input.isEmergency ? 'REPAIRS' : 'MAINTENANCE'),
        paymentMethod: input.paymentMethod ?? 'CASH',
        paymentReference: input.paymentReference ?? null,
      });
    }

    syncOperationalAlerts(db);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'MAINTENANCE_CREATED',
      entityType: 'maintenance_records',
      entityId: recordId,
      newValue: {
        recordNumber,
        vehicleId: input.vehicleId,
        maintenanceTypeId: input.maintenanceTypeId,
        status,
        isEmergency: Boolean(input.isEmergency),
        totalCostMinor: effectiveTotalCostMinor,
        partsCount: input.partsUsed?.length ?? 0,
        blockedPeriodId,
      },
    });

    return getMaintenanceRecordDetail(db, recordId);
  });

  return tx();
}

export function updateMaintenanceRecord(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
    recordId: number;
    status?: MaintenanceStatus;
    supplierId?: number | null;
    workDescription?: string;
    performedDate?: string;
    scheduledStartDate?: string | null;
    scheduledEndDate?: string | null;
    odometerKm?: number;
    nextDueDate?: string | null;
    nextDueOdometerKm?: number | null;
    laborCostMinor?: number;
    partsCostMinor?: number;
    partsUsed?: MaintenancePartInput[];
    technicianName?: string | null;
    notes?: string | null;
    blockVehicle?: boolean;
    recordInFinance?: boolean;
    financeCategory?: 'MAINTENANCE' | 'REPAIRS';
    financeExpenseScope?: 'TOTAL' | 'LABOR_ONLY';
    paymentMethod?: 'CASH' | 'CCP' | 'BARIDIMOB' | 'BANK_TRANSFER' | 'OTHER';
    paymentReference?: string | null;
    invoiceDoc?: {
      originalFileName: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
      base64Data: string;
    } | null;
  }
) {
  const tx = db.transaction(() => {
    const current = db
      .prepare<[number], any>('SELECT * FROM maintenance_records WHERE id = ?')
      .get(input.recordId);
    if (!current) throw new AuthError('NOT_FOUND', 'Intervention de maintenance introuvable');

    const nextStatus: MaintenanceStatus = input.status ?? (current.status as MaintenanceStatus);
    if (current.status === 'CANCELLED' && nextStatus !== 'CANCELLED') {
      throw new AuthError('CONFLICT', 'Une maintenance annulée ne peut pas être réouverte');
    }
    if (
      current.status === 'COMPLETED' &&
      (nextStatus === 'SCHEDULED' || nextStatus === 'IN_PROGRESS')
    ) {
      throw new AuthError('CONFLICT', 'Une maintenance clôturée ne peut pas repasser en cours');
    }

    if (input.supplierId != null) {
      const sup = db.prepare<[number], { id: number }>('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId);
      if (!sup) throw new AuthError('NOT_FOUND', 'Fournisseur / Garage introuvable');
    }

    const nextSupplierId = input.supplierId !== undefined ? input.supplierId : current.supplier_id;
    const nextWorkDesc = input.workDescription?.trim() || current.work_description;
    const nextPerformedDate = input.performedDate?.trim() || current.performed_date;
    const nextScheduledStart =
      input.scheduledStartDate !== undefined
        ? input.scheduledStartDate?.trim() || null
        : current.scheduled_start_date;
    const nextScheduledEnd =
      input.scheduledEndDate !== undefined
        ? input.scheduledEndDate?.trim() || null
        : current.scheduled_end_date;

    if (nextScheduledStart && nextScheduledEnd && Date.parse(nextScheduledEnd) <= Date.parse(nextScheduledStart)) {
      throw new AuthError('VALIDATION_ERROR', 'La date de fin prévue doit être postérieure au début');
    }

    const nextOdometerKm = input.odometerKm ?? Number(current.odometer_km);
    const nextLabor = input.laborCostMinor ?? Number(current.labor_cost_minor ?? 0);
    let nextParts = input.partsCostMinor ?? Number(current.parts_cost_minor ?? 0);
    const partsAlreadyLocked = current.parts_consumed_locked === 1;

    if (input.partsUsed !== undefined) {
      if (partsAlreadyLocked) {
        // Already consumed & locked: verify caller isn't modifying the parts payload silently
        const existingParts = db
          .prepare<[number], { part_id: number; quantity_used: number }>(
            'SELECT part_id, quantity_used FROM maintenance_parts WHERE maintenance_record_id = ?'
          )
          .all(input.recordId);
        const sameParts =
          existingParts.length === input.partsUsed.length &&
          input.partsUsed.every((pu) =>
            existingParts.some((ep) => ep.part_id === pu.partId && ep.quantity_used === pu.quantityUsed)
          );
        if (!sameParts) {
          throw new AuthError(
            'CONFLICT',
            'Les pièces détachées déjà déduites du stock sont verrouillées pour éviter toute double déduction.'
          );
        }
      } else {
        nextParts = syncMaintenancePartsRows(db, input.recordId, input.partsUsed);
      }
    }

    const nextTotal = nextLabor + nextParts;
    const recordNumber = current.record_number || `MNT-${current.id}`;

    // Next due computations on transition to COMPLETED
    let nextDueDate = input.nextDueDate !== undefined ? input.nextDueDate : current.next_due_date;
    let nextDueOdometerKm =
      input.nextDueOdometerKm !== undefined
        ? input.nextDueOdometerKm
        : current.next_due_odometer_km != null
          ? Number(current.next_due_odometer_km)
          : null;

    if (nextStatus === 'COMPLETED') {
      const defaults = computeNextDueDefaults(
        db,
        current.vehicle_id,
        current.maintenance_type_id,
        nextPerformedDate,
        nextOdometerKm,
        input.nextDueDate !== undefined ? input.nextDueDate : nextDueDate ?? undefined,
        input.nextDueOdometerKm !== undefined ? input.nextDueOdometerKm : nextDueOdometerKm ?? undefined
      );
      nextDueDate = defaults.nextDueDate;
      nextDueOdometerKm = defaults.nextDueOdometerKm;
    }

    let blockedPeriodId: number | null =
      current.blocked_period_id != null ? Number(current.blocked_period_id) : null;
    let releasedMaintenanceBlock = false;

    if (nextStatus === 'COMPLETED' || nextStatus === 'CANCELLED') {
      if (blockedPeriodId != null) {
        db.prepare(
          `UPDATE vehicle_blocked_periods
           SET is_active = 0, released_by_user_id = ?, released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND is_active = 1`
        ).run(actor.id, blockedPeriodId);
        releasedMaintenanceBlock = true;
      }
      if (current.status === 'IN_PROGRESS') {
        releasedMaintenanceBlock = true;
      }
    } else if (input.blockVehicle === false && blockedPeriodId != null) {
      db.prepare(
        `UPDATE vehicle_blocked_periods
         SET is_active = 0, released_by_user_id = ?, released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND is_active = 1`
      ).run(actor.id, blockedPeriodId);
      releasedMaintenanceBlock = true;
    } else if (input.blockVehicle === true) {
      const activeExisting =
        blockedPeriodId != null
          ? db
              .prepare<[number], { id: number; is_active: number }>(
                'SELECT id, is_active FROM vehicle_blocked_periods WHERE id = ?'
              )
              .get(blockedPeriodId)
          : null;

      if (!activeExisting || activeExisting.is_active === 0) {
        const bStart =
          nextScheduledStart ||
          (nextPerformedDate.length === 10 ? `${nextPerformedDate}T08:00` : nextPerformedDate);
        const bEnd = nextScheduledEnd || `${addDaysToDate(bStart, 1)}T18:00`;

        const avail = checkVehicleAvailability(db, {
          vehicleId: current.vehicle_id,
          startDate: bStart,
          endDate: bEnd,
          excludeMaintenanceId: current.id,
        });
        if (!avail.available) {
          throw new AuthError(
            'CONFLICT',
            `Impossible de bloquer le véhicule: ${avail.conflicts.map((c) => c.details).join(', ')}`
          );
        }

        const mt = db
          .prepare<[number], { name_fr: string }>('SELECT name_fr FROM maintenance_types WHERE id = ?')
          .get(current.maintenance_type_id);
        const bRes = db
          .prepare(
            `INSERT INTO vehicle_blocked_periods (
              vehicle_id, block_type, start_date, end_date, reason, is_active, created_by_user_id
            ) VALUES (?, 'MAINTENANCE', ?, ?, ?, 1, ?)`
          )
          .run(
            current.vehicle_id,
            bStart,
            bEnd,
            `${recordNumber} · ${mt?.name_fr ?? 'Maintenance'}: ${nextWorkDesc}`,
            actor.id
          );
        blockedPeriodId = Number(bRes.lastInsertRowid);
      }
    }

    let invoiceFilePath = current.invoice_file_path;
    let invoiceOriginalName = current.invoice_original_name;
    let invoiceMimeType = current.invoice_mime_type;
    if (input.invoiceDoc) {
      const savedDoc = saveEncryptedInvoice(vaultRootDir, vaultKey, input.invoiceDoc);
      invoiceFilePath = savedDoc.filePath;
      invoiceOriginalName = savedDoc.originalName;
      invoiceMimeType = savedDoc.mimeType;
    }

    const completedAt =
      nextStatus === 'COMPLETED' ? current.completed_at || new Date().toISOString() : current.completed_at;

    db.prepare(
      `UPDATE maintenance_records
       SET status = ?,
           supplier_id = ?,
           work_description = ?,
           performed_date = ?,
           scheduled_start_date = ?,
           scheduled_end_date = ?,
           odometer_km = ?,
           next_due_date = ?,
           next_due_odometer_km = ?,
           labor_cost_minor = ?,
           parts_cost_minor = ?,
           total_cost_minor = ?,
           technician_name = ?,
           notes = ?,
           invoice_file_path = ?,
           invoice_original_name = ?,
           invoice_mime_type = ?,
           blocked_period_id = ?,
           completed_at = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      nextStatus,
      nextSupplierId ?? null,
      nextWorkDesc,
      nextPerformedDate,
      nextScheduledStart,
      nextScheduledEnd,
      nextOdometerKm,
      nextDueDate ?? null,
      nextDueOdometerKm,
      nextLabor,
      nextParts,
      nextTotal,
      input.technicianName !== undefined ? input.technicianName?.trim() || null : current.technician_name,
      input.notes !== undefined ? input.notes?.trim() || null : current.notes,
      invoiceFilePath,
      invoiceOriginalName,
      invoiceMimeType,
      blockedPeriodId,
      completedAt,
      input.recordId
    );

    if (nextStatus === 'COMPLETED' && !partsAlreadyLocked) {
      consumeLockedMaintenancePartsOnce(db, actor, {
        recordId: input.recordId,
        recordNumber,
        vehicleId: current.vehicle_id,
        performedDate: nextPerformedDate,
      });
    }

    if (nextStatus !== 'CANCELLED') {
      db.prepare(
        `UPDATE vehicles
         SET current_odometer_km = MAX(current_odometer_km, ?),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(nextOdometerKm, current.vehicle_id);
    }

    recomputeVehicleStatus(db, current.vehicle_id, {
      releaseManualMaintenance: releasedMaintenanceBlock,
    });

    const financeAmountMinor =
      input.financeExpenseScope === 'LABOR_ONLY' ? nextLabor : nextTotal;
    if (input.recordInFinance && financeAmountMinor > 0 && nextStatus !== 'CANCELLED') {
      syncMaintenanceExpenseOnce(db, actor, vaultRootDir, vaultKey, {
        maintenanceRecordId: input.recordId,
        recordNumber,
        vehicleId: current.vehicle_id,
        supplierId: nextSupplierId ?? null,
        totalCostMinor: financeAmountMinor,
        performedDate: nextPerformedDate,
        workDescription:
          input.financeExpenseScope === 'LABOR_ONLY'
            ? `${nextWorkDesc} (Main d'œuvre)`
            : nextWorkDesc,
        financeCategory:
          input.financeCategory ?? (current.is_emergency === 1 ? 'REPAIRS' : 'MAINTENANCE'),
        paymentMethod: input.paymentMethod ?? 'CASH',
        paymentReference: input.paymentReference ?? null,
      });
    }

    syncOperationalAlerts(db);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation:
        nextStatus === 'COMPLETED' && current.status !== 'COMPLETED'
          ? 'MAINTENANCE_COMPLETED'
          : nextStatus === 'CANCELLED' && current.status !== 'CANCELLED'
            ? 'MAINTENANCE_CANCELLED'
            : 'MAINTENANCE_UPDATED',
      entityType: 'maintenance_records',
      entityId: input.recordId,
      previousValue: {
        status: current.status,
        odometerKm: current.odometer_km,
        totalCostMinor: current.total_cost_minor,
      },
      newValue: {
        status: nextStatus,
        odometerKm: nextOdometerKm,
        totalCostMinor: nextTotal,
        blockedPeriodId,
      },
    });

    return getMaintenanceRecordDetail(db, input.recordId);
  });

  return tx();
}

export function readMaintenanceInvoice(
  db: Database.Database,
  vaultRootDir: string,
  vaultKey: Buffer,
  recordId: number
) {
  const row = db
    .prepare<[number], any>('SELECT * FROM maintenance_records WHERE id = ?')
    .get(recordId);
  if (!row || !row.invoice_file_path) {
    throw new AuthError('NOT_FOUND', 'Facture de maintenance introuvable');
  }
  const fullPath = resolveConfinedPath(vaultRootDir, row.invoice_file_path);
  const encrypted = fs.readFileSync(fullPath);
  const plain = decryptBuffer(encrypted, vaultKey);
  return {
    id: Number(row.id),
    originalFileName: (row.invoice_original_name || `facture_maintenance_${row.id}.pdf`) as string,
    mimeType: (row.invoice_mime_type || 'application/pdf') as string,
    base64Data: plain.toString('base64'),
  };
}
