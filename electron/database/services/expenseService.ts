import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { CurrencyCode, ExpenseCategory, PaymentMethod, Supplier } from '../../../shared/types/domain.ts';
import { decryptBuffer, encryptBuffer, resolveConfinedPath } from '../../security/crypto.ts';
import { validateAndDecodeUpload } from '../../security/fileValidation.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';
import { appendCashMovementIfOpenSession } from './cashRegisterService.ts';

function generateExpenseNumber(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const countRow = db.prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM expenses').get();
  const seq = (countRow?.cnt ?? 0) + 1;
  return `EXP-${year}-${String(seq).padStart(5, '0')}`;
}

function mapSupplier(r: any): Supplier {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    wilayaCode: r.wilaya_code ?? null,
    specialty: r.specialty ?? null,
    nifNumber: r.nif_number ?? null,
    notes: r.notes ?? null,
    isArchived: r.is_archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapExpense(r: any) {
  return {
    id: r.id as number,
    expenseNumber: r.expense_number as string,
    category: r.category as ExpenseCategory,
    vehicleId: (r.vehicle_id ?? null) as number | null,
    vehicleLabel: (r.vehicle_label ?? null) as string | null,
    supplierId: (r.supplier_id ?? null) as number | null,
    supplierName: (r.supplier_name ?? null) as string | null,
    maintenanceRecordId: (r.maintenance_record_id ?? null) as number | null,
    amountMinor: Number(r.amount_minor),
    currency: r.currency as CurrencyCode,
    expenseDate: r.expense_date as string,
    paymentMethod: r.payment_method as PaymentMethod,
    paymentReference: (r.payment_reference ?? null) as string | null,
    status: (r.status ?? 'POSTED') as 'POSTED' | 'REVERSED',
    description: r.description as string,
    hasReceiptDoc: Boolean(r.receipt_file_path),
    receiptOriginalName: (r.receipt_original_name ?? null) as string | null,
    reversalReason: (r.reversal_reason ?? null) as string | null,
    reversedAt: (r.reversed_at ?? null) as string | null,
    reversedByUsername: (r.reversed_by_username ?? null) as string | null,
    recordedByUserId: r.recorded_by_user_id as number,
    recordedByUsername: r.recorded_by_username as string,
    createdAt: r.created_at as string,
  };
}

export function listSuppliers(db: Database.Database, includeArchived = false): Supplier[] {
  const where = includeArchived ? '' : 'WHERE COALESCE(is_archived, 0) = 0';
  return db
    .prepare<[], any>(`SELECT * FROM suppliers ${where} ORDER BY is_archived ASC, name ASC, id DESC`)
    .all()
    .map(mapSupplier);
}

export function upsertSupplier(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    id?: number;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    wilayaCode?: string | null;
    specialty?: string | null;
    nifNumber?: string | null;
    notes?: string | null;
    isArchived?: boolean;
  }
): Supplier {
  const tx = db.transaction(() => {
    if (input.id) {
      const existing = db.prepare<[number], any>('SELECT * FROM suppliers WHERE id = ?').get(input.id);
      if (!existing) throw new AuthError('NOT_FOUND', 'Fournisseur introuvable');

      db.prepare(
        `UPDATE suppliers
         SET name = ?, phone = ?, email = ?, address = ?, wilaya_code = ?,
             specialty = ?, nif_number = ?, notes = ?,
             is_archived = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(
        input.name.trim(),
        input.phone?.trim() || null,
        input.email?.trim() || null,
        input.address?.trim() || null,
        input.wilayaCode?.trim() || null,
        input.specialty?.trim() || null,
        input.nifNumber?.trim() || null,
        input.notes?.trim() || null,
        input.isArchived !== undefined ? (input.isArchived ? 1 : 0) : Number(existing.is_archived ?? 0),
        input.id
      );

      const updated = mapSupplier(db.prepare<[number], any>('SELECT * FROM suppliers WHERE id = ?').get(input.id));
      writeAuditLog(db, {
        userId: actor.id,
        usernameSnapshot: actor.username,
        operation: 'SUPPLIER_UPDATED',
        entityType: 'suppliers',
        entityId: input.id,
        previousValue: mapSupplier(existing),
        newValue: updated,
      });
      return updated;
    }

    const res = db
      .prepare(
        `INSERT INTO suppliers (name, phone, email, address, wilaya_code, specialty, nif_number, notes, is_archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name.trim(),
        input.phone?.trim() || null,
        input.email?.trim() || null,
        input.address?.trim() || null,
        input.wilayaCode?.trim() || null,
        input.specialty?.trim() || null,
        input.nifNumber?.trim() || null,
        input.notes?.trim() || null,
        input.isArchived ? 1 : 0
      );

    const id = Number(res.lastInsertRowid);
    const created = mapSupplier(db.prepare<[number], any>('SELECT * FROM suppliers WHERE id = ?').get(id));

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'SUPPLIER_CREATED',
      entityType: 'suppliers',
      entityId: id,
      newValue: created,
    });

    return created;
  });

  return tx();
}

