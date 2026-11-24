import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  Customer,
  CustomerCompany,
  CustomerDocument,
  CustomerRiskRecord,
  CustomerType,
  RiskLevel,
  RiskReason,
} from '../../../shared/types/domain.ts';
import { decryptBuffer, encryptBuffer, resolveConfinedPath } from '../../security/crypto.ts';
import { validateAndDecodeUpload } from '../../security/fileValidation.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';
import { computeCustomerFinancialMetrics } from './customerFinanceService.ts';

function mapCustomer(row: any): Customer {
  return {
    id: row.id,
    customerType: row.customer_type as CustomerType,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    secondaryPhone: row.secondary_phone,
    address: row.address,
    wilayaCode: row.wilaya_code,
    commune: row.commune,
    cniNumber: row.cni_number,
    passportNumber: row.passport_number,
    drivingLicenceNumber: row.driving_licence_number,
    drivingLicenceIssueDate: row.driving_licence_issue_date,
    drivingLicenceExpirationDate: row.driving_licence_expiration_date,
    riskStatus: row.risk_status as RiskLevel,
    internalNotes: row.internal_notes,
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCompany(row: any): CustomerCompany {
  return {
    id: row.id,
    customerId: row.customer_id,
    companyName: row.company_name,
    legalRepresentative: row.legal_representative,
    rcNumber: row.rc_number,
    nifNumber: row.nif_number,
    nisNumber: row.nis_number,
    artNumber: row.art_number,
    bonDeCommandeNumber: row.bon_de_commande_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRiskRecord(row: any): CustomerRiskRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    riskLevel: row.risk_level as RiskLevel,
    reason: row.reason as RiskReason,
    description: row.description,
    incidentDate: row.incident_date,
    evidenceFilePath: row.evidence_file_path,
    reportedByUserId: row.reported_by_user_id,
    isResolved: row.is_resolved === 1,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedAt: row.resolved_at,
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at,
  };
}

export function listCustomers(
  db: Database.Database,
  filters?: { search?: string; customerType?: string; riskStatus?: string; includeArchived?: boolean }
) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (!filters?.includeArchived) {
    clauses.push('c.is_archived = 0');
  }
  if (filters?.customerType && filters.customerType !== 'ALL') {
    clauses.push('c.customer_type = ?');
    params.push(filters.customerType);
  }
  if (filters?.riskStatus && filters.riskStatus !== 'ALL') {
    clauses.push('c.risk_status = ?');
    params.push(filters.riskStatus);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(c.full_name LIKE ? OR c.phone LIKE ? OR COALESCE(c.cni_number, '') LIKE ? OR COALESCE(c.driving_licence_number, '') LIKE ? OR COALESCE(cc.company_name, '') LIKE ? OR COALESCE(cc.nif_number, '') LIKE ?)`
    );
    params.push(q, q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT c.*, cc.company_name, cc.rc_number, cc.nif_number,
              (SELECT COUNT(*) FROM rental_contracts rc WHERE rc.customer_id = c.id) AS total_rentals
       FROM customers c
       LEFT JOIN customer_companies cc ON cc.customer_id = c.id
       ${where}
       ORDER BY c.id DESC`
    )
    .all(...params);

  return rows.map((r) => ({
    ...mapCustomer(r),
    companyName: r.company_name ?? null,
    rcNumber: r.rc_number ?? null,
    nifNumber: r.nif_number ?? null,
    totalRentals: Number(r.total_rentals ?? 0),
  }));
}

export function getCustomerProfile(db: Database.Database, customerId: number) {
  const row = db.prepare<[number], any>('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!row) throw new AuthError('NOT_FOUND', 'Client introuvable');

  const companyRow = db
    .prepare<[number], any>('SELECT * FROM customer_companies WHERE customer_id = ?')
    .get(customerId);

  const riskRecords = db
    .prepare<[number], any>(
      'SELECT * FROM customer_risk_records WHERE customer_id = ? ORDER BY incident_date DESC, id DESC'
    )
    .all(customerId)
    .map(mapRiskRecord);

  const documents: CustomerDocument[] = db
    .prepare<[number], any>('SELECT * FROM customer_documents WHERE customer_id = ? ORDER BY is_archived ASC, id DESC')
    .all(customerId)
    .map(mapCustomerDocument);

  const rentalHistory = db
    .prepare<[number], any>(
      `SELECT rc.*, v.matricule, v.brand, v.model
       FROM rental_contracts rc
       JOIN vehicles v ON v.id = rc.vehicle_id
       WHERE rc.customer_id = ?
       ORDER BY rc.start_date DESC`
    )
    .all(customerId)
    .map((c) => ({
      id: c.id,
      contractNumber: c.contract_number,
      vehicleId: c.vehicle_id,
      vehicleLabel: `${c.brand} ${c.model} (${c.matricule})`,
      status: c.status,
      startDate: c.start_date,
      expectedReturnDate: c.expected_return_date,
      actualReturnDate: c.actual_return_date,
      totalContractAmountMinor: c.total_contract_amount_minor,
      currency: c.currency,
    }));

  const finMetrics = computeCustomerFinancialMetrics(db, customerId);

  const customRates = db
    .prepare<[number], any>('SELECT * FROM customer_custom_rates WHERE customer_id = ? AND is_active = 1')
    .all(customerId)
    .map((cr) => ({
      id: cr.id,
      customerId: cr.customer_id,
      vehicleCategory: cr.vehicle_category,
      vehicleId: cr.vehicle_id,
      dailyRateMinor: cr.daily_rate_minor,
      weeklyRateMinor: cr.weekly_rate_minor,
      monthlyRateMinor: cr.monthly_rate_minor,
      defaultDiscountPercent: cr.default_discount_percent,
      notes: cr.notes,
    }));

  return {
    customer: mapCustomer(row),
    company: companyRow ? mapCompany(companyRow) : null,
    riskRecords,
    documents,
    rentalHistory,
    customRates,
    stats: {
      totalRentals: finMetrics.totalRentals,
      totalChargedMinor: finMetrics.totalChargedMinor,
      netPaidMinor: finMetrics.netPaidMinor,
      outstandingBalanceMinor: finMetrics.outstandingBalanceMinor,
      overdueDebtMinor: finMetrics.overdueDebtMinor,
      heldDepositsMinor: finMetrics.heldDepositsMinor,
    },
  };
}

export function createCustomer(
  db: Database.Database,
  actor: { id: number; username: string },
  input: any
) {
  const tx = db.transaction(() => {
    if (input.wilayaCode) {
      const w = db.prepare<[string], { code: string }>('SELECT code FROM wilayas WHERE code = ?').get(input.wilayaCode);
      if (!w) throw new AuthError('VALIDATION_ERROR', `Code wilaya inconnu: ${input.wilayaCode}`);
    }

    const res = db
      .prepare(
        `INSERT INTO customers (
          customer_type, full_name, date_of_birth, phone, secondary_phone,
          address, wilaya_code, commune, cni_number, passport_number,
          driving_licence_number, driving_licence_issue_date, driving_licence_expiration_date,
          risk_status, internal_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOW', ?)`
      )
      .run(
        input.customerType,
        input.fullName.trim(),
        input.dateOfBirth || null,
        input.phone.trim(),
        input.secondaryPhone || null,
        input.address || null,
        input.wilayaCode || null,
        input.commune || null,
        input.cniNumber || null,
        input.passportNumber || null,
        input.drivingLicenceNumber || null,
        input.drivingLicenceIssueDate || null,
        input.drivingLicenceExpirationDate || null,
        input.internalNotes || null
      );

    const customerId = Number(res.lastInsertRowid);

    if (input.customerType === 'COMPANY' && input.company) {
      db.prepare(
        `INSERT INTO customer_companies (
          customer_id, company_name, legal_representative, rc_number,
          nif_number, nis_number, art_number, bon_de_commande_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        customerId,
        input.company.companyName.trim(),
        input.company.legalRepresentative.trim(),
        input.company.rcNumber || null,
        input.company.nifNumber || null,
        input.company.nisNumber || null,
        input.company.artNumber || null,
        input.company.bonDeCommandeNumber || null
      );
    }

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CUSTOMER_CREATED',
      entityType: 'customers',
      entityId: customerId,
      newValue: { fullName: input.fullName, customerType: input.customerType, phone: input.phone },
    });

    return getCustomerProfile(db, customerId);
  });

  return tx();
}

export function updateCustomer(
  db: Database.Database,
  actor: { id: number; username: string },
  input: any
) {
  const tx = db.transaction(() => {
    const currentRow = db.prepare<[number], any>('SELECT * FROM customers WHERE id = ?').get(input.id);
    if (!currentRow) throw new AuthError('NOT_FOUND', 'Client introuvable');
    const prev = mapCustomer(currentRow);

    if (input.wilayaCode) {
      const w = db.prepare<[string], { code: string }>('SELECT code FROM wilayas WHERE code = ?').get(input.wilayaCode);
      if (!w) throw new AuthError('VALIDATION_ERROR', `Code wilaya inconnu: ${input.wilayaCode}`);
    }

    const nextType = input.customerType ?? prev.customerType;
    db.prepare(
      `UPDATE customers SET
        customer_type = ?, full_name = ?, date_of_birth = ?, phone = ?, secondary_phone = ?,
        address = ?, wilaya_code = ?, commune = ?, cni_number = ?, passport_number = ?,
        driving_licence_number = ?, driving_licence_issue_date = ?, driving_licence_expiration_date = ?,
        internal_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      nextType,
      input.fullName?.trim() ?? prev.fullName,
      input.dateOfBirth !== undefined ? input.dateOfBirth || null : prev.dateOfBirth,
      input.phone?.trim() ?? prev.phone,
      input.secondaryPhone !== undefined ? input.secondaryPhone || null : prev.secondaryPhone,
      input.address !== undefined ? input.address || null : prev.address,
      input.wilayaCode !== undefined ? input.wilayaCode || null : prev.wilayaCode,
      input.commune !== undefined ? input.commune || null : prev.commune,
      input.cniNumber !== undefined ? input.cniNumber || null : prev.cniNumber,
      input.passportNumber !== undefined ? input.passportNumber || null : prev.passportNumber,
      input.drivingLicenceNumber !== undefined ? input.drivingLicenceNumber || null : prev.drivingLicenceNumber,
      input.drivingLicenceIssueDate !== undefined
        ? input.drivingLicenceIssueDate || null
        : prev.drivingLicenceIssueDate,
      input.drivingLicenceExpirationDate !== undefined
        ? input.drivingLicenceExpirationDate || null
        : prev.drivingLicenceExpirationDate,
      input.internalNotes !== undefined ? input.internalNotes || null : prev.internalNotes,
      input.id
    );

    if (nextType === 'INDIVIDUAL') {
      db.prepare('DELETE FROM customer_companies WHERE customer_id = ?').run(input.id);
    } else if (nextType === 'COMPANY' && input.company) {
      db.prepare(
        `INSERT INTO customer_companies (
          customer_id, company_name, legal_representative, rc_number,
          nif_number, nis_number, art_number, bon_de_commande_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(customer_id) DO UPDATE SET
          company_name = excluded.company_name,
          legal_representative = excluded.legal_representative,
          rc_number = excluded.rc_number,
          nif_number = excluded.nif_number,
          nis_number = excluded.nis_number,
          art_number = excluded.art_number,
          bon_de_commande_number = excluded.bon_de_commande_number,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
      ).run(
        input.id,
        input.company.companyName.trim(),
        input.company.legalRepresentative.trim(),
        input.company.rcNumber || null,
        input.company.nifNumber || null,
        input.company.nisNumber || null,
        input.company.artNumber || null,
        input.company.bonDeCommandeNumber || null
      );
    }

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CUSTOMER_UPDATED',
      entityType: 'customers',
      entityId: input.id,
      previousValue: prev,
    });

    return getCustomerProfile(db, input.id);
  });

  return tx();
}

export function archiveCustomer(
  db: Database.Database,
  actor: { id: number; username: string },
  customerId: number
): void {
  const tx = db.transaction(() => {
    const active = db
      .prepare<[number], { id: number }>(
        "SELECT id FROM rental_contracts WHERE customer_id = ? AND status IN ('CONFIRMED', 'ACTIVE', 'EXTENDED') LIMIT 1"
      )
      .get(customerId);
    if (active) {
      throw new AuthError('CONFLICT', 'Impossible d’archiver un client ayant un contrat actif');
    }

    db.prepare(
      "UPDATE customers SET is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ).run(customerId);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CUSTOMER_ARCHIVED',
      entityType: 'customers',
      entityId: customerId,
    });
  });

  tx();
}

export function addCustomerRiskRecord(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    customerId: number;
    riskLevel: RiskLevel;
    reason: RiskReason;
    description: string;
    incidentDate: string;
  }
) {
  const tx = db.transaction(() => {
    const customer = db.prepare<[number], any>('SELECT * FROM customers WHERE id = ?').get(input.customerId);
    if (!customer) throw new AuthError('NOT_FOUND', 'Client introuvable');

    const res = db
      .prepare(
        `INSERT INTO customer_risk_records (
          customer_id, risk_level, reason, description, incident_date, reported_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.customerId,
        input.riskLevel,
        input.reason,
        input.description.trim(),
        input.incidentDate,
        actor.id
      );

    // Elevate customer risk_status according to documented incident
    const severityRank: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, BLACKLISTED: 3 };
    const currentRank = severityRank[customer.risk_status as RiskLevel] ?? 0;
    const nextRank = severityRank[input.riskLevel] ?? 0;
    if (nextRank >= currentRank) {
      db.prepare(
        "UPDATE customers SET risk_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
      ).run(input.riskLevel, input.customerId);
    }

    const recordId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CUSTOMER_RISK_ADDED',
      entityType: 'customer_risk_records',
      entityId: recordId,
      newValue: input,
    });

    return mapRiskRecord(
      db.prepare<[number], any>('SELECT * FROM customer_risk_records WHERE id = ?').get(recordId)
    );
  });

  return tx();
}

export function resolveCustomerRiskRecord(
  db: Database.Database,
  actor: { id: number; username: string },
  input: { riskRecordId: number; resolutionNotes: string; nextCustomerRiskStatus?: RiskLevel }
) {
  const tx = db.transaction(() => {
    const rec = db
      .prepare<[number], any>('SELECT * FROM customer_risk_records WHERE id = ?')
      .get(input.riskRecordId);
    if (!rec) throw new AuthError('NOT_FOUND', 'Incident introuvable');

    db.prepare(
      `UPDATE customer_risk_records
       SET is_resolved = 1, resolved_by_user_id = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           resolution_notes = ?
       WHERE id = ?`
    ).run(actor.id, input.resolutionNotes.trim(), input.riskRecordId);

    if (input.nextCustomerRiskStatus) {
      db.prepare(
        "UPDATE customers SET risk_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
      ).run(input.nextCustomerRiskStatus, rec.customer_id);
    }

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CUSTOMER_RISK_RESOLVED',
      entityType: 'customer_risk_records',
      entityId: input.riskRecordId,
      newValue: input,
    });

    return mapRiskRecord(
      db.prepare<[number], any>('SELECT * FROM customer_risk_records WHERE id = ?').get(input.riskRecordId)
    );
  });

  return tx();
}

