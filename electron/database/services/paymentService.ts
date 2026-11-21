import type Database from 'better-sqlite3';
import type { CurrencyCode, PaymentDirection, PaymentMethod } from '../../../shared/types/domain.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';
import { appendCashMovementIfOpenSession } from './cashRegisterService.ts';
import { getAllSettings } from './settingsService.ts';

function generatePaymentCodes(db: Database.Database) {
  const year = new Date().getUTCFullYear();
  const countRow = db.prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM contract_payments').get();
  const seq = (countRow?.cnt ?? 0) + 1;
  return {
    transactionCode: `TXN-${year}-${String(seq).padStart(5, '0')}`,
    receiptNumber: `REC-${year}-${String(seq).padStart(5, '0')}`,
  };
}

function mapPaymentRow(row: any) {
  return {
    id: row.id,
    transactionCode: row.transaction_code as string,
    receiptNumber: row.receipt_number as string,
    contractId: row.contract_id as number,
    contractNumber: row.contract_number as string,
    customerId: row.customer_id as number,
    customerName: row.customer_name as string,
    vehicleLabel: row.vehicle_label as string,
    direction: row.direction as PaymentDirection,
    method: row.method as PaymentMethod,
    paymentReference: (row.payment_reference ?? null) as string | null,
    amountMinor: Number(row.amount_minor),
    currency: row.currency as CurrencyCode,
    paymentDate: row.payment_date as string,
    description: (row.description ?? null) as string | null,
    recordedByUserId: row.recorded_by_user_id as number,
    recordedByUsername: row.recorded_by_username as string,
    reversalOfPaymentId: (row.reversal_of_payment_id ?? null) as number | null,
    reversedByPaymentId: (row.reversed_by_payment_id ?? null) as number | null,
    isReversed: row.reversed_by_payment_id != null,
    createdAt: row.created_at as string,
  };
}

export function listPayments(
  db: Database.Database,
  filters?: {
    contractId?: number;
    customerId?: number;
    method?: string;
    direction?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }
) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.contractId) {
    clauses.push('cp.contract_id = ?');
    params.push(filters.contractId);
  }
  if (filters?.customerId) {
    clauses.push('cp.customer_id = ?');
    params.push(filters.customerId);
  }
  if (filters?.method && filters.method !== 'ALL') {
    clauses.push('cp.method = ?');
    params.push(filters.method);
  }
  if (filters?.direction && filters.direction !== 'ALL') {
    clauses.push('cp.direction = ?');
    params.push(filters.direction);
  }
  if (filters?.dateFrom) {
    clauses.push('substr(cp.payment_date, 1, 10) >= ?');
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters?.dateTo) {
    clauses.push('substr(cp.payment_date, 1, 10) <= ?');
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(cp.transaction_code LIKE ? OR cp.receipt_number LIKE ? OR COALESCE(cp.payment_reference, '') LIKE ? OR rc.contract_number LIKE ? OR c.full_name LIKE ?)`
    );
    params.push(q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT cp.*,
              rc.contract_number,
              c.full_name AS customer_name,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label,
              u.username AS recorded_by_username,
              rev.id AS reversed_by_payment_id
       FROM contract_payments cp
       JOIN rental_contracts rc ON rc.id = cp.contract_id
       JOIN customers c ON c.id = cp.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       JOIN users u ON u.id = cp.recorded_by_user_id
       LEFT JOIN contract_payments rev ON rev.reversal_of_payment_id = cp.id
       ${where}
       ORDER BY cp.payment_date DESC, cp.id DESC`
    )
    .all(...params);

  return rows.map(mapPaymentRow);
}

