import type Database from 'better-sqlite3';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';
import { checkVehicleAvailability, recomputeVehicleStatus } from './availabilityService.ts';

function generateReservationNumber(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const countRow = db
    .prepare<[string], { cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM reservations WHERE reservation_number LIKE ?'
    )
    .get(`RES-${year}-%`);
  const seq = (countRow?.cnt ?? 0) + 1;
  return `RES-${year}-${String(seq).padStart(4, '0')}`;
}

export function listReservations(db: Database.Database, statusFilter?: string) {
  const where = statusFilter && statusFilter !== 'ALL' ? 'WHERE r.status = ?' : '';
  const params = statusFilter && statusFilter !== 'ALL' ? [statusFilter] : [];

  return db
    .prepare<string[], any>(
      `SELECT r.*, c.full_name AS customer_name, c.phone AS customer_phone,
              v.matricule, v.brand, v.model
       FROM reservations r
       JOIN customers c ON c.id = r.customer_id
       JOIN vehicles v ON v.id = r.vehicle_id
       ${where}
       ORDER BY r.start_date ASC, r.id DESC`
    )
    .all(...params)
    .map((r) => ({
      id: r.id,
      reservationNumber: r.reservation_number,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      vehicleId: r.vehicle_id,
      vehicleLabel: `${r.brand} ${r.model} (${r.matricule})`,
      startDate: r.start_date,
      expectedReturnDate: r.expected_return_date,
      estimatedTotalMinor: r.estimated_total_minor,
      status: r.status,
      notes: r.notes,
      createdAt: r.created_at,
    }));
}

export function createReservation(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    customerId: number;
    vehicleId: number;
    startDate: string;
    expectedReturnDate: string;
    estimatedTotalMinor: number;
    status: 'PENDING' | 'CONFIRMED';
    notes?: string | null;
  }
) {
  const tx = db.transaction(() => {
    const customer = db
      .prepare<[number], { id: number; is_archived: number }>(
        'SELECT id, is_archived FROM customers WHERE id = ?'
      )
      .get(input.customerId);
    if (!customer || customer.is_archived === 1) {
      throw new AuthError('NOT_FOUND', 'Client introuvable ou archivé');
    }

    const avail = checkVehicleAvailability(db, {
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.expectedReturnDate,
    });
    if (!avail.available) {
      throw new AuthError(
        'CONFLICT',
        `Véhicule indisponible: ${avail.conflicts.map((c) => c.details).join(' ; ')}`
      );
    }

    const reservationNumber = generateReservationNumber(db);
    const res = db
      .prepare(
        `INSERT INTO reservations (
          reservation_number, customer_id, vehicle_id, start_date, expected_return_date,
          estimated_total_minor, status, notes, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        reservationNumber,
        input.customerId,
        input.vehicleId,
        input.startDate,
        input.expectedReturnDate,
        input.estimatedTotalMinor,
        input.status,
        input.notes ?? null,
        actor.id
      );

    const id = Number(res.lastInsertRowid);
    recomputeVehicleStatus(db, input.vehicleId);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'RESERVATION_CREATED',
      entityType: 'reservations',
      entityId: id,
      newValue: { reservationNumber, ...input },
    });

    return listReservations(db).find((r) => r.id === id)!;
  });

  return tx();
}

export function updateReservationStatus(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    reservationId: number;
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
    notes?: string | null;
  }
) {
  const tx = db.transaction(() => {
    const current = db
      .prepare<[number], any>('SELECT * FROM reservations WHERE id = ?')
      .get(input.reservationId);
    if (!current) throw new AuthError('NOT_FOUND', 'Réservation introuvable');
    if (current.status === 'CONVERTED') {
      throw new AuthError('CONFLICT', 'Réservation déjà convertie en contrat');
    }

    if (input.status === 'CONFIRMED' && current.status !== 'CONFIRMED') {
      const avail = checkVehicleAvailability(db, {
        vehicleId: current.vehicle_id,
        startDate: current.start_date,
        endDate: current.expected_return_date,
        excludeReservationId: current.id,
      });
      if (!avail.available) {
        throw new AuthError(
          'CONFLICT',
          `Impossible de confirmer la réservation: ${avail.conflicts.map((c) => c.details).join(' ; ')}`
        );
      }
    }

    db.prepare(
      `UPDATE reservations
       SET status = ?, notes = COALESCE(?, notes), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.status, input.notes ?? null, input.reservationId);

    recomputeVehicleStatus(db, current.vehicle_id);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'RESERVATION_STATUS_UPDATED',
      entityType: 'reservations',
      entityId: input.reservationId,
      previousValue: { status: current.status },
      newValue: { status: input.status },
    });

    return listReservations(db).find((r) => r.id === input.reservationId)!;
  });

  return tx();
}
