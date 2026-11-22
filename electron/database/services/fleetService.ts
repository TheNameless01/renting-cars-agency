import type Database from 'better-sqlite3';
import { STANDARD_ALGERIAN_MATRICULE_REGEX } from '../../../shared/constants/algeria.ts';
import type {
  Vehicle,
  VehicleDocument,
  VehicleDocType,
  VehicleFuelType,
  VehicleStatus,
  VehicleTransmission,
} from '../../../shared/types/domain.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';
import { checkVehicleAvailability, recomputeVehicleStatus } from './availabilityService.ts';

function mapVehicle(row: any): Vehicle {
  return {
    id: row.id,
    internalCode: row.internal_code,
    matricule: row.matricule,
    vin: row.vin,
    brand: row.brand,
    model: row.model,
    year: row.year,
    color: row.color,
    category: row.category,
    fuelType: row.fuel_type as VehicleFuelType,
    transmission: row.transmission as VehicleTransmission,
    seats: row.seats,
    currentOdometerKm: row.current_odometer_km,
    acquisitionDate: row.acquisition_date,
    acquisitionCostMinor: row.acquisition_cost_minor,
    defaultDailyRateMinor: row.default_daily_rate_minor,
    defaultWeeklyRateMinor: row.default_weekly_rate_minor,
    defaultMonthlyRateMinor: row.default_monthly_rate_minor,
    status: row.status as VehicleStatus,
    notes: row.notes,
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVehicleDoc(row: any): VehicleDocument {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    docType: row.doc_type as VehicleDocType,
    documentNumber: row.document_number,
    issueDate: row.issue_date,
    expirationDate: row.expiration_date,
    reminderDays: row.reminder_days,
    filePath: row.file_path,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateMatriculeAgainstSettings(db: Database.Database, matricule: string): void {
  const enforce = db
    .prepare<[], { setting_value: string }>(
      "SELECT setting_value FROM application_settings WHERE setting_key = 'business.enforce_matricule_regex'"
    )
    .get();
  if (enforce?.setting_value === 'false') return;

  const custom = db
    .prepare<[], { setting_value: string }>(
      "SELECT setting_value FROM application_settings WHERE setting_key = 'business.custom_matricule_regex'"
    )
    .get();

  const regex =
    custom?.setting_value && custom.setting_value.trim().length > 0
      ? new RegExp(custom.setting_value.trim())
      : STANDARD_ALGERIAN_MATRICULE_REGEX;

  if (!regex.test(matricule.trim())) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Format de matricule algérien invalide (ex: 00123-124-16): ${matricule}`
    );
  }
}

export function listVehicles(
  db: Database.Database,
  filters?: { search?: string; status?: string; category?: string; includeArchived?: boolean }
): Vehicle[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (!filters?.includeArchived) {
    clauses.push('is_archived = 0');
  }
  if (filters?.status && filters.status !== 'ALL') {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters?.category && filters.category !== 'ALL') {
    clauses.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push('(internal_code LIKE ? OR matricule LIKE ? OR brand LIKE ? OR model LIKE ? OR COALESCE(vin, \'\') LIKE ?)');
    params.push(q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(`SELECT * FROM vehicles ${where} ORDER BY id DESC`)
    .all(...params);

  return rows.map(mapVehicle);
}

export function getVehicleProfile(db: Database.Database, vehicleId: number) {
  const row = db.prepare<[number], any>('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  if (!row) {
    throw new AuthError('NOT_FOUND', 'Véhicule introuvable');
  }

  const documents = db
    .prepare<[number], any>('SELECT * FROM vehicle_documents WHERE vehicle_id = ? ORDER BY expiration_date ASC')
    .all(vehicleId)
    .map(mapVehicleDoc);

  const blockedPeriods = db
    .prepare<[number], any>(
      'SELECT * FROM vehicle_blocked_periods WHERE vehicle_id = ? ORDER BY start_date DESC'
    )
    .all(vehicleId)
    .map((b) => ({
      id: b.id,
      vehicleId: b.vehicle_id,
      blockType: b.block_type,
      startDate: b.start_date,
      endDate: b.end_date,
      reason: b.reason,
      isActive: b.is_active === 1,
      createdAt: b.created_at,
    }));

  const rentalHistory = db
    .prepare<[number], any>(
      `SELECT rc.*, c.full_name AS customer_name
       FROM rental_contracts rc
       JOIN customers c ON c.id = rc.customer_id
       WHERE rc.vehicle_id = ?
       ORDER BY rc.start_date DESC`
    )
    .all(vehicleId)
    .map((c) => ({
      id: c.id,
      contractNumber: c.contract_number,
      customerId: c.customer_id,
      customerName: c.customer_name,
      status: c.status,
      startDate: c.start_date,
      expectedReturnDate: c.expected_return_date,
      actualReturnDate: c.actual_return_date,
      totalContractAmountMinor: c.total_contract_amount_minor,
      currency: c.currency,
    }));

  const reservations = db
    .prepare<[number], any>(
      `SELECT r.*, c.full_name AS customer_name
       FROM reservations r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.vehicle_id = ?
       ORDER BY r.start_date DESC`
    )
    .all(vehicleId)
    .map((r) => ({
      id: r.id,
      reservationNumber: r.reservation_number,
      customerId: r.customer_id,
      customerName: r.customer_name,
      status: r.status,
      startDate: r.start_date,
      expectedReturnDate: r.expected_return_date,
      estimatedTotalMinor: r.estimated_total_minor,
    }));

  return {
    vehicle: mapVehicle(row),
    documents,
    blockedPeriods,
    rentalHistory,
    reservations,
  };
}

export function createVehicle(
  db: Database.Database,
  actor: { id: number; username: string },
  input: any
): Vehicle {
  validateMatriculeAgainstSettings(db, input.matricule);

  const tx = db.transaction(() => {
    const dupCode = db
      .prepare<[string], { id: number }>('SELECT id FROM vehicles WHERE internal_code = ?')
      .get(input.internalCode.trim());
    if (dupCode) {
      throw new AuthError('CONFLICT', `Code interne déjà utilisé: ${input.internalCode}`);
    }

    const dupMatricule = db
      .prepare<[string], { id: number }>('SELECT id FROM vehicles WHERE matricule = ?')
      .get(input.matricule.trim());
    if (dupMatricule) {
      throw new AuthError('CONFLICT', `Matricule déjà enregistré: ${input.matricule}`);
    }

    const vin = input.vin?.trim() ? input.vin.trim() : null;
    if (vin) {
      const dupVin = db.prepare<[string], { id: number }>('SELECT id FROM vehicles WHERE vin = ?').get(vin);
      if (dupVin) {
        throw new AuthError('CONFLICT', `Numéro de châssis (VIN) déjà enregistré: ${vin}`);
      }
    }

    const res = db
      .prepare(
        `INSERT INTO vehicles (
          internal_code, matricule, vin, brand, model, year, color, category,
          fuel_type, transmission, seats, current_odometer_km, acquisition_date,
          acquisition_cost_minor, default_daily_rate_minor, default_weekly_rate_minor,
          default_monthly_rate_minor, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?)`
      )
      .run(
        input.internalCode.trim(),
        input.matricule.trim(),
        vin,
        input.brand.trim(),
        input.model.trim(),
        input.year,
        input.color.trim(),
        input.category.trim(),
        input.fuelType,
        input.transmission,
        input.seats,
        input.currentOdometerKm,
        input.acquisitionDate || null,
        input.acquisitionCostMinor ?? null,
        input.defaultDailyRateMinor,
        input.defaultWeeklyRateMinor ?? null,
        input.defaultMonthlyRateMinor ?? null,
        input.notes ?? null
      );

    const newId = Number(res.lastInsertRowid);
    const created = mapVehicle(db.prepare<[number], any>('SELECT * FROM vehicles WHERE id = ?').get(newId));

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_CREATED',
      entityType: 'vehicles',
      entityId: newId,
      newValue: created,
    });

    return created;
  });

  return tx();
}

export function updateVehicle(
  db: Database.Database,
  actor: { id: number; username: string },
  input: any
): Vehicle {
  if (input.matricule) {
    validateMatriculeAgainstSettings(db, input.matricule);
  }

  const tx = db.transaction(() => {
    const existingRow = db.prepare<[number], any>('SELECT * FROM vehicles WHERE id = ?').get(input.id);
    if (!existingRow) {
      throw new AuthError('NOT_FOUND', 'Véhicule introuvable');
    }
    const prev = mapVehicle(existingRow);

    if (input.status && input.status !== prev.status) {
      const activeContract = db
        .prepare<[number], { contract_number: string }>(
          "SELECT contract_number FROM rental_contracts WHERE vehicle_id = ? AND status IN ('ACTIVE', 'EXTENDED') LIMIT 1"
        )
        .get(input.id);

      if (activeContract && input.status === 'AVAILABLE') {
        throw new AuthError(
          'CONFLICT',
          `Impossible de marquer le véhicule disponible: contrat actif ${activeContract.contract_number}`
        );
      }
      if (input.status === 'RENTED' && !activeContract) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Le statut Loué (RENTED) ne peut être défini manuellement sans contrat actif'
        );
      }
    }

    const nextVin = input.vin !== undefined ? (input.vin?.trim() || null) : prev.vin;
    db.prepare(
      `UPDATE vehicles SET
        internal_code = ?, matricule = ?, vin = ?, brand = ?, model = ?, year = ?,
        color = ?, category = ?, fuel_type = ?, transmission = ?, seats = ?,
        current_odometer_km = ?, acquisition_date = ?, acquisition_cost_minor = ?,
        default_daily_rate_minor = ?, default_weekly_rate_minor = ?, default_monthly_rate_minor = ?,
        status = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      input.internalCode?.trim() ?? prev.internalCode,
      input.matricule?.trim() ?? prev.matricule,
      nextVin,
      input.brand?.trim() ?? prev.brand,
      input.model?.trim() ?? prev.model,
      input.year ?? prev.year,
      input.color?.trim() ?? prev.color,
      input.category?.trim() ?? prev.category,
      input.fuelType ?? prev.fuelType,
      input.transmission ?? prev.transmission,
      input.seats ?? prev.seats,
      input.currentOdometerKm ?? prev.currentOdometerKm,
      input.acquisitionDate !== undefined ? input.acquisitionDate || null : prev.acquisitionDate,
      input.acquisitionCostMinor !== undefined ? input.acquisitionCostMinor : prev.acquisitionCostMinor,
      input.defaultDailyRateMinor ?? prev.defaultDailyRateMinor,
      input.defaultWeeklyRateMinor !== undefined ? input.defaultWeeklyRateMinor : prev.defaultWeeklyRateMinor,
      input.defaultMonthlyRateMinor !== undefined ? input.defaultMonthlyRateMinor : prev.defaultMonthlyRateMinor,
      input.status ?? prev.status,
      input.notes !== undefined ? input.notes : prev.notes,
      input.id
    );

    const updated = mapVehicle(db.prepare<[number], any>('SELECT * FROM vehicles WHERE id = ?').get(input.id));
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_UPDATED',
      entityType: 'vehicles',
      entityId: input.id,
      previousValue: prev,
      newValue: updated,
    });
    return updated;
  });

  return tx();
}