function mapCustomerDocument(d: any): CustomerDocument {
  return {
    id: Number(d.id),
    customerId: Number(d.customer_id),
    docCategory: d.doc_category,
    encryptedFilePath: d.encrypted_file_path,
    originalFileName: d.original_file_name,
    mimeType: d.mime_type,
    documentNumber: d.document_number ?? null,
    issueDate: d.issue_date ?? null,
    expirationDate: d.expiration_date ?? null,
    reminderDays: Number(d.reminder_days ?? 30),
    notes: d.notes ?? null,
    isArchived: Number(d.is_archived ?? 0) === 1,
    replacesDocId: d.replaces_doc_id != null ? Number(d.replaces_doc_id) : null,
    replacedByDocId: d.replaced_by_doc_id != null ? Number(d.replaced_by_doc_id) : null,
    archivedAt: d.archived_at ?? null,
    archivedByUserId: d.archived_by_user_id != null ? Number(d.archived_by_user_id) : null,
    uploadedByUserId: Number(d.uploaded_by_user_id),
    createdAt: d.created_at,
  };
}

/**
 * Encrypts and stores customer identity documents in the confined local vault (never public/).
 * Supports non-destructive replacement (preserves historical version as archived).
 */
export function uploadCustomerDocument(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
    customerId: number;
    docCategory: CustomerDocument['docCategory'];
    originalFileName: string;
    mimeType: string;
    base64Data: string;
    documentNumber?: string | null;
    issueDate?: string | null;
    expirationDate?: string | null;
    reminderDays?: number;
    notes?: string | null;
    replaceDocId?: number | null;
  }
): CustomerDocument {
  const customer = db.prepare<[number], { id: number }>('SELECT id FROM customers WHERE id = ?').get(input.customerId);
  if (!customer) throw new AuthError('NOT_FOUND', 'Client introuvable');

  let oldDoc: any = null;
  if (input.replaceDocId) {
    oldDoc = db
      .prepare<[number, number], any>('SELECT * FROM customer_documents WHERE id = ? AND customer_id = ?')
      .get(input.replaceDocId, input.customerId);
    if (!oldDoc) {
      throw new AuthError('NOT_FOUND', 'Document à remplacer introuvable pour ce client');
    }
  }

  const validated = validateAndDecodeUpload({
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    base64Data: input.base64Data,
  });
  const encryptedBytes = encryptBuffer(validated.bytes, vaultKey);
  const opaqueName = `cust_${input.customerId}_${crypto.randomUUID()}.enc`;
  const relativePath = path.join('customers', opaqueName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, encryptedBytes, { mode: 0o600 });

  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO customer_documents (
          customer_id, doc_category, encrypted_file_path, original_file_name, mime_type,
          document_number, issue_date, expiration_date, reminder_days, notes,
          replaces_doc_id, uploaded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.customerId,
        input.docCategory,
        relativePath,
        validated.safeFileName,
        validated.mimeType,
        input.documentNumber ?? null,
        input.issueDate ?? null,
        input.expirationDate ?? null,
        input.reminderDays ?? 30,
        input.notes ?? null,
        oldDoc ? Number(oldDoc.id) : null,
        actor.id
      );

    const docId = Number(res.lastInsertRowid);

    if (oldDoc) {
      db.prepare(
        `UPDATE customer_documents
         SET is_archived = 1,
             replaced_by_doc_id = ?,
             archived_at = COALESCE(archived_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
             archived_by_user_id = COALESCE(archived_by_user_id, ?)
         WHERE id = ?`
      ).run(docId, actor.id, oldDoc.id);
    }

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: oldDoc ? 'CUSTOMER_DOCUMENT_REPLACED' : 'CUSTOMER_DOCUMENT_UPLOADED',
      entityType: 'customer_documents',
      entityId: docId,
      previousValue: oldDoc ? { replacedDocId: oldDoc.id, originalFileName: oldDoc.original_file_name } : undefined,
      newValue: {
        customerId: input.customerId,
        docCategory: input.docCategory,
        documentNumber: input.documentNumber ?? null,
        expirationDate: input.expirationDate ?? null,
      },
    });

    return docId;
  });

  const docId = tx();
  const row = db.prepare<[number], any>('SELECT * FROM customer_documents WHERE id = ?').get(docId);
  return mapCustomerDocument(row);
}

