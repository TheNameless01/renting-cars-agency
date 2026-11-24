import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  AppLanguage,
  DocumentFormat,
  DocumentKind,
  DocumentTemplateConfig,
  GeneratedDocument,
  Invoice,
  NumeralSystem,
  ReportFilter,
} from '../../../shared/types/domain.ts';
import { decryptBuffer, encryptBuffer, resolveConfinedPath } from '../../security/crypto.ts';
import { validateAndDecodeUpload } from '../../security/fileValidation.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';
import { updateSettingsBatch } from './settingsService.ts';
import { formatDateForDoc } from '../../documents/arabicText.ts';
import { renderDocumentToPdf, type DocumentRenderPayload } from '../../documents/pdfEngine.ts';
import {
  ALL_DOCUMENT_KINDS,
  buildDocumentContentFromDb,
  loadTemplateConfigFromDb,
} from '../../documents/templates.ts';

function allocateDocumentNumber(db: Database.Database, prefix: string): string {
  const year = new Date().getUTCFullYear();
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'DOC';
  const pattern = `${cleanPrefix}-${year}-%`;
  const row = db
    .prepare<[string], { cnt: number }>('SELECT COUNT(*) AS cnt FROM generated_documents WHERE document_number LIKE ?')
    .get(pattern);
  let seq = Number(row?.cnt ?? 0) + 1;
  while (true) {
    const candidate = `${cleanPrefix}-${year}-${String(seq).padStart(4, '0')}`;
    const exists = db
      .prepare<[string], { id: number }>('SELECT id FROM generated_documents WHERE document_number = ?')
      .get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}

function allocateInvoiceNumber(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const row = db
    .prepare<[string], { cnt: number }>('SELECT COUNT(*) AS cnt FROM invoices WHERE invoice_number LIKE ?')
    .get(`INV-${year}-%`);
  let seq = Number(row?.cnt ?? 0) + 1;
  while (true) {
    const candidate = `INV-${year}-${String(seq).padStart(4, '0')}`;
    const exists = db.prepare<[string], { id: number }>('SELECT id FROM invoices WHERE invoice_number = ?').get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}

function mapGeneratedDocument(r: any): GeneratedDocument {
  return {
    id: Number(r.id),
    documentNumber: r.document_number,
    documentKind: r.document_kind as DocumentKind,
    format: r.format as DocumentFormat,
    title: r.title || r.document_number,
    language: (r.language === 'ar' ? 'ar' : 'fr') as AppLanguage,
    numeralSystem: (r.numeral_system === 'arabic' ? 'arabic' : 'latin') as NumeralSystem,
    contractId: r.contract_id != null ? Number(r.contract_id) : null,
    paymentId: r.payment_id != null ? Number(r.payment_id) : null,
    depositId: r.deposit_id != null ? Number(r.deposit_id) : null,
    inspectionId: r.inspection_id != null ? Number(r.inspection_id) : null,
    invoiceId: r.invoice_id != null ? Number(r.invoice_id) : null,
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    vehicleId: r.vehicle_id != null ? Number(r.vehicle_id) : null,
    maintenanceRecordId: r.maintenance_record_id != null ? Number(r.maintenance_record_id) : null,
    expenseId: r.expense_id != null ? Number(r.expense_id) : null,
    cashSessionId: r.cash_session_id != null ? Number(r.cash_session_id) : null,
    isCopy: Number(r.is_copy ?? 0) === 1,
    sourceDocumentId: r.source_document_id != null ? Number(r.source_document_id) : null,
    sourceDocumentNumber: r.source_document_number ?? null,
    reprintCount: Number(r.reprint_count ?? 0),
    templateVersion: Number(r.template_version ?? 1),
    generationStatus: (r.generation_status === 'FAILED' ? 'FAILED' : 'READY'),
    filePath: r.file_path,
    originalFileName: r.original_file_name || `${r.document_number}.pdf`,
    mimeType: r.mime_type || 'application/pdf',
    fileSizeBytes: Number(r.file_size_bytes ?? 0),
    sha256Hash: r.sha256_hash ?? null,
    generatedByUserId: Number(r.generated_by_user_id),
    generatedByUsername: r.generated_by_username || 'system',
    lastPrintedAt: r.last_printed_at ?? null,
    lastPrintedByUserId: r.last_printed_by_user_id != null ? Number(r.last_printed_by_user_id) : null,
    customerName: r.customer_name ?? null,
    vehicleLabel: r.vehicle_label ?? null,
    contractNumber: r.contract_number ?? null,
    createdAt: r.created_at,
  };
}

function loadAgencyLogoFromVault(
  template: DocumentTemplateConfig,
  vaultRootDir: string,
  vaultKey: Buffer
): { bytes: Buffer; mimeType: string } | null {
  if (!template.logoVaultPath || !template.logoMimeType) return null;
  try {
    const full = resolveConfinedPath(vaultRootDir, template.logoVaultPath);
    if (!fs.existsSync(full)) return null;
    const dec = decryptBuffer(fs.readFileSync(full), vaultKey);
    return { bytes: dec, mimeType: template.logoMimeType };
  } catch {
    return null;
  }
}

export function getDocumentTemplateConfig(db: Database.Database): DocumentTemplateConfig {
  return loadTemplateConfigFromDb(db);
}

export function updateDocumentTemplateConfig(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    defaultLanguage?: AppLanguage;
    defaultFormat?: DocumentFormat;
    thermalWidth?: '80MM' | '58MM';
    defaultPrinterA4?: string;
    defaultPrinterThermal?: string;
    showLogo?: boolean;
    showFiscalIds?: boolean;
    showSignatureBoxes?: boolean;
    invoiceFiscallyCompliant?: boolean;
    invoiceTaxRatePercent?: number;
    footerFr?: string;
    footerAr?: string;
    signatureAgencyFr?: string;
    signatureAgencyAr?: string;
    signatureCustomerFr?: string;
    signatureCustomerAr?: string;
    contractTermsFr?: string;
    contractTermsAr?: string;
    invoiceDisclaimerFr?: string;
    invoiceDisclaimerAr?: string;
    prefixes?: Partial<Record<DocumentKind, string>>;
  }
): DocumentTemplateConfig {
  const current = loadTemplateConfigFromDb(db);
  const updates: Array<{ key: string; group: 'documents'; value: string }> = [
    {
      key: 'documents.template_version',
      group: 'documents',
      value: String(current.templateVersion + 1),
    },
  ];

  const add = (key: string, val: string | undefined) => {
    if (val !== undefined) updates.push({ key, group: 'documents', value: val });
  };

  add('documents.default_language', input.defaultLanguage);
  add('documents.default_format', input.defaultFormat);
  add('documents.thermal_width', input.thermalWidth);
  add('documents.default_printer_a4', input.defaultPrinterA4);
  add('documents.default_printer_thermal', input.defaultPrinterThermal);
  if (input.showLogo !== undefined) add('documents.show_logo', input.showLogo ? '1' : '0');
  if (input.showFiscalIds !== undefined) add('documents.show_fiscal_ids', input.showFiscalIds ? '1' : '0');
  if (input.showSignatureBoxes !== undefined) add('documents.show_signature_boxes', input.showSignatureBoxes ? '1' : '0');
  if (input.invoiceFiscallyCompliant !== undefined) add('documents.invoice_fiscally_compliant', input.invoiceFiscallyCompliant ? '1' : '0');
  if (input.invoiceTaxRatePercent !== undefined) add('documents.invoice_tax_rate_percent', String(input.invoiceTaxRatePercent));
  add('documents.footer_fr', input.footerFr);
  add('documents.footer_ar', input.footerAr);
  add('documents.signature_agency_fr', input.signatureAgencyFr);
  add('documents.signature_agency_ar', input.signatureAgencyAr);
  add('documents.signature_customer_fr', input.signatureCustomerFr);
  add('documents.signature_customer_ar', input.signatureCustomerAr);
  add('documents.contract_terms_fr', input.contractTermsFr);
  add('documents.contract_terms_ar', input.contractTermsAr);
  add('documents.invoice_disclaimer_fr', input.invoiceDisclaimerFr);
  add('documents.invoice_disclaimer_ar', input.invoiceDisclaimerAr);

  if (input.prefixes) {
    for (const kind of ALL_DOCUMENT_KINDS) {
      const p = input.prefixes[kind];
      if (p) add(`documents.prefix_${kind}`, p.toUpperCase());
    }
  }

  updateSettingsBatch(db, actor, updates);
  return loadTemplateConfigFromDb(db);
}

export function uploadAgencyLogo(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: { originalFileName: string; mimeType: 'image/png' | 'image/jpeg'; base64Data: string }
): DocumentTemplateConfig {
  const validated = validateAndDecodeUpload({
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    base64Data: input.base64Data,
    allowedMimes: ['image/png', 'image/jpeg'],
    maxBytes: 3 * 1024 * 1024,
  });
  const encrypted = encryptBuffer(validated.bytes, vaultKey);
  const opaqueName = `agency_logo_${crypto.randomUUID()}.enc`;
  const relativePath = path.join('branding', opaqueName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, encrypted, { mode: 0o600 });

  updateSettingsBatch(db, actor, [
    { key: 'agency.logo_vault_path', group: 'agency', value: relativePath },
    { key: 'agency.logo_mime_type', group: 'agency', value: validated.mimeType },
  ]);

  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'AGENCY_LOGO_UPDATED',
    entityType: 'application_settings',
    entityId: 'agency.logo_vault_path',
    newValue: { mimeType: validated.mimeType, originalFileName: validated.safeFileName },
  });

  return loadTemplateConfigFromDb(db);
}

