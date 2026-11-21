import type Database from 'better-sqlite3';
import { DEFAULT_TIMEZONE } from '../../../shared/constants/algeria.ts';
import type { CashMovementType, CashRegisterMovement, CashRegisterSession } from '../../../shared/types/domain.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';

export function getTodayAlgiersDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function mapCashSession(row: any): CashRegisterSession & {
  openedByUsername?: string;
  closedByUsername?: string | null;
} {
  return {
    id: row.id,
    sessionDate: row.session_date,
    status: row.status,
    openingBalanceMinor: Number(row.opening_balance_minor ?? 0),
    cashReceivedMinor: Number(row.cash_received_minor ?? 0),
    cashRefundedMinor: Number(row.cash_refunded_minor ?? 0),
    cashExpensesMinor: Number(row.cash_expenses_minor ?? 0),
    cashAdjustmentsMinor: Number(row.cash_adjustments_minor ?? 0),
    expectedClosingMinor: Number(row.expected_closing_minor ?? 0),
    actualClosingMinor: row.actual_closing_minor != null ? Number(row.actual_closing_minor) : null,
    discrepancyMinor: row.discrepancy_minor != null ? Number(row.discrepancy_minor) : null,
    openingNotes: row.opening_notes ?? null,
    discrepancyNotes: row.discrepancy_notes ?? null,
    openedByUserId: row.opened_by_user_id,
    closedByUserId: row.closed_by_user_id ?? null,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? null,
    openedByUsername: row.opened_by_username,
    closedByUsername: row.closed_by_username ?? null,
  };
}

function mapCashMovement(row: any): CashRegisterMovement & {
  recordedByUsername?: string;
  referenceCode?: string | null;
} {
  return {
    id: row.id,
    sessionId: row.session_id,
    movementType: row.movement_type as CashMovementType,
    amountMinor: Number(row.amount_minor ?? 0),
    paymentId: row.payment_id ?? null,
    depositMovementId: row.deposit_movement_id ?? null,
    expenseId: row.expense_id ?? null,
    description: row.description ?? null,
    recordedByUserId: row.recorded_by_user_id,
    createdAt: row.created_at,
    recordedByUsername: row.recorded_by_username,
    referenceCode: row.reference_code ?? null,
  };
}

export function getCashSessionMovements(db: Database.Database, sessionId: number) {
  const rows = db
    .prepare<[number], any>(
      `SELECT m.*,
              u.username AS recorded_by_username,
              COALESCE(cp.receipt_number, e.expense_number, rc.contract_number) AS reference_code
       FROM cash_register_movements m
       JOIN users u ON u.id = m.recorded_by_user_id
       LEFT JOIN contract_payments cp ON cp.id = m.payment_id
       LEFT JOIN expenses e ON e.id = m.expense_id
       LEFT JOIN deposit_movements dm ON dm.id = m.deposit_movement_id
       LEFT JOIN deposits d ON d.id = dm.deposit_id
       LEFT JOIN rental_contracts rc ON rc.id = d.contract_id
       WHERE m.session_id = ?
       ORDER BY m.id DESC`
    )
    .all(sessionId);

  return rows.map(mapCashMovement);
}

export function getCurrentCashSession(db: Database.Database) {
  const openRow = db
    .prepare<[], any>(
      `SELECT s.*, uo.username AS opened_by_username, uc.username AS closed_by_username
       FROM cash_register_sessions s
       JOIN users uo ON uo.id = s.opened_by_user_id
       LEFT JOIN users uc ON uc.id = s.closed_by_user_id
       WHERE s.status = 'OPEN'
       ORDER BY s.id DESC
       LIMIT 1`
    )
    .get();

  const lastClosed = db
    .prepare<[], { actual_closing_minor: number | null; expected_closing_minor: number; session_date: string }>(
      `SELECT actual_closing_minor, expected_closing_minor, session_date
       FROM cash_register_sessions
       WHERE status = 'CLOSED'
       ORDER BY session_date DESC, id DESC
       LIMIT 1`
    )
    .get();

  const suggestedOpeningBalanceMinor =
    lastClosed != null
      ? Number(lastClosed.actual_closing_minor ?? lastClosed.expected_closing_minor ?? 0)
      : 0;

  if (!openRow) {
    return {
      session: null,
      movements: [],
      suggestedOpeningBalanceMinor,
      lastClosedDate: lastClosed?.session_date ?? null,
    };
  }

  return {
    session: mapCashSession(openRow),
    movements: getCashSessionMovements(db, openRow.id),
    suggestedOpeningBalanceMinor,
    lastClosedDate: lastClosed?.session_date ?? null,
  };
}