export function createSupplier(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    id?: number;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    wilayaCode?: string | null;
    specialty?: string | null;
    nifNumber?: string | null;
    notes?: string | null;
    isArchived?: boolean;
  }
): Supplier {
  return upsertSupplier(db, actor, input);
}

export function listExpenses(
  db: Database.Database,
  filters?: {
    category?: string;
    vehicleId?: number;
    supplierId?: number;
    status?: string;
    scope?: 'ALL' | 'VEHICLE' | 'AGENCY';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }
) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.category && filters.category !== 'ALL') {
    clauses.push('e.category = ?');
    params.push(filters.category);
  }
  if (filters?.vehicleId) {
    clauses.push('e.vehicle_id = ?');
    params.push(filters.vehicleId);
  } else if (filters?.scope === 'VEHICLE') {
    clauses.push('e.vehicle_id IS NOT NULL');
  } else if (filters?.scope === 'AGENCY') {
    clauses.push('e.vehicle_id IS NULL');
  }
  if (filters?.supplierId) {
    clauses.push('e.supplier_id = ?');
    params.push(filters.supplierId);
  }
  if (filters?.status && filters.status !== 'ALL') {
    clauses.push('e.status = ?');
    params.push(filters.status);
  }
  if (filters?.dateFrom) {
    clauses.push('substr(e.expense_date, 1, 10) >= ?');
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters?.dateTo) {
    clauses.push('substr(e.expense_date, 1, 10) <= ?');
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(e.expense_number LIKE ? OR e.description LIKE ? OR COALESCE(s.name, '') LIKE ? OR COALESCE(v.matricule, '') LIKE ? OR COALESCE(e.payment_reference, '') LIKE ?)`
    );
    params.push(q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT e.*,
              CASE WHEN v.id IS NOT NULL THEN (v.brand || ' ' || v.model || ' (' || v.matricule || ')') ELSE NULL END AS vehicle_label,
              s.name AS supplier_name,
              u.username AS recorded_by_username,
              er.reason AS reversal_reason,
              er.created_at AS reversed_at,
              ur.username AS reversed_by_username
       FROM expenses e
       LEFT JOIN vehicles v ON v.id = e.vehicle_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       JOIN users u ON u.id = e.recorded_by_user_id
       LEFT JOIN expense_reversals er ON er.expense_id = e.id
       LEFT JOIN users ur ON ur.id = er.reversed_by_user_id
       ${where}
       ORDER BY e.expense_date DESC, e.id DESC`
    )
    .all(...params);

  return rows.map(mapExpense);
}

export function recordExpense(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
    category: ExpenseCategory;
    vehicleId?: number | null;
    supplierId?: number | null;
    maintenanceRecordId?: number | null;
    amountMinor: number;
    currency: CurrencyCode;
    expenseDate: string;
    paymentMethod: PaymentMethod;
    paymentReference?: string | null;
    description: string;
    receiptDoc?: {
      originalFileName: string;
      mimeType: string;
      base64Data: string;
    } | null;
  }
) {
  const tx = db.transaction(() => {
    if (input.vehicleId) {
      const v = db.prepare<[number], { id: number }>('SELECT id FROM vehicles WHERE id = ?').get(input.vehicleId);
      if (!v) throw new AuthError('NOT_FOUND', 'Véhicule associé introuvable');
    }
    if (input.supplierId) {
      const s = db.prepare<[number], { id: number }>('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId);
      if (!s) throw new AuthError('NOT_FOUND', 'Fournisseur introuvable');
    }

    let receiptPath: string | null = null;
    let receiptName: string | null = null;
    let receiptMime: string | null = null;
    if (input.receiptDoc) {
      const validated = validateAndDecodeUpload({
        originalFileName: input.receiptDoc.originalFileName,
        mimeType: input.receiptDoc.mimeType,
        base64Data: input.receiptDoc.base64Data,
      });
      const encrypted = encryptBuffer(validated.bytes, vaultKey);
      const opaqueName = `exp_${crypto.randomUUID()}.enc`;
      const relPath = path.join('expenses', opaqueName);
      const fullPath = resolveConfinedPath(vaultRootDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, encrypted, { mode: 0o600 });
      receiptPath = relPath;
      receiptName = validated.safeFileName;
      receiptMime = validated.mimeType;
    }

    const expenseNumber = generateExpenseNumber(db);
    const res = db
      .prepare(
        `INSERT INTO expenses (
          expense_number, category, vehicle_id, supplier_id, maintenance_record_id,
          amount_minor, currency, expense_date, payment_method, payment_reference,
          status, description, receipt_file_path, receipt_original_name, receipt_mime_type,
          recorded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?)`
      )
      .run(
        expenseNumber,
        input.category,
        input.vehicleId ?? null,
        input.supplierId ?? null,
        input.maintenanceRecordId ?? null,
        input.amountMinor,
        input.currency,
        input.expenseDate,
        input.paymentMethod,
        input.paymentReference?.trim() || null,
        input.description.trim(),
        receiptPath,
        receiptName,
        receiptMime,
        actor.id
      );

    const expenseId = Number(res.lastInsertRowid);

    appendCashMovementIfOpenSession(db, {
      actorId: actor.id,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      movementType: 'EXPENSE',
      amountMinor: input.amountMinor,
      expenseId,
      description: `${expenseNumber} · ${input.description.trim()}`,
    });

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'EXPENSE_RECORDED',
      entityType: 'expenses',
      entityId: expenseId,
      newValue: {
        expenseNumber,
        category: input.category,
        vehicleId: input.vehicleId ?? null,
        amountMinor: input.amountMinor,
        paymentMethod: input.paymentMethod,
      },
    });

    return listExpenses(db).find((e) => e.id === expenseId)!;
  });

  return tx();
}

