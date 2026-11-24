import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  CurrencyCode,
  DepositChargeCategory,
  DepositStatus,
  PaymentMethod,
} from '../../../shared/types/domain.ts';
import { decryptBuffer, encryptBuffer, resolveConfinedPath } from '../../security/crypto.ts';
import { validateAndDecodeUpload } from '../../security/fileValidation.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';
import { appendCashMovementIfOpenSession } from './cashRegisterService.ts';

function mapDepositRow(r: any) {
  const amountMinor = Number(r.amount_minor ?? 0);
  const deductedAmountMinor = Number(r.deducted_amount_minor ?? 0);
  const refundedAmountMinor = Number(r.refunded_amount_minor ?? 0);
  return {
    id: r.id as number,
    contractId: r.contract_id as number,
    contractNumber: r.contract_number as string,
    contractStatus: r.contract_status as string,
    customerId: r.customer_id as number,
    customerName: r.customer_name as string,
    customerPhone: r.customer_phone as string,
    vehicleId: r.vehicle_id as number,
    vehicleLabel: r.vehicle_label as string,
    amountMinor,
    currency: r.currency as CurrencyCode,
    status: r.status as DepositStatus,
    receivedDate: r.received_date as string,
    returnedDate: (r.returned_date ?? null) as string | null,
    deductedAmountMinor,
    refundedAmountMinor,
    remainingHeldMinor: Math.max(0, amountMinor - deductedAmountMinor - refundedAmountMinor),
    deductionReason: (r.deduction_reason ?? null) as string | null,
    receivedMethod: (r.received_method ?? 'CASH') as PaymentMethod,
    refundMethod: (r.refund_method ?? null) as PaymentMethod | null,
    hasSupportingDoc: Boolean(r.supporting_doc_path),
    supportingDocOriginalName: (r.supporting_doc_original_name ?? null) as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function listDeposits(
  db: Database.Database,
  filters?: { status?: string; customerId?: number; search?: string }
) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.status && filters.status !== 'ALL') {
    clauses.push('d.status = ?');
    params.push(filters.status);
  }
  if (filters?.customerId) {
    clauses.push('d.customer_id = ?');
    params.push(filters.customerId);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push('(rc.contract_number LIKE ? OR c.full_name LIKE ? OR v.matricule LIKE ?)');
    params.push(q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT d.*,
              rc.contract_number, rc.status AS contract_status, rc.vehicle_id,
              c.full_name AS customer_name, c.phone AS customer_phone,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label
       FROM deposits d
       JOIN rental_contracts rc ON rc.id = d.contract_id
       JOIN customers c ON c.id = d.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       ${where}
       ORDER BY d.id DESC`
    )
    .all(...params);

  return rows.map(mapDepositRow);
}

export function listTrafficFines(
  db: Database.Database,
  filters?: { contractId?: number; customerId?: number }
) {
  const clauses: string[] = [];
  const params: number[] = [];

  if (filters?.contractId) {
    clauses.push('tf.contract_id = ?');
    params.push(filters.contractId);
  }
  if (filters?.customerId) {
    clauses.push('tf.customer_id = ?');
    params.push(filters.customerId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare<number[], any>(
      `SELECT tf.*,
              rc.contract_number,
              c.full_name AS customer_name,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label
       FROM traffic_fines tf
       LEFT JOIN rental_contracts rc ON rc.id = tf.contract_id
       JOIN customers c ON c.id = tf.customer_id
       JOIN vehicles v ON v.id = tf.vehicle_id
       ${where}
       ORDER BY tf.incurred_date DESC, tf.id DESC`
    )
    .all(...params)
    .map((r) => ({
      id: r.id as number,
      contractId: (r.contract_id ?? null) as number | null,
      contractNumber: (r.contract_number ?? null) as string | null,
      vehicleId: r.vehicle_id as number,
      vehicleLabel: r.vehicle_label as string,
      customerId: r.customer_id as number,
      customerName: r.customer_name as string,
      fineType: r.fine_type as 'TRAFFIC' | 'RADAR' | 'PARKING' | 'OTHER',
      referenceNumber: (r.reference_number ?? null) as string | null,
      incurredDate: r.incurred_date as string,
      amountMinor: Number(r.amount_minor),
      isPaidByCustomer: r.is_paid_by_customer === 1,
      notes: (r.notes ?? null) as string | null,
      createdAt: r.created_at as string,
    }));
}

export function createTrafficFine(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    contractId?: number | null;
    vehicleId: number;
    customerId: number;
    fineType: 'TRAFFIC' | 'RADAR' | 'PARKING' | 'OTHER';
    referenceNumber?: string | null;
    incurredDate: string;
    amountMinor: number;
    notes?: string | null;
  }
) {
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO traffic_fines (
          contract_id, vehicle_id, customer_id, fine_type, reference_number,
          incurred_date, amount_minor, is_paid_by_customer, notes, recorded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        input.contractId ?? null,
        input.vehicleId,
        input.customerId,
        input.fineType,
        input.referenceNumber?.trim() || null,
        input.incurredDate,
        input.amountMinor,
        input.notes?.trim() || null,
        actor.id
      );

    const fineId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'TRAFFIC_FINE_RECORDED',
      entityType: 'traffic_fines',
      entityId: fineId,
      newValue: input,
    });

    return listTrafficFines(db).find((f) => f.id === fineId)!;
  });

  return tx();
}

export function getDepositDetail(db: Database.Database, depositId: number) {
  const row = db
    .prepare<[number], any>(
      `SELECT d.*,
              rc.contract_number, rc.status AS contract_status, rc.vehicle_id,
              rc.damage_charge_minor, rc.late_fee_minor, rc.extra_km_charge_minor, rc.other_charges_minor,
              c.full_name AS customer_name, c.phone AS customer_phone,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label
       FROM deposits d
       JOIN rental_contracts rc ON rc.id = d.contract_id
       JOIN customers c ON c.id = d.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       WHERE d.id = ?`
    )
    .get(depositId);

  if (!row) throw new AuthError('NOT_FOUND', 'Caution introuvable');

  const movements = db
    .prepare<[number], any>(
      `SELECT dm.*, u.username AS recorded_by_username, tf.fine_type, tf.reference_number AS fine_reference
       FROM deposit_movements dm
       JOIN users u ON u.id = dm.recorded_by_user_id
       LEFT JOIN traffic_fines tf ON tf.id = dm.traffic_fine_id
       WHERE dm.deposit_id = ?
       ORDER BY dm.id ASC`
    )
    .all(depositId)
    .map((m) => ({
      id: m.id as number,
      depositId: m.deposit_id as number,
      movementType: m.movement_type as 'RECEIVED' | 'DEDUCTED' | 'REFUNDED' | 'ADJUSTMENT',
      amountMinor: Number(m.amount_minor),
      chargeCategory: (m.charge_category ?? null) as DepositChargeCategory | null,
      trafficFineId: (m.traffic_fine_id ?? null) as number | null,
      fineReference: (m.fine_reference ?? null) as string | null,
      paymentMethod: (m.payment_method ?? null) as PaymentMethod | null,
      reason: (m.reason ?? null) as string | null,
      recordedByUserId: m.recorded_by_user_id as number,
      recordedByUsername: m.recorded_by_username as string,
      createdAt: m.created_at as string,
    }));

  const fines = listTrafficFines(db, { contractId: row.contract_id });

  return {
    deposit: mapDepositRow(row),
    contractCharges: {
      damageChargeMinor: Number(row.damage_charge_minor ?? 0),
      lateFeeMinor: Number(row.late_fee_minor ?? 0),
      extraKmChargeMinor: Number(row.extra_km_charge_minor ?? 0),
      otherChargesMinor: Number(row.other_charges_minor ?? 0),
    },
    movements,
    fines,
  };
}

export function settleDeposit(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
    depositId: number;
    deductedAmountMinor: number;
    refundedAmountMinor: number;
    chargeCategory?: DepositChargeCategory | null;
    deductionReason?: string | null;
    refundMethod?: PaymentMethod;
    trafficFineId?: number | null;
    supportingDoc?: {
      originalFileName: string;
      mimeType: string;
      base64Data: string;
    } | null;
  }
) {
  const tx = db.transaction(() => {
    const dep = db.prepare<[number], any>('SELECT * FROM deposits WHERE id = ?').get(input.depositId);
    if (!dep) throw new AuthError('NOT_FOUND', 'Caution introuvable');

    const totalAmountMinor = Number(dep.amount_minor);
    const alreadyDeducted = Number(dep.deducted_amount_minor);
    const alreadyRefunded = Number(dep.refunded_amount_minor);
    const remainingHeld = Math.max(0, totalAmountMinor - alreadyDeducted - alreadyRefunded);

    if (input.deductedAmountMinor + input.refundedAmountMinor <= 0) {
      throw new AuthError('VALIDATION_ERROR', 'Indiquez un montant déduit et/ou remboursé supérieur à zéro');
    }

    if (input.deductedAmountMinor + input.refundedAmountMinor > remainingHeld) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `Total déduit + remboursé dépasse le solde retenu disponible (${remainingHeld / 100})`
      );
    }

    if (input.deductedAmountMinor > 0) {
      if (!input.deductionReason || input.deductionReason.trim().length < 3) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Un motif justifié est obligatoire pour toute retenue sur caution'
        );
      }
      if (!input.chargeCategory) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Sélectionnez la catégorie de charge justifiant la retenue sur caution'
        );
      }
    }

    if (input.trafficFineId) {
      const fine = db
        .prepare<[number], any>('SELECT * FROM traffic_fines WHERE id = ?')
        .get(input.trafficFineId);
      if (!fine) throw new AuthError('NOT_FOUND', 'Amende associée introuvable');
      if (fine.customer_id !== dep.customer_id) {
        throw new AuthError('VALIDATION_ERROR', 'Cette amende appartient à un autre client');
      }
    }

    let nextDocPath: string | null = dep.supporting_doc_path ?? null;
    let nextDocName: string | null = dep.supporting_doc_original_name ?? null;
    let nextDocMime: string | null = dep.supporting_doc_mime_type ?? null;

    if (input.supportingDoc) {
      const validated = validateAndDecodeUpload({
        originalFileName: input.supportingDoc.originalFileName,
        mimeType: input.supportingDoc.mimeType,
        base64Data: input.supportingDoc.base64Data,
      });
      const encrypted = encryptBuffer(validated.bytes, vaultKey);
      const opaqueName = `dep_${dep.id}_${crypto.randomUUID()}.enc`;
      const relPath = path.join('deposits', opaqueName);
      const fullPath = resolveConfinedPath(vaultRootDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, encrypted, { mode: 0o600 });
      nextDocPath = relPath;
      nextDocName = validated.safeFileName;
      nextDocMime = validated.mimeType;
    }

    if (input.deductedAmountMinor > 0) {
      db.prepare(
        `INSERT INTO deposit_movements (
          deposit_id, movement_type, amount_minor, charge_category, traffic_fine_id, reason, recorded_by_user_id
        ) VALUES (?, 'DEDUCTED', ?, ?, ?, ?, ?)`
      ).run(
        dep.id,
        input.deductedAmountMinor,
        input.chargeCategory ?? 'OTHER',
        input.trafficFineId ?? null,
        input.deductionReason!.trim(),
        actor.id
      );

      if (input.trafficFineId) {
        db.prepare('UPDATE traffic_fines SET is_paid_by_customer = 1 WHERE id = ?').run(input.trafficFineId);
      }
    }

    const refundMethod = input.refundMethod ?? 'CASH';
    if (input.refundedAmountMinor > 0) {
      const refMovRes = db
        .prepare(
          `INSERT INTO deposit_movements (
            deposit_id, movement_type, amount_minor, payment_method, reason, recorded_by_user_id
          ) VALUES (?, 'REFUNDED', ?, ?, ?, ?)`
        )
        .run(
          dep.id,
          input.refundedAmountMinor,
          refundMethod,
          input.deductedAmountMinor > 0
            ? 'Remboursement du reliquat de caution'
            : 'Restitution de caution client',
          actor.id
        );

      const contractRow = db
        .prepare<[number], { contract_number: string }>('SELECT contract_number FROM rental_contracts WHERE id = ?')
        .get(dep.contract_id);

      appendCashMovementIfOpenSession(db, {
        actorId: actor.id,
        currency: dep.currency,
        paymentMethod: refundMethod,
        movementType: 'DEPOSIT_REFUND',
        amountMinor: input.refundedAmountMinor,
        depositMovementId: Number(refMovRes.lastInsertRowid),
        description: `Restitution caution (${contractRow?.contract_number ?? `#${dep.contract_id}`})`,
      });
    }

    const nextDeducted = alreadyDeducted + input.deductedAmountMinor;
    const nextRefunded = alreadyRefunded + input.refundedAmountMinor;
    const isFullySettled = nextDeducted + nextRefunded >= totalAmountMinor;

    const nextStatus: DepositStatus = !isFullySettled
      ? 'HELD'
      : nextDeducted === 0
        ? 'RETURNED'
        : nextRefunded === 0
          ? 'FULLY_DEDUCTED'
          : 'PARTIALLY_DEDUCTED';

    const reasonMerged =
      input.deductionReason?.trim() && dep.deduction_reason
        ? `${dep.deduction_reason} | ${input.deductionReason.trim()}`
        : input.deductionReason?.trim() || dep.deduction_reason || null;

    const today = new Date().toISOString().slice(0, 10);
    db.prepare(
      `UPDATE deposits
       SET status = ?,
           deducted_amount_minor = ?,
           refunded_amount_minor = ?,
           deduction_reason = ?,
           refund_method = COALESCE(?, refund_method),
           returned_date = ?,
           settled_by_user_id = ?,
           supporting_doc_path = ?,
           supporting_doc_original_name = ?,
           supporting_doc_mime_type = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      nextStatus,
      nextDeducted,
      nextRefunded,
      reasonMerged,
      input.refundedAmountMinor > 0 ? refundMethod : null,
      input.refundedAmountMinor > 0 || isFullySettled ? today : dep.returned_date,
      actor.id,
      nextDocPath,
      nextDocName,
      nextDocMime,
      dep.id
    );

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'DEPOSIT_SETTLED',
      entityType: 'deposits',
      entityId: dep.id,
      previousValue: { status: dep.status, deductedAmountMinor: alreadyDeducted, refundedAmountMinor: alreadyRefunded },
      newValue: {
        status: nextStatus,
        deductedAmountMinor: nextDeducted,
        refundedAmountMinor: nextRefunded,
        chargeCategory: input.chargeCategory ?? null,
      },
      reason: input.deductionReason?.trim() || null,
    });

    return getDepositDetail(db, dep.id);
  });

  return tx();
}

export function readDepositDocument(
  db: Database.Database,
  vaultRootDir: string,
  vaultKey: Buffer,
  depositId: number
) {
  const row = db.prepare<[number], any>('SELECT * FROM deposits WHERE id = ?').get(depositId);
  if (!row || !row.supporting_doc_path) {
    throw new AuthError('NOT_FOUND', 'Justificatif de caution introuvable');
  }

  const fullPath = resolveConfinedPath(vaultRootDir, row.supporting_doc_path);
  const encrypted = fs.readFileSync(fullPath);
  const plain = decryptBuffer(encrypted, vaultKey);

  return {
    id: row.id as number,
    originalFileName: (row.supporting_doc_original_name || 'justificatif_caution') as string,
    mimeType: (row.supporting_doc_mime_type || 'application/pdf') as string,
    base64Data: plain.toString('base64'),
  };
}