export function listCashSessions(db: Database.Database, limit = 90) {
  const rows = db
    .prepare<[number], any>(
      `SELECT s.*, uo.username AS opened_by_username, uc.username AS closed_by_username
       FROM cash_register_sessions s
       JOIN users uo ON uo.id = s.opened_by_user_id
       LEFT JOIN users uc ON uc.id = s.closed_by_user_id
       ORDER BY s.session_date DESC, s.id DESC
       LIMIT ?`
    )
    .all(Math.max(1, Math.min(limit, 365)));

  return rows.map(mapCashSession);
}

export function getCashSessionDetail(db: Database.Database, sessionId: number) {
  const row = db
    .prepare<[number], any>(
      `SELECT s.*, uo.username AS opened_by_username, uc.username AS closed_by_username
       FROM cash_register_sessions s
       JOIN users uo ON uo.id = s.opened_by_user_id
       LEFT JOIN users uc ON uc.id = s.closed_by_user_id
       WHERE s.id = ?`
    )
    .get(sessionId);

  if (!row) throw new AuthError('NOT_FOUND', 'Session de caisse introuvable');
  return {
    session: mapCashSession(row),
    movements: getCashSessionMovements(db, sessionId),
  };
}

export function openCashSession(
  db: Database.Database,
  actor: { id: number; username: string },
  input: { sessionDate?: string; openingBalanceMinor: number; openingNotes?: string | null }
) {
  const tx = db.transaction(() => {
    const existingOpen = db
      .prepare<[], { id: number; session_date: string }>(
        "SELECT id, session_date FROM cash_register_sessions WHERE status = 'OPEN' LIMIT 1"
      )
      .get();
    if (existingOpen) {
      throw new AuthError(
        'CONFLICT',
        `Une session de caisse est déjà ouverte (${existingOpen.session_date}). Clôturez-la avant d’en ouvrir une nouvelle.`
      );
    }

    const sessionDate = input.sessionDate ?? getTodayAlgiersDate();
    const existingDate = db
      .prepare<[string], { id: number; status: string }>(
        'SELECT id, status FROM cash_register_sessions WHERE session_date = ?'
      )
      .get(sessionDate);
    if (existingDate) {
      throw new AuthError(
        'CONFLICT',
        `Une session de caisse existe déjà pour la date ${sessionDate} (${existingDate.status}).`
      );
    }

    const res = db
      .prepare(
        `INSERT INTO cash_register_sessions (
          session_date, status, opening_balance_minor, cash_received_minor,
          cash_refunded_minor, cash_expenses_minor, cash_adjustments_minor,
          expected_closing_minor, opening_notes, opened_by_user_id
        ) VALUES (?, 'OPEN', ?, 0, 0, 0, 0, ?, ?, ?)`
      )
      .run(sessionDate, input.openingBalanceMinor, input.openingBalanceMinor, input.openingNotes ?? null, actor.id);

    const sessionId = Number(res.lastInsertRowid);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CASH_SESSION_OPENED',
      entityType: 'cash_register_sessions',
      entityId: sessionId,
      newValue: { sessionDate, openingBalanceMinor: input.openingBalanceMinor },
      reason: input.openingNotes ?? null,
    });

    return getCashSessionDetail(db, sessionId);
  });

  return tx();
}