export function reverseExpense(
  db: Database.Database,
  actor: { id: number; username: string },
  input: { expenseId: number; reason: string }
) {
  const tx = db.transaction(() => {
    const exp = db.prepare<[number], any>('SELECT * FROM expenses WHERE id = ?').get(input.expenseId);
    if (!exp) throw new AuthError('NOT_FOUND', 'Dépense introuvable');
    if (exp.status === 'REVERSED') {
      throw new AuthError('CONFLICT', 'Cette dépense est déjà annulée par contre-passation');
    }

    // Check if linked to a cash register session
    const cashMov = db
      .prepare<[number], { id: number; session_id: number; status: string }>(
        `SELECT cm.id, cm.session_id, cs.status
         FROM cash_register_movements cm
         JOIN cash_register_sessions cs ON cs.id = cm.session_id
         WHERE cm.expense_id = ? AND cm.movement_type = 'EXPENSE'
         LIMIT 1`
      )
      .get(exp.id);

    let cashAdjMovementId: number | null = null;
    if (cashMov && cashMov.status === 'OPEN') {
      const session = db
        .prepare<[number], any>('SELECT * FROM cash_register_sessions WHERE id = ?')
        .get(cashMov.session_id);
      const nextAdj = Number(session.cash_adjustments_minor ?? 0) + Number(exp.amount_minor);
      const nextExpected = Number(session.expected_closing_minor) + Number(exp.amount_minor);
      const adjRes = db
        .prepare(
          `INSERT INTO cash_register_movements (
            session_id, movement_type, amount_minor, expense_id, description, recorded_by_user_id
          ) VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?)`
        )
        .run(
          cashMov.session_id,
          exp.amount_minor,
          exp.id,
          `Annulation dépense ${exp.expense_number}: ${input.reason.trim()}`,
          actor.id
        );
      cashAdjMovementId = Number(adjRes.lastInsertRowid);
      db.prepare(
        `UPDATE cash_register_sessions
         SET cash_adjustments_minor = ?, expected_closing_minor = ?
         WHERE id = ?`
      ).run(nextAdj, nextExpected, cashMov.session_id);
    }

    db.prepare("UPDATE expenses SET status = 'REVERSED' WHERE id = ?").run(exp.id);
    db.prepare(
      `INSERT INTO expense_reversals (expense_id, reason, reversed_by_user_id, cash_adjustment_movement_id)
       VALUES (?, ?, ?, ?)`
    ).run(exp.id, input.reason.trim(), actor.id, cashAdjMovementId);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'EXPENSE_REVERSED',
      entityType: 'expenses',
      entityId: exp.id,
      previousValue: { status: 'POSTED', amountMinor: exp.amount_minor },
      newValue: { status: 'REVERSED', cashAdjustmentMovementId: cashAdjMovementId },
      reason: input.reason.trim(),
    });

    return listExpenses(db).find((e) => e.id === exp.id)!;
  });

  return tx();
}

export function readExpenseDocument(
  db: Database.Database,
  vaultRootDir: string,
  vaultKey: Buffer,
  expenseId: number
) {
  const row = db.prepare<[number], any>('SELECT * FROM expenses WHERE id = ?').get(expenseId);
  if (!row || !row.receipt_file_path) {
    throw new AuthError('NOT_FOUND', 'Pièce justificative de dépense introuvable');
  }

  const fullPath = resolveConfinedPath(vaultRootDir, row.receipt_file_path);
  const encrypted = fs.readFileSync(fullPath);
  const plain = decryptBuffer(encrypted, vaultKey);

  return {
    id: row.id as number,
    originalFileName: (row.receipt_original_name || 'justificatif_depense') as string,
    mimeType: (row.receipt_mime_type || 'application/pdf') as string,
    base64Data: plain.toString('base64'),
  };
}