export function archiveVehicle(
  db: Database.Database,
  actor: { id: number; username: string },
  vehicleId: number
): void {
  const tx = db.transaction(() => {
    const existing = db.prepare<[number], any>('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
    if (!existing) throw new AuthError('NOT_FOUND', 'Véhicule introuvable');

    const activeOrReserved = db
      .prepare<[number], { id: number }>(
        "SELECT id FROM rental_contracts WHERE vehicle_id = ? AND status IN ('CONFIRMED', 'ACTIVE', 'EXTENDED') LIMIT 1"
      )
      .get(vehicleId);
    if (activeOrReserved) {
      throw new AuthError('CONFLICT', 'Impossible d’archiver un véhicule lié à un contrat actif ou confirmé');
    }

    db.prepare(
      "UPDATE vehicles SET is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ).run(vehicleId);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_ARCHIVED',
      entityType: 'vehicles',
      entityId: vehicleId,
      previousValue: { matricule: existing.matricule, isArchived: false },
      newValue: { isArchived: true },
    });
  });

  tx();
}

export function upsertVehicleDocument(
  db: Database.Database,
  actor: { id: number; username: string },
  input: any
): VehicleDocument {
  const tx = db.transaction(() => {
    const vehicle = db.prepare<[number], { id: number }>('SELECT id FROM vehicles WHERE id = ?').get(input.vehicleId);
    if (!vehicle) throw new AuthError('NOT_FOUND', 'Véhicule introuvable');

    let docId: number;
    if (input.id) {
      db.prepare(
        `UPDATE vehicle_documents SET
          doc_type = ?, document_number = ?, issue_date = ?, expiration_date = ?,
          reminder_days = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND vehicle_id = ?`
      ).run(
        input.docType,
        input.documentNumber || null,
        input.issueDate || null,
        input.expirationDate,
        input.reminderDays,
        input.notes || null,
        input.id,
        input.vehicleId
      );
      docId = input.id;
    } else {
      const res = db
        .prepare(
          `INSERT INTO vehicle_documents (
            vehicle_id, doc_type, document_number, issue_date, expiration_date, reminder_days, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.vehicleId,
          input.docType,
          input.documentNumber || null,
          input.issueDate || null,
          input.expirationDate,
          input.reminderDays,
          input.notes || null
        );
      docId = Number(res.lastInsertRowid);
    }

    const saved = mapVehicleDoc(
      db.prepare<[number], any>('SELECT * FROM vehicle_documents WHERE id = ?').get(docId)
    );

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_DOCUMENT_SAVED',
      entityType: 'vehicle_documents',
      entityId: docId,
      newValue: saved,
    });

    return saved;
  });

  return tx();
}

export function createVehicleBlockedPeriod(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    vehicleId: number;
    blockType: 'MAINTENANCE' | 'ADMIN_HOLD' | 'OTHER';
    startDate: string;
    endDate: string;
    reason: string;
  }
) {
  const tx = db.transaction(() => {
    const avail = checkVehicleAvailability(db, {
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    if (!avail.available) {
      throw new AuthError(
        'CONFLICT',
        `Période en conflit: ${avail.conflicts.map((c) => c.details).join(', ')}`
      );
    }

    const res = db
      .prepare(
        `INSERT INTO vehicle_blocked_periods (
          vehicle_id, block_type, start_date, end_date, reason, is_active, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(input.vehicleId, input.blockType, input.startDate, input.endDate, input.reason.trim(), actor.id);

    const blockId = Number(res.lastInsertRowid);
    recomputeVehicleStatus(db, input.vehicleId);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_BLOCKED_PERIOD_CREATED',
      entityType: 'vehicle_blocked_periods',
      entityId: blockId,
      newValue: input,
    });

    return { id: blockId, ...input, isActive: true };
  });

  return tx();
}

export function releaseVehicleBlockedPeriod(
  db: Database.Database,
  actor: { id: number; username: string },
  blockId: number
) {
  const tx = db.transaction(() => {
    const block = db
      .prepare<[number], { id: number; vehicle_id: number; block_type: string; is_active: number }>(
        'SELECT id, vehicle_id, block_type, is_active FROM vehicle_blocked_periods WHERE id = ?'
      )
      .get(blockId);

    if (!block) throw new AuthError('NOT_FOUND', 'Période bloquée introuvable');
    if (block.is_active === 0) return;

    db.prepare(
      `UPDATE vehicle_blocked_periods
       SET is_active = 0, released_by_user_id = ?, released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(actor.id, blockId);

    recomputeVehicleStatus(db, block.vehicle_id, {
      releaseManualMaintenance: block.block_type === 'MAINTENANCE',
    });

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_BLOCKED_PERIOD_RELEASED',
      entityType: 'vehicle_blocked_periods',
      entityId: blockId,
    });
  });

  tx();
}