export function readAgencyLogo(
  db: Database.Database,
  vaultRootDir: string,
  vaultKey: Buffer
): { mimeType: string; base64Data: string } | null {
  const tpl = loadTemplateConfigFromDb(db);
  const loaded = loadAgencyLogoFromVault(tpl, vaultRootDir, vaultKey);
  if (!loaded) return null;
  return { mimeType: loaded.mimeType, base64Data: loaded.bytes.toString('base64') };
}

export async function generateAndArchiveDocument(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
    documentKind: DocumentKind;
    format?: DocumentFormat;
    language?: AppLanguage;
    numeralSystem?: NumeralSystem;
    contractId?: number | null;
    extensionId?: number | null;
    paymentId?: number | null;
    depositId?: number | null;
    inspectionId?: number | null;
    invoiceId?: number | null;
    customerId?: number | null;
    vehicleId?: number | null;
    maintenanceRecordId?: number | null;
    expenseId?: number | null;
    cashSessionId?: number | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    reportFilter?: ReportFilter | null;
    notes?: string | null;
    taxRatePercent?: number;
  }
): Promise<{ document: GeneratedDocument; invoice: Invoice | null; pdfBase64: string }> {
  const template = loadTemplateConfigFromDb(db);
  const language: AppLanguage = input.language ?? template.defaultLanguage ?? 'fr';
  const numeralSystem: NumeralSystem = input.numeralSystem ?? 'latin';
  const format: DocumentFormat =
    input.format ??
    (input.documentKind === 'FINANCIAL_SUMMARY' || input.documentKind === 'CUSTOM_REPORT'
      ? template.defaultFormat
      : 'A4_PDF');

  const built = buildDocumentContentFromDb(db, {
    documentKind: input.documentKind,
    language,
    numeralSystem,
    template,
    contractId: input.contractId,
    extensionId: input.extensionId,
    paymentId: input.paymentId,
    depositId: input.depositId,
    inspectionId: input.inspectionId,
    invoiceId: input.invoiceId,
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    maintenanceRecordId: input.maintenanceRecordId,
    expenseId: input.expenseId,
    cashSessionId: input.cashSessionId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    reportFilter: input.reportFilter,
    notes: input.notes,
    taxRatePercent: input.taxRatePercent,
  });

  const nowIso = new Date().toISOString();
  const issueDateDisplay = formatDateForDoc(nowIso, language, numeralSystem, true);
  const prefix = template.prefixes[input.documentKind] || 'DOC';
  const documentNumber = allocateDocumentNumber(db, prefix);
  const logoBytes = loadAgencyLogoFromVault(template, vaultRootDir, vaultKey);

  const payload: DocumentRenderPayload = {
    documentNumber,
    title: built.title,
    subtitle: built.subtitle,
    issueDateDisplay,
    format,
    language,
    numeralSystem,
    isCopy: false,
    template,
    logoBytes,
    sections: built.sections,
  };

  const pdfBytes = Buffer.from(await renderDocumentToPdf(payload));
  const sha256Hash = crypto.createHash('sha256').update(pdfBytes).digest('hex');
  const encryptedBytes = encryptBuffer(pdfBytes, vaultKey);
  const opaqueFileName = `doc_${documentNumber}_${crypto.randomUUID()}.pdf.enc`;
  const relativePath = path.join('documents', opaqueFileName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, encryptedBytes, { mode: 0o600 });

  const snapshot = {
    title: built.title,
    subtitle: built.subtitle ?? null,
    issueDateDisplay,
    sections: built.sections,
  };

  const tx = db.transaction(() => {
    let createdInvoice: Invoice | null = null;
    let effectiveInvoiceId = built.links.invoiceId ?? input.invoiceId ?? null;

    if (input.documentKind === 'INVOICE' && built.invoiceCreateData && !effectiveInvoiceId) {
      const invNum = allocateInvoiceNumber(db);
      const invData = built.invoiceCreateData;
      const invRes = db
        .prepare(
          `INSERT INTO invoices (
            invoice_number, contract_id, customer_id, issue_date,
            subtotal_minor, discount_minor, tax_rate_percent, tax_minor, total_minor,
            currency, is_fiscally_compliant, pdf_file_path, notes, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          invNum,
          invData.contractId,
          invData.customerId,
          invData.issueDate,
          invData.subtotalMinor,
          invData.discountMinor,
          invData.taxRatePercent,
          invData.taxMinor,
          invData.totalMinor,
          invData.currency,
          invData.isFiscallyCompliant ? 1 : 0,
          relativePath,
          invData.notes,
          actor.id
        );
      effectiveInvoiceId = Number(invRes.lastInsertRowid);
      const invRow = db.prepare<[number], any>('SELECT * FROM invoices WHERE id = ?').get(effectiveInvoiceId);
      createdInvoice = {
        id: Number(invRow.id),
        invoiceNumber: invRow.invoice_number,
        contractId: Number(invRow.contract_id),
        customerId: Number(invRow.customer_id),
        issueDate: invRow.issue_date,
        subtotalMinor: Number(invRow.subtotal_minor),
        discountMinor: Number(invRow.discount_minor ?? 0),
        taxMinor: Number(invRow.tax_minor),
        taxRatePercent: Number(invRow.tax_rate_percent ?? 0),
        totalMinor: Number(invRow.total_minor),
        currency: invRow.currency || 'DZD',
        isFiscallyCompliant: Number(invRow.is_fiscally_compliant) === 1,
        pdfFilePath: invRow.pdf_file_path ?? null,
        notes: invRow.notes ?? null,
        createdByUserId: Number(invRow.created_by_user_id),
        createdAt: invRow.created_at,
      };
    }

    const res = db
      .prepare(
        `INSERT INTO generated_documents (
          document_number, document_kind, format, title, language, numeral_system,
          contract_id, payment_id, deposit_id, inspection_id, invoice_id,
          customer_id, vehicle_id, maintenance_record_id, expense_id, cash_session_id,
          is_copy, source_document_id, reprint_count, template_version, generation_status,
          file_path, original_file_name, mime_type, file_size_bytes, sha256_hash,
          metadata_snapshot_json, template_snapshot_json,
          generated_by_user_id, generated_by_username
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, 'READY', ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        documentNumber,
        input.documentKind,
        format,
        built.title,
        language,
        numeralSystem,
        built.links.contractId ?? null,
        built.links.paymentId ?? null,
        built.links.depositId ?? null,
        built.links.inspectionId ?? null,
        effectiveInvoiceId,
        built.links.customerId ?? null,
        built.links.vehicleId ?? null,
        built.links.maintenanceRecordId ?? null,
        built.links.expenseId ?? null,
        built.links.cashSessionId ?? null,
        template.templateVersion,
        relativePath,
        `${documentNumber}.pdf`,
        pdfBytes.length,
        sha256Hash,
        JSON.stringify(snapshot),
        JSON.stringify(template),
        actor.id,
        actor.username
      );

    const docId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'DOCUMENT_GENERATED',
      entityType: 'generated_documents',
      entityId: docId,
      newValue: {
        documentNumber,
        documentKind: input.documentKind,
        format,
        language,
        sha256Hash,
        invoiceId: effectiveInvoiceId,
      },
    });

    return { docId, createdInvoice };
  });

  const { docId, createdInvoice } = tx();
  return {
    document: getDocumentById(db, docId),
    invoice: createdInvoice,
    pdfBase64: pdfBytes.toString('base64'),
  };
}

