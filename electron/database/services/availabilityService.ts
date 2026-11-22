import type Database from 'better-sqlite3';

export interface AvailabilityConflict {
  sourceType: 'VEHICLE_STATUS' | 'CONTRACT' | 'RESERVATION' | 'BLOCKED_PERIOD' | 'MAINTENANCE';
  sourceId: number | string;
  reference: string;
  startDate: string;
  endDate: string;
  details: string;
}

export interface AvailabilityCheckResult {
  available: boolean;
  conflicts: AvailabilityConflict[];
}

/**
 * Checks whether a vehicle is available over [startDate, endDate).
 * Accounts for:
 * - Vehicle archival or active MAINTENANCE status
 * - Overlapping active/confirmed/extended rental contracts (including extensions via expected_return_date)
 * - Overlapping pending/confirmed reservations
 * - Overlapping active vehicle_blocked_periods (maintenance / admin hold)
 * - Overlapping scheduled or in-progress maintenance_records
 */
export function checkVehicleAvailability(
  db: Database.Database,
  params: {
    vehicleId: number;
    startDate: string;
    endDate: string;
    excludeContractId?: number | null;
    excludeReservationId?: number | null;
    excludeBlockId?: number | null;
    excludeMaintenanceId?: number | null;
    allowVehicleInMaintenance?: boolean;
  }
): AvailabilityCheckResult {
  const {
    vehicleId,
    startDate,
    endDate,
    excludeContractId,
    excludeReservationId,
    excludeBlockId,
    excludeMaintenanceId,
    allowVehicleInMaintenance,
  } = params;
  const conflicts: AvailabilityConflict[] = [];

  if (Date.parse(endDate) <= Date.parse(startDate)) {
    return {
      available: false,
      conflicts: [
        {
          sourceType: 'VEHICLE_STATUS',
          sourceId: vehicleId,
          reference: 'INVALID_DATES',
          startDate,
          endDate,
          details: 'La date de fin doit être postérieure à la date de début',
        },
      ],
    };
  }

  const vehicle = db
    .prepare<[number], { id: number; matricule: string; status: string; is_archived: number }>(
      'SELECT id, matricule, status, is_archived FROM vehicles WHERE id = ?'
    )
    .get(vehicleId);

  if (!vehicle || vehicle.is_archived === 1) {
    conflicts.push({
      sourceType: 'VEHICLE_STATUS',
      sourceId: vehicleId,
      reference: vehicle?.matricule ?? String(vehicleId),
      startDate,
      endDate,
      details: 'Véhicule introuvable ou archivé',
    });
    return { available: false, conflicts };
  }

  if (vehicle.status === 'MAINTENANCE' && !allowVehicleInMaintenance && excludeMaintenanceId == null && excludeBlockId == null) {
    conflicts.push({
      sourceType: 'VEHICLE_STATUS',
      sourceId: vehicle.id,
      reference: vehicle.matricule,
      startDate,
      endDate,
      details: 'Véhicule actuellement en maintenance',
    });
  }

  // Overlapping rental contracts (CONFIRMED, ACTIVE, EXTENDED)
  const contractConflicts = db
    .prepare<
      [number, number, string, string],
      { id: number; contract_number: string; status: string; start_date: string; expected_return_date: string }
    >(
      `SELECT id, contract_number, status, start_date, expected_return_date
       FROM rental_contracts
       WHERE vehicle_id = ?
         AND id != ?
         AND status IN ('CONFIRMED', 'ACTIVE', 'EXTENDED')
         AND start_date < ?
         AND expected_return_date > ?`
    )
    .all(vehicleId, excludeContractId ?? -1, endDate, startDate);

  for (const c of contractConflicts) {
    conflicts.push({
      sourceType: 'CONTRACT',
      sourceId: c.id,
      reference: c.contract_number,
      startDate: c.start_date,
      endDate: c.expected_return_date,
      details: `Contrat ${c.contract_number} (${c.status})`,
    });
  }

  // Overlapping reservations (PENDING, CONFIRMED)
  const reservationConflicts = db
    .prepare<
      [number, number, string, string],
      { id: number; reservation_number: string; status: string; start_date: string; expected_return_date: string }
    >(
      `SELECT id, reservation_number, status, start_date, expected_return_date
       FROM reservations
       WHERE vehicle_id = ?
         AND id != ?
         AND status IN ('PENDING', 'CONFIRMED')
         AND start_date < ?
         AND expected_return_date > ?`
    )
    .all(vehicleId, excludeReservationId ?? -1, endDate, startDate);

  for (const r of reservationConflicts) {
    conflicts.push({
      sourceType: 'RESERVATION',
      sourceId: r.id,
      reference: r.reservation_number,
      startDate: r.start_date,
      endDate: r.expected_return_date,
      details: `Réservation ${r.reservation_number} (${r.status})`,
    });
  }

  // Overlapping blocked periods
  const blockConflicts = db
    .prepare<
      [number, number, string, string],
      { id: number; block_type: string; start_date: string; end_date: string; reason: string }
    >(
      `SELECT id, block_type, start_date, end_date, reason
       FROM vehicle_blocked_periods
       WHERE vehicle_id = ?
         AND id != ?
         AND is_active = 1
         AND start_date < ?
         AND end_date > ?`
    )
    .all(vehicleId, excludeBlockId ?? -1, endDate, startDate);

  for (const b of blockConflicts) {
    conflicts.push({
      sourceType: 'BLOCKED_PERIOD',
      sourceId: b.id,
      reference: b.block_type,
      startDate: b.start_date,
      endDate: b.end_date,
      details: b.reason,
    });
  }

  // Overlapping maintenance records not already represented by an active blocked period
  const maintConflicts = db
    .prepare<
      [number, number, string, string],
      {
        id: number;
        record_number: string | null;
        status: string;
        work_description: string;
        start_at: string;
        end_at: string;
      }
    >(
      `SELECT mr.id,
              mr.record_number,
              mr.status,
              mr.work_description,
              COALESCE(mr.scheduled_start_date, mr.performed_date) AS start_at,
              COALESCE(mr.scheduled_end_date, '9999-12-31T23:59:59Z') AS end_at
       FROM maintenance_records mr
       WHERE mr.vehicle_id = ?
         AND mr.id != ?
         AND mr.status IN ('SCHEDULED', 'IN_PROGRESS')
         AND (
           mr.blocked_period_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM vehicle_blocked_periods vbp
             WHERE vbp.id = mr.blocked_period_id AND vbp.is_active = 1
           )
         )
         AND (
           mr.scheduled_start_date IS NOT NULL
           OR mr.status = 'IN_PROGRESS'
         )
         AND COALESCE(mr.scheduled_start_date, mr.performed_date) < ?
         AND COALESCE(mr.scheduled_end_date, '9999-12-31T23:59:59Z') > ?`
    )
    .all(vehicleId, excludeMaintenanceId ?? -1, endDate, startDate);

  for (const m of maintConflicts) {
    conflicts.push({
      sourceType: 'MAINTENANCE',
      sourceId: m.id,
      reference: m.record_number ?? `MNT-${m.id}`,
      startDate: m.start_at,
      endDate: m.end_at,
      details: `${m.record_number ?? `MNT-${m.id}`}: ${m.work_description}`,
    });
  }

  return {
    available: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Derives and persists the authoritative vehicle status from active contracts, maintenance, blocks, and reservations.
 */
export function recomputeVehicleStatus(
  db: Database.Database,
  vehicleId: number,
  options?: { releaseManualMaintenance?: boolean }
): 'AVAILABLE' | 'RENTED' | 'RESERVED' | 'MAINTENANCE' {
  const vehicle = db
    .prepare<[number], { status: string }>('SELECT status FROM vehicles WHERE id = ?')
    .get(vehicleId);
  if (!vehicle) return 'AVAILABLE';

  const nowIso = new Date().toISOString();

  const activeContract = db
    .prepare<[number], { id: number }>(
      `SELECT id FROM rental_contracts
       WHERE vehicle_id = ? AND status IN ('ACTIVE', 'EXTENDED')
       LIMIT 1`
    )
    .get(vehicleId);

  let nextStatus: 'AVAILABLE' | 'RENTED' | 'RESERVED' | 'MAINTENANCE' = 'AVAILABLE';

  if (activeContract) {
    nextStatus = 'RENTED';
  } else {
    const activeMaintenanceBlock = db
      .prepare<[number, string, string], { id: number }>(
        `SELECT id FROM vehicle_blocked_periods
         WHERE vehicle_id = ? AND is_active = 1 AND block_type = 'MAINTENANCE'
           AND start_date <= ? AND end_date >= ?
         LIMIT 1`
      )
      .get(vehicleId, nowIso, nowIso);

    const activeMaintenanceRecord = db
      .prepare<[number, string, string], { id: number }>(
        `SELECT id FROM maintenance_records
         WHERE vehicle_id = ? AND status = 'IN_PROGRESS'
           AND (scheduled_start_date IS NULL OR scheduled_start_date <= ?)
           AND (scheduled_end_date IS NULL OR scheduled_end_date >= ?)
         LIMIT 1`
      )
      .get(vehicleId, nowIso, nowIso);

    const preserveManualMaint = !options?.releaseManualMaintenance && vehicle.status === 'MAINTENANCE';

    if (activeMaintenanceBlock || activeMaintenanceRecord || preserveManualMaint) {
      nextStatus = 'MAINTENANCE';
    } else {
      const confirmedContract = db
        .prepare<[number], { id: number }>(
          `SELECT id FROM rental_contracts
           WHERE vehicle_id = ? AND status = 'CONFIRMED'
           LIMIT 1`
        )
        .get(vehicleId);

      const activeReservation = db
        .prepare<[number], { id: number }>(
          `SELECT id FROM reservations
           WHERE vehicle_id = ? AND status IN ('PENDING', 'CONFIRMED')
           LIMIT 1`
        )
        .get(vehicleId);

      if (confirmedContract || activeReservation) {
        nextStatus = 'RESERVED';
      }
    }
  }

  db.prepare(
    `UPDATE vehicles SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  ).run(nextStatus, vehicleId);

  return nextStatus;
}

export interface CalendarTimelineEvent {
  eventType: 'CONTRACT' | 'RESERVATION' | 'BLOCKED_PERIOD' | 'MAINTENANCE';
  id: number;
  vehicleId: number;
  customerId: number | null;
  customerName: string | null;
  reference: string;
  status: string;
  startDate: string;
  endDate: string;
  actualReturnDate: string | null;
  notes: string | null;
}

export function getPlanningCalendar(
  db: Database.Database,
  rangeStart: string,
  rangeEnd: string
) {
  const vehicles = db
    .prepare<[], any>(
      `SELECT id, internal_code, matricule, brand, model, year, category, status, default_daily_rate_minor
       FROM vehicles
       WHERE is_archived = 0
       ORDER BY brand, model, matricule`
    )
    .all()
    .map((v) => ({
      id: v.id,
      internalCode: v.internal_code,
      matricule: v.matricule,
      brand: v.brand,
      model: v.model,
      year: v.year,
      category: v.category,
      status: v.status,
      defaultDailyRateMinor: v.default_daily_rate_minor,
    }));

  const contracts = db
    .prepare<[string, string], any>(
      `SELECT rc.id, rc.vehicle_id, rc.customer_id, c.full_name AS customer_name,
              rc.contract_number, rc.status, rc.start_date, rc.expected_return_date, rc.actual_return_date, rc.notes
       FROM rental_contracts rc
       JOIN customers c ON c.id = rc.customer_id
       WHERE rc.status IN ('DRAFT', 'CONFIRMED', 'ACTIVE', 'EXTENDED', 'COMPLETED')
         AND rc.start_date <= ?
         AND COALESCE(rc.actual_return_date, rc.expected_return_date) >= ?`
    )
    .all(rangeEnd, rangeStart);

  const reservations = db
    .prepare<[string, string], any>(
      `SELECT r.id, r.vehicle_id, r.customer_id, c.full_name AS customer_name,
              r.reservation_number, r.status, r.start_date, r.expected_return_date, r.notes
       FROM reservations r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('PENDING', 'CONFIRMED')
         AND r.start_date <= ?
         AND r.expected_return_date >= ?`
    )
    .all(rangeEnd, rangeStart);

  const blocks = db
    .prepare<[string, string], any>(
      `SELECT id, vehicle_id, block_type, start_date, end_date, reason
       FROM vehicle_blocked_periods
       WHERE is_active = 1
         AND start_date <= ?
         AND end_date >= ?`
    )
    .all(rangeEnd, rangeStart);

  const maintenances = db
    .prepare<[string, string], any>(
      `SELECT mr.id, mr.vehicle_id, mr.record_number, mr.status,
              COALESCE(mr.scheduled_start_date, mr.performed_date) AS start_date,
              COALESCE(mr.scheduled_end_date, mr.performed_date) AS end_date,
              mr.work_description
       FROM maintenance_records mr
       WHERE mr.status IN ('SCHEDULED', 'IN_PROGRESS')
         AND (
           mr.blocked_period_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM vehicle_blocked_periods vbp
             WHERE vbp.id = mr.blocked_period_id AND vbp.is_active = 1
           )
         )
         AND COALESCE(mr.scheduled_start_date, mr.performed_date) <= ?
         AND COALESCE(mr.scheduled_end_date, mr.performed_date) >= ?`
    )
    .all(rangeEnd, rangeStart);

  const events: CalendarTimelineEvent[] = [
    ...contracts.map((c) => ({
      eventType: 'CONTRACT' as const,
      id: c.id,
      vehicleId: c.vehicle_id,
      customerId: c.customer_id,
      customerName: c.customer_name,
      reference: c.contract_number,
      status: c.status,
      startDate: c.start_date,
      endDate: c.expected_return_date,
      actualReturnDate: c.actual_return_date,
      notes: c.notes,
    })),
    ...reservations.map((r) => ({
      eventType: 'RESERVATION' as const,
      id: r.id,
      vehicleId: r.vehicle_id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      reference: r.reservation_number,
      status: r.status,
      startDate: r.start_date,
      endDate: r.expected_return_date,
      actualReturnDate: null,
      notes: r.notes,
    })),
    ...blocks.map((b) => ({
      eventType: 'BLOCKED_PERIOD' as const,
      id: b.id,
      vehicleId: b.vehicle_id,
      customerId: null,
      customerName: null,
      reference: b.block_type,
      status: b.block_type,
      startDate: b.start_date,
      endDate: b.end_date,
      actualReturnDate: null,
      notes: b.reason,
    })),
    ...maintenances.map((m) => ({
      eventType: 'MAINTENANCE' as const,
      id: m.id,
      vehicleId: m.vehicle_id,
      customerId: null,
      customerName: null,
      reference: m.record_number || `MNT-${m.id}`,
      status: m.status,
      startDate: m.start_date,
      endDate: m.end_date,
      actualReturnDate: null,
      notes: m.work_description,
    })),
  ];

  return { vehicles, events };
}