export function updateCustomerDocumentMeta(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    docId: number;
    documentNumber?: string | null;
    issueDate?: string | null;
    expirationDate?: string | null;
    reminderDays?: number;
    notes?: string | null;
  }
): CustomerDocument {
  const existing = db.prepare<[number], any>('SELECT * FROM customer_documents WHERE id = ?').get(input.docId);
  if (!existing) throw new AuthError('NOT_FOUND', 'Document client introuvable');

  db.prepare(
    `UPDATE customer_documents
     SET document_number = ?,
         issue_date = ?,
         expiration_date = ?,
         reminder_days = ?,
         notes = ?
     WHERE id = ?`
  ).run(
    input.documentNumber !== undefined ? input.documentNumber : existing.document_number,
    input.issueDate !== undefined ? input.issueDate : existing.issue_date,
    input.expirationDate !== undefined ? input.expirationDate : existing.expiration_date,
    input.reminderDays !== undefined ? input.reminderDays : Number(existing.reminder_days ?? 30),
    input.notes !== undefined ? input.notes : existing.notes,
    input.docId
  );

  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'CUSTOMER_DOCUMENT_META_UPDATED',
    entityType: 'customer_documents',
    entityId: input.docId,
    previousValue: {
      documentNumber: existing.document_number,
      expirationDate: existing.expiration_date,
      reminderDays: existing.reminder_days,
    },
    newValue: {
      documentNumber: input.documentNumber !== undefined ? input.documentNumber : existing.document_number,
      expirationDate: input.expirationDate !== undefined ? input.expirationDate : existing.expiration_date,
      reminderDays: input.reminderDays !== undefined ? input.reminderDays : existing.reminder_days,
    },
  });

  const updated = db.prepare<[number], any>('SELECT * FROM customer_documents WHERE id = ?').get(input.docId);
  return mapCustomerDocument(updated);
}