/**
 * Generates an immutable certified COPY (`is_copy = 1`) strictly from the frozen archival snapshot
 * of the canonical original document. Never alters the original file or recomputes mutated data.
 */
export async function reprintArchivedDocument(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
    sourceDocumentId: number;
    format?: DocumentFormat;
    language?: AppLanguage;
  }
): Promise<{ document: GeneratedDocument; pdfBase64: string }> {
  const requestedRow = db
    .prepare<[number], any>('SELECT * FROM generated_documents WHERE id = ?')
    .get(input.sourceDocumentId);
  if (!requestedRow) throw new AuthError('NOT_FOUND', 'Document archive introuvable');

  // Resolve canonical original if user reprinted from an existing copy
  const canonicalId = requestedRow.source_document_id != null
    ? Number(requestedRow.source_document_id)
    : Number(requestedRow.id);
  const canonicalRow = db
    .prepare<[number], any>('SELECT * FROM generated_documents WHERE id = ?')
    .get(canonicalId);
  if (!canonicalRow) throw new AuthError('NOT_FOUND', 'Document source original introuvable');

  let snapshot: { title?: string; subtitle?: string | null; issueDateDisplay?: string; sections?: any[] } = {};
  let templateSnap: DocumentTemplateConfig = loadTemplateConfigFromDb(db);
  try {
    snapshot = JSON.parse(canonicalRow.metadata_snapshot_json || '{}');
  } catch {
    snapshot = {};
  }
  try {
    const parsedTpl = JSON.parse(canonicalRow.template_snapshot_json || '{}');
    if (parsedTpl && parsedTpl.agencyName) {
      templateSnap = { ...templateSnap, ...parsedTpl };
    }
  } catch {
    // keep default
  }

  if (!Array.isArray(snapshot.sections)) {
    throw new AuthError('VALIDATION_ERROR', 'Ce document archivé ne contient pas de instantané rééditable.');
  }

  const nextCopyNumber = Number(canonicalRow.reprint_count ?? 0) + 1;
  const copyDocNumber = `${canonicalRow.document_number}-C${String(nextCopyNumber).padStart(2, '0')}`;
  const format = (input.format ?? canonicalRow.format) as DocumentFormat;
  const language = (input.language ?? canonicalRow.language ?? 'fr') as AppLanguage;
  const numeralSystem = (canonicalRow.numeral_system === 'arabic' ? 'arabic' : 'latin') as NumeralSystem;
  const logoBytes = loadAgencyLogoFromVault(templateSnap, vaultRootDir, vaultKey);

  const payload: DocumentRenderPayload = {
    documentNumber: copyDocNumber,
    title: snapshot.title || canonicalRow.title || canonicalRow.document_number,
    subtitle: snapshot.subtitle ?? undefined,
    issueDateDisplay: snapshot.issueDateDisplay || formatDateForDoc(canonicalRow.created_at, language, numeralSystem, true),
    format,
    language,
    numeralSystem,
    isCopy: true,
    sourceDocumentNumber: canonicalRow.document_number,
    copyNumber: nextCopyNumber,
    template: templateSnap,
    logoBytes,
    sections: snapshot.sections,
  };

  const pdfBytes = Buffer.from(await renderDocumentToPdf(payload));
  const sha256Hash = crypto.createHash('sha256').update(pdfBytes).digest('hex');
  const encrypted = encryptBuffer(pdfBytes, vaultKey);
  const opaqueFileName = `doc_${copyDocNumber}_${crypto.randomUUID()}.pdf.enc`;
  const relativePath = path.join('documents', opaqueFileName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, encrypted, { mode: 0o600 });

  const copyId = db.transaction(() => {
    db.prepare('UPDATE generated_documents SET reprint_count = reprint_count + 1 WHERE id = ?').run(canonicalId);

    const res = db
      .prepare(
        `INSERT INTO generated_documents (
          document_number, document_kind, format, title, language, numeral_system,
          contract_id, payment_id, deposit_id, inspection_id, invoice_id,
          customer_id, vehicle_id, maintenance_record_id, expense_id, cash_session_id,
          is_copy, source_document_id, reprint_count, template_version, generation_status,
          file_path, original_file_name, mime_type, file_size_bytes, sha256_hash,
          metadata_snapshot_json, template_snapshot_json,
          generated_by_user_id, generated_by_username
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, 'READY', ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        copyDocNumber,
        canonicalRow.document_kind,
        format,
        payload.title,
        language,
        numeralSystem,
        canonicalRow.contract_id,
        canonicalRow.payment_id,
        canonicalRow.deposit_id,
        canonicalRow.inspection_id,
        canonicalRow.invoice_id,
        canonicalRow.customer_id,
        canonicalRow.vehicle_id,
        canonicalRow.maintenance_record_id,
        canonicalRow.expense_id,
        canonicalRow.cash_session_id,
        canonicalId,
        Number(canonicalRow.template_version ?? 1),
        relativePath,
        `${copyDocNumber}.pdf`,
        pdfBytes.length,
        sha256Hash,
        canonicalRow.metadata_snapshot_json,
        canonicalRow.template_snapshot_json,
        actor.id,
        actor.username
      );

    const newId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'DOCUMENT_REPRINTED',
      entityType: 'generated_documents',
      entityId: newId,
      previousValue: { sourceDocumentId: canonicalId, sourceDocumentNumber: canonicalRow.document_number },
      newValue: { copyDocumentNumber: copyDocNumber, copyNumber: nextCopyNumber, format, language },
    });
    return newId;
  })();

  return {
    document: getDocumentById(db, copyId),
    pdfBase64: pdfBytes.toString('base64'),
  };
}

export function listDocuments(
  db: Database.Database,
  filter?: {
    search?: string;
    documentKind?: DocumentKind;
    format?: DocumentFormat;
    customerId?: number;
    vehicleId?: number;
    contractId?: number;
    dateFrom?: string;
    dateTo?: string;
    isCopy?: boolean;
    limit?: number;
  }
): GeneratedDocument[] {
  const clauses: string[] = [];
  const args: Array<string | number> = [];

  if (filter?.search) {
    clauses.push('(gd.document_number LIKE ? OR gd.title LIKE ? OR c.full_name LIKE ? OR v.matricule LIKE ? OR rc.contract_number LIKE ?)');
    const q = `%${filter.search.trim()}%`;
    args.push(q, q, q, q, q);
  }
  if (filter?.documentKind) {
    clauses.push('gd.document_kind = ?');
    args.push(filter.documentKind);
  }
  if (filter?.format) {
    clauses.push('gd.format = ?');
    args.push(filter.format);
  }
  if (filter?.customerId) {
    clauses.push('gd.customer_id = ?');
    args.push(filter.customerId);
  }
  if (filter?.vehicleId) {
    clauses.push('gd.vehicle_id = ?');
    args.push(filter.vehicleId);
  }
  if (filter?.contractId) {
    clauses.push('gd.contract_id = ?');
    args.push(filter.contractId);
  }
  if (filter?.dateFrom) {
    clauses.push('substr(gd.created_at, 1, 10) >= ?');
    args.push(filter.dateFrom.slice(0, 10));
  }
  if (filter?.dateTo) {
    clauses.push('substr(gd.created_at, 1, 10) <= ?');
    args.push(filter.dateTo.slice(0, 10));
  }
  if (filter?.isCopy !== undefined) {
    clauses.push('gd.is_copy = ?');
    args.push(filter.isCopy ? 1 : 0);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, Number(filter?.limit ?? 200)));

  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT gd.*,
              src.document_number AS source_document_number,
              c.full_name AS customer_name,
              CASE WHEN v.id IS NOT NULL THEN v.brand || ' ' || v.model || ' (' || v.matricule || ')' ELSE NULL END AS vehicle_label,
              rc.contract_number AS contract_number
       FROM generated_documents gd
       LEFT JOIN generated_documents src ON src.id = gd.source_document_id
       LEFT JOIN customers c ON c.id = gd.customer_id
       LEFT JOIN vehicles v ON v.id = gd.vehicle_id
       LEFT JOIN rental_contracts rc ON rc.id = gd.contract_id
       ${where}
       ORDER BY gd.created_at DESC, gd.id DESC
       LIMIT ?`
    )
    .all(...args, limit);

  return rows.map(mapGeneratedDocument);
}

export function getDocumentById(db: Database.Database, documentId: number): GeneratedDocument {
  const row = db
    .prepare<[number], any>(
      `SELECT gd.*,
              src.document_number AS source_document_number,
              c.full_name AS customer_name,
              CASE WHEN v.id IS NOT NULL THEN v.brand || ' ' || v.model || ' (' || v.matricule || ')' ELSE NULL END AS vehicle_label,
              rc.contract_number AS contract_number
       FROM generated_documents gd
       LEFT JOIN generated_documents src ON src.id = gd.source_document_id
       LEFT JOIN customers c ON c.id = gd.customer_id
       LEFT JOIN vehicles v ON v.id = gd.vehicle_id
       LEFT JOIN rental_contracts rc ON rc.id = gd.contract_id
       WHERE gd.id = ?`
    )
    .get(documentId);
  if (!row) throw new AuthError('NOT_FOUND', 'Document introuvable dans les archives');
  return mapGeneratedDocument(row);
}

export function readArchivedDocumentPdf(
  db: Database.Database,
  vaultRootDir: string,
  vaultKey: Buffer,
  documentId: number
): { document: GeneratedDocument; originalFileName: string; mimeType: string; base64Data: string } {
  const doc = getDocumentById(db, documentId);
  const fullPath = resolveConfinedPath(vaultRootDir, doc.filePath);
  if (!fs.existsSync(fullPath)) {
    throw new AuthError(
      'NOT_FOUND',
      `Fichier PDF archivé introuvable dans le coffre (${doc.documentNumber}).`
    );
  }
  const encryptedBytes = fs.readFileSync(fullPath);
  const plainBytes = decryptBuffer(encryptedBytes, vaultKey);
  return {
    document: doc,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    base64Data: plainBytes.toString('base64'),
  };
}

export function recordDocumentPrintEvent(
  db: Database.Database,
  actor: { id: number; username: string },
  documentId: number,
  details: { printerName?: string | null; copies?: number; silent?: boolean }
): GeneratedDocument {
  const existing = getDocumentById(db, documentId);
  db.prepare(
    `UPDATE generated_documents
     SET last_printed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         last_printed_by_user_id = ?
     WHERE id = ?`
  ).run(actor.id, documentId);

  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'DOCUMENT_PRINTED',
    entityType: 'generated_documents',
    entityId: documentId,
    newValue: {
      documentNumber: existing.documentNumber,
      printerName: details.printerName ?? 'system-default',
      copies: details.copies ?? 1,
      silent: Boolean(details.silent),
    },
  });

  return getDocumentById(db, documentId);
}