export function getPaymentReceipt(db: Database.Database, paymentId: number) {
  const row = db
    .prepare<[number], any>(
      `SELECT cp.*,
              rc.contract_number, rc.total_contract_amount_minor, rc.start_date, rc.expected_return_date,
              c.full_name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label,
              u.username AS recorded_by_username, u.full_name AS recorded_by_full_name,
              rev.id AS reversed_by_payment_id
       FROM contract_payments cp
       JOIN rental_contracts rc ON rc.id = cp.contract_id
       JOIN customers c ON c.id = cp.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       JOIN users u ON u.id = cp.recorded_by_user_id
       LEFT JOIN contract_payments rev ON rev.reversal_of_payment_id = cp.id
       WHERE cp.id = ?`
    )
    .get(paymentId);

  if (!row) throw new AuthError('NOT_FOUND', 'Paiement introuvable');

  const totals = db
    .prepare<[number], { paid_net_minor: number }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0) AS paid_net_minor
       FROM contract_payments WHERE contract_id = ?`
    )
    .get(row.contract_id);

  const settings = getAllSettings(db);
  const paidNetMinor = Number(totals?.paid_net_minor ?? 0);
  const contractTotalMinor = Number(row.total_contract_amount_minor ?? 0);

  return {
    payment: mapPaymentRow(row),
    agency: {
      name: settings['agency.commercial_name'] || settings['agency.name'] || 'Agence Location',
      address: settings['agency.address'] || '',
      phone: settings['agency.phone'] || '',
      nif: settings['agency.nif'] || '',
      rc: settings['agency.rc'] || '',
    },
    contract: {
      id: row.contract_id as number,
      contractNumber: row.contract_number as string,
      vehicleLabel: row.vehicle_label as string,
      startDate: row.start_date as string,
      expectedReturnDate: row.expected_return_date as string,
      totalContractAmountMinor: contractTotalMinor,
      paidNetMinor,
      outstandingMinor: Math.max(0, contractTotalMinor - paidNetMinor),
    },
    customer: {
      id: row.customer_id as number,
      fullName: row.customer_name as string,
      phone: row.customer_phone as string,
      address: (row.customer_address ?? null) as string | null,
    },
    recordedByFullName: row.recorded_by_full_name as string,
  };
}

export function recordPayment(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    contractId: number;
    direction: PaymentDirection;
    method: PaymentMethod;
    paymentReference?: string | null;
    amountMinor: number;
    currency: CurrencyCode;
    paymentDate: string;
    description?: string | null;
  }
) {
  const tx = db.transaction(() => {
    const contract = db
      .prepare<[number], any>(
        `SELECT rc.*,
                COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                          FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor
         FROM rental_contracts rc
         WHERE rc.id = ?`
      )
      .get(input.contractId);

    if (!contract) throw new AuthError('NOT_FOUND', 'Contrat introuvable');
    if (contract.status === 'CANCELLED') {
      throw new AuthError('CONFLICT', 'Impossible d’enregistrer un paiement sur un contrat annulé');
    }
    if (input.currency !== contract.currency) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `La devise du paiement (${input.currency}) doit correspondre à celle du contrat (${contract.currency})`
      );
    }

    const totalAmountMinor = Number(contract.total_contract_amount_minor);
    const paidNetMinor = Number(contract.paid_net_minor ?? 0);

    if (input.direction === 'INFLOW') {
      const remaining = Math.max(0, totalAmountMinor - paidNetMinor);
      if (input.amountMinor > remaining) {
        throw new AuthError(
          'VALIDATION_ERROR',
          `Le montant (${input.amountMinor / 100}) dépasse le solde restant du contrat (${remaining / 100})`
        );
      }
    } else {
      if (input.amountMinor > paidNetMinor) {
        throw new AuthError(
          'VALIDATION_ERROR',
          `Le remboursement (${input.amountMinor / 100}) dépasse le net déjà encaissé (${paidNetMinor / 100})`
        );
      }
    }

    const codes = generatePaymentCodes(db);
    const res = db
      .prepare(
        `INSERT INTO contract_payments (
          transaction_code, receipt_number, contract_id, customer_id, direction, method,
          payment_reference, amount_minor, currency, payment_date, description, recorded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        codes.transactionCode,
        codes.receiptNumber,
        contract.id,
        contract.customer_id,
        input.direction,
        input.method,
        input.paymentReference?.trim() || null,
        input.amountMinor,
        input.currency,
        input.paymentDate,
        input.description?.trim() || (input.direction === 'REFUND' ? 'Remboursement client' : 'Paiement location'),
        actor.id
      );

    const paymentId = Number(res.lastInsertRowid);

    appendCashMovementIfOpenSession(db, {
      actorId: actor.id,
      currency: input.currency,
      paymentMethod: input.method,
      movementType: input.direction === 'INFLOW' ? 'PAYMENT_INFLOW' : 'PAYMENT_REFUND',
      amountMinor: input.amountMinor,
      paymentId,
      description: `${codes.receiptNumber} (${contract.contract_number})`,
    });

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: input.direction === 'INFLOW' ? 'PAYMENT_RECORDED' : 'PAYMENT_REFUNDED',
      entityType: 'contract_payments',
      entityId: paymentId,
      newValue: {
        transactionCode: codes.transactionCode,
        receiptNumber: codes.receiptNumber,
        contractId: contract.id,
        direction: input.direction,
        method: input.method,
        amountMinor: input.amountMinor,
      },
    });

    return getPaymentReceipt(db, paymentId);
  });

  return tx();
}