export function archiveCustomerDocument(
  db: Database.Database,
  actor: { id: number; username: string },
  docId: number,
  reason?: string | null
): CustomerDocument {
  const existing = db.prepare<[number], any>('SELECT * FROM customer_documents WHERE id = ?').get(docId);
  if (!existing) throw new AuthError('NOT_FOUND', 'Document client introuvable');

  db.prepare(
    `UPDATE customer_documents
     SET is_archived = 1,
         archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         archived_by_user_id = ?
     WHERE id = ?`
  ).run(actor.id, docId);

  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'CUSTOMER_DOCUMENT_ARCHIVED',
    entityType: 'customer_documents',
    entityId: docId,
    reason: reason ?? null,
  });

  const updated = db.prepare<[number], any>('SELECT * FROM customer_documents WHERE id = ?').get(docId);
  return mapCustomerDocument(updated);
}

export function readCustomerDocument(
  db: Database.Database,
  vaultRootDir: string,
  vaultKey: Buffer,
  docId: number
) {
  const row = db.prepare<[number], any>('SELECT * FROM customer_documents WHERE id = ?').get(docId);
  if (!row) throw new AuthError('NOT_FOUND', 'Document client introuvable');

  const fullPath = resolveConfinedPath(vaultRootDir, row.encrypted_file_path);
  if (!fs.existsSync(fullPath)) {
    throw new AuthError('NOT_FOUND', 'Fichier chiffré manquant dans le coffre');
  }
  const encryptedBytes = fs.readFileSync(fullPath);
  const plainBytes = decryptBuffer(encryptedBytes, vaultKey);

  return {
    id: row.id,
    originalFileName: row.original_file_name as string,
    mimeType: row.mime_type as string,
    base64Data: plainBytes.toString('base64'),
  };
}