export function closeCashSession(
  db: Database.Database,
  actor: { id: number; username: string },
  input: { sessionId: number; actualClosingMinor: number; discrepancyNotes?: string | null }
) {
  const tx = db.transaction(() => {
    const row = db
      .prepare<[number], any>('SELECT * FROM cash_register_sessions WHERE id = ?')
      .get(input.sessionId);
    if (!row) throw new AuthError('NOT_FOUND', 'Session de caisse introuvable');
    if (row.status === 'CLOSED') {
      throw new AuthError('CONFLICT', 'Cette session de caisse est déjà clôturée et verrouillée');
    }

    const expectedClosing =
      Number(row.opening_balance_minor) +
      Number(row.cash_received_minor) -
      Number(row.cash_refunded_minor) -
      Number(row.cash_expenses_minor) +
      Number(row.cash_adjustments_minor ?? 0);

    const discrepancyMinor = input.actualClosingMinor - expectedClosing;

    db.prepare(
      `UPDATE cash_register_sessions
       SET status = 'CLOSED',
           expected_closing_minor = ?,
           actual_closing_minor = ?,
           discrepancy_minor = ?,
           discrepancy_notes = ?,
           closed_by_user_id = ?,
           closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      expectedClosing,
      input.actualClosingMinor,
      discrepancyMinor,
      input.discrepancyNotes ?? null,
      actor.id,
      input.sessionId
    );

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CASH_SESSION_CLOSED',
      entityType: 'cash_register_sessions',
      entityId: input.sessionId,
      newValue: {
        expectedClosingMinor: expectedClosing,
        actualClosingMinor: input.actualClosingMinor,
        discrepancyMinor,
      },
      reason: input.discrepancyNotes ?? null,
    });

    return getCashSessionDetail(db, input.sessionId);
  });

  return tx();
}

export function recordCashAdjustment(
  db: Database.Database,
  actor: { id: number; username: string },
  input: { sessionId: number; amountDeltaMinor: number; reason: string }
) {
  const tx = db.transaction(() => {
    const row = db
      .prepare<[number], any>('SELECT * FROM cash_register_sessions WHERE id = ?')
      .get(input.sessionId);
    if (!row) throw new AuthError('NOT_FOUND', 'Session de caisse introuvable');
    if (row.status === 'CLOSED') {
      throw new AuthError(
        'CONFLICT',
        'Impossible de modifier une session de caisse clôturée — les sessions fermées sont immuables'
      );
    }

    const nextExpected = Number(row.expected_closing_minor) + input.amountDeltaMinor;
    if (nextExpected < 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Ajustement refusé : le solde attendu de caisse ne peut pas devenir négatif'
      );
    }

    const nextAdjustments = Number(row.cash_adjustments_minor ?? 0) + input.amountDeltaMinor;
    const movRes = db
      .prepare(
        `INSERT INTO cash_register_movements (
          session_id, movement_type, amount_minor, description, recorded_by_user_id
        ) VALUES (?, 'ADJUSTMENT', ?, ?, ?)`
      )
      .run(input.sessionId, input.amountDeltaMinor, input.reason.trim(), actor.id);

    db.prepare(
      `UPDATE cash_register_sessions
       SET cash_adjustments_minor = ?, expected_closing_minor = ?
       WHERE id = ?`
    ).run(nextAdjustments, nextExpected, input.sessionId);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CASH_ADJUSTMENT_RECORDED',
      entityType: 'cash_register_movements',
      entityId: Number(movRes.lastInsertRowid),
      newValue: {
        sessionId: input.sessionId,
        amountDeltaMinor: input.amountDeltaMinor,
        expectedClosingMinor: nextExpected,
      },
      reason: input.reason.trim(),
    });

    return getCashSessionDetail(db, input.sessionId);
  });

  return tx();
}

/**
 * Atomically logs a cash movement into the currently OPEN cash register session (if any).
 * Guarantees CLOSED sessions are never modified and cash drawer balance never turns negative.
 */
export function appendCashMovementIfOpenSession(
  db: Database.Database,
  params: {
    actorId: number;
    currency: string;
    paymentMethod: string;
    movementType: CashMovementType;
    amountMinor: number;
    paymentId?: number | null;
    depositMovementId?: number | null;
    expenseId?: number | null;
    description: string;
  }
): number | null {
  if (params.paymentMethod !== 'CASH' || params.currency !== 'DZD' || params.amountMinor <= 0) {
    return null;
  }

  const openSession = db
    .prepare<[], any>("SELECT * FROM cash_register_sessions WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1")
    .get();
  if (!openSession) {
    return null;
  }

  let nextReceived = Number(openSession.cash_received_minor);
  let nextRefunded = Number(openSession.cash_refunded_minor);
  let nextExpenses = Number(openSession.cash_expenses_minor);
  const adjustments = Number(openSession.cash_adjustments_minor ?? 0);

  if (params.movementType === 'PAYMENT_INFLOW' || params.movementType === 'DEPOSIT_INFLOW') {
    nextReceived += params.amountMinor;
  } else if (params.movementType === 'PAYMENT_REFUND' || params.movementType === 'DEPOSIT_REFUND') {
    nextRefunded += params.amountMinor;
  } else if (params.movementType === 'EXPENSE') {
    nextExpenses += params.amountMinor;
  }

  const nextExpected =
    Number(openSession.opening_balance_minor) + nextReceived - nextRefunded - nextExpenses + adjustments;

  if (nextExpected < 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Solde de caisse insuffisant pour cette sortie en espèces (le solde de caisse ne peut pas être négatif)'
    );
  }

  const movRes = db
    .prepare(
      `INSERT INTO cash_register_movements (
        session_id, movement_type, amount_minor, payment_id, deposit_movement_id, expense_id, description, recorded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      openSession.id,
      params.movementType,
      params.amountMinor,
      params.paymentId ?? null,
      params.depositMovementId ?? null,
      params.expenseId ?? null,
      params.description,
      params.actorId
    );

  db.prepare(
    `UPDATE cash_register_sessions
     SET cash_received_minor = ?,
         cash_refunded_minor = ?,
         cash_expenses_minor = ?,
         expected_closing_minor = ?
     WHERE id = ?`
  ).run(nextReceived, nextRefunded, nextExpenses, nextExpected, openSession.id);

  return Number(movRes.lastInsertRowid);
}