export function reversePayment(
  db: Database.Database,
  actor: { id: number; username: string },
  input: { paymentId: number; reason: string }
) {
  const tx = db.transaction(() => {
    const orig = db
      .prepare<[number], any>('SELECT * FROM contract_payments WHERE id = ?')
      .get(input.paymentId);
    if (!orig) throw new AuthError('NOT_FOUND', 'Paiement introuvable');
    if (orig.reversal_of_payment_id != null) {
      throw new AuthError('CONFLICT', 'Une écriture d’annulation ne peut pas être contre-passée');
    }

    const alreadyReversed = db
      .prepare<[number], { id: number }>(
        'SELECT id FROM contract_payments WHERE reversal_of_payment_id = ? LIMIT 1'
      )
      .get(orig.id);
    if (alreadyReversed) {
      throw new AuthError('CONFLICT', 'Ce paiement a déjà fait l’objet d’une contre-passation');
    }

    const contract = db
      .prepare<[number], any>(
        `SELECT rc.*,
                COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                          FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor
         FROM rental_contracts rc WHERE rc.id = ?`
      )
      .get(orig.contract_id);

    const reversalDirection: PaymentDirection = orig.direction === 'INFLOW' ? 'REFUND' : 'INFLOW';
    const paidNetMinor = Number(contract.paid_net_minor ?? 0);

    if (reversalDirection === 'REFUND' && orig.amount_minor > paidNetMinor) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Contre-passation impossible : le solde net encaissé du contrat deviendrait négatif'
      );
    }
    if (
      reversalDirection === 'INFLOW' &&
      paidNetMinor + orig.amount_minor > Number(contract.total_contract_amount_minor)
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Contre-passation impossible : le total encaissé dépasserait le total du contrat'
      );
    }

    const codes = generatePaymentCodes(db);
    const today = new Date().toISOString().slice(0, 10);

    const revRes = db
      .prepare(
        `INSERT INTO contract_payments (
          transaction_code, receipt_number, contract_id, customer_id, direction, method,
          payment_reference, amount_minor, currency, payment_date, description,
          recorded_by_user_id, reversal_of_payment_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        codes.transactionCode,
        codes.receiptNumber,
        orig.contract_id,
        orig.customer_id,
        reversalDirection,
        orig.method,
        orig.payment_reference,
        orig.amount_minor,
        orig.currency,
        today,
        `Annulation ${orig.receipt_number}: ${input.reason.trim()}`,
        actor.id,
        orig.id
      );

    const reversalId = Number(revRes.lastInsertRowid);

    appendCashMovementIfOpenSession(db, {
      actorId: actor.id,
      currency: orig.currency,
      paymentMethod: orig.method,
      movementType: reversalDirection === 'INFLOW' ? 'PAYMENT_INFLOW' : 'PAYMENT_REFUND',
      amountMinor: orig.amount_minor,
      paymentId: reversalId,
      description: `Annulation ${orig.receipt_number} (${contract.contract_number})`,
    });

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'PAYMENT_REVERSED',
      entityType: 'contract_payments',
      entityId: reversalId,
      previousValue: { originalPaymentId: orig.id, receiptNumber: orig.receipt_number },
      newValue: { reversalPaymentId: reversalId, receiptNumber: codes.receiptNumber },
      reason: input.reason.trim(),
    });

    return getPaymentReceipt(db, reversalId);
  });

  return tx();
}