export interface CustomerEligibilityResult {
  eligible: boolean;
  requiresBlacklistOverride: boolean;
  riskStatus: RiskLevel;
  warnings: string[];
  blockers: string[];
}

export function checkCustomerEligibility(
  db: Database.Database,
  customerId: number,
  rentalEndDate: string
): CustomerEligibilityResult {
  const customer = db.prepare<[number], any>('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) throw new AuthError('NOT_FOUND', 'Client introuvable');

  const warnings: string[] = [];
  const blockers: string[] = [];

  if (customer.is_archived === 1) {
    blockers.push('Client archivé');
  }

  const riskStatus = customer.risk_status as RiskLevel;
  const requiresBlacklistOverride = riskStatus === 'BLACKLISTED';
  if (requiresBlacklistOverride) {
    warnings.push('Client sur liste noire — autorisation exceptionnelle administrateur requise');
  } else if (riskStatus === 'HIGH' || riskStatus === 'MEDIUM') {
    warnings.push(`Client signalé (${riskStatus}) — vérifier les incidents`);
  }

  if (customer.customer_type === 'INDIVIDUAL') {
    if (!customer.driving_licence_number) {
      warnings.push('Numéro de permis de conduire non renseigné');
    }
    if (
      customer.driving_licence_expiration_date &&
      customer.driving_licence_expiration_date < rentalEndDate.slice(0, 10)
    ) {
      warnings.push('Le permis de conduire expire avant la date de retour prévue');
    }

    const minYearsSetting = db
      .prepare<[], { setting_value: string }>(
        "SELECT setting_value FROM application_settings WHERE setting_key = 'business.min_licence_years'"
      )
      .get();
    const minYears = Number(minYearsSetting?.setting_value ?? 2);

    if (customer.driving_licence_issue_date && minYears > 0) {
      const issueDate = new Date(customer.driving_licence_issue_date);
      const diffYears = (Date.now() - issueDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (diffYears < minYears) {
        warnings.push(
          `Ancienneté du permis (${diffYears.toFixed(1)} ans) inférieure au seuil configuré (${minYears} ans)`
        );
      }
    }
  }

  return {
    eligible: blockers.length === 0,
    requiresBlacklistOverride,
    riskStatus,
    warnings,
    blockers,
  };
}
