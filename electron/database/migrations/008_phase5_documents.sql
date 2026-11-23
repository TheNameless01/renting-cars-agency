-- Phase 5: Centralized Documents, PDF Generation, Printing, Customer Document Expiry & Reporting
-- Strictly additive/backward-compatible migration.

-- 1. Granular Phase 5 permissions (keep legacy documents:generate and reports:view intact)
INSERT OR IGNORE INTO permissions (code, module, description_fr, description_ar) VALUES
  ('documents:view', 'documents', 'Consulter et prévisualiser les archives documentaires', 'الاطلاع على الأرشيف الوثائقي ومعاينته'),
  ('documents:reprint', 'documents', 'Réimprimer et générer une copie certifiée d''un document existant', 'إعادة طباعة وإصدار نسخة مطابقة لوثيقة موجودة'),
  ('documents:manage_templates', 'documents', 'Configurer les modèles de documents, en-têtes, mentions et imprimantes', 'تعديل قوالب الوثائق والترويسة والإعدادات والطابعات'),
  ('reports:export', 'reports', 'Exporter les rapports financiers, flotte et opérationnels en PDF, CSV et Excel', 'تصدير التقارير المالية والأسطول والتشغيلية بصيغ PDF وCSV وExcel');

-- Grant view & reprint to AGENT (generate already granted in 002); keep manage_templates and reports:export ADMIN-only by default
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('documents:view', 'documents:reprint')
WHERE r.code = 'AGENT';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('documents:view', 'documents:reprint', 'documents:manage_templates', 'reports:export')
WHERE r.code = 'ADMIN';

-- 2. Upgrade generated_documents schema to cover all 16 business/report document kinds,
--    all 4 physical formats (including A4_LANDSCAPE_PDF), copy lineage, and immutable JSON snapshots.
CREATE TABLE IF NOT EXISTS generated_documents_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_number TEXT NOT NULL UNIQUE,
  document_kind TEXT NOT NULL CHECK (document_kind IN (
    'RENTAL_CONTRACT',
    'CONTRACT_AMENDMENT',
    'DEPARTURE_INSPECTION',
    'RETURN_INSPECTION',
    'DAMAGE_REPORT',
    'PAYMENT_RECEIPT',
    'DEPOSIT_RECEIPT',
    'DEPOSIT_SETTLEMENT',
    'INVOICE',
    'EXPENSE_RECEIPT',
    'MAINTENANCE_REPORT',
    'VEHICLE_HISTORY',
    'CUSTOMER_STATEMENT',
    'CASH_REGISTER_CLOSING',
    'FINANCIAL_SUMMARY',
    'CUSTOM_REPORT'
  )),
  format TEXT NOT NULL CHECK (format IN ('A4_PDF', 'A4_LANDSCAPE_PDF', 'THERMAL_80MM', 'THERMAL_58MM')),
  title TEXT NOT NULL DEFAULT 'Document',
  language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'ar')),
  numeral_system TEXT NOT NULL DEFAULT 'latin' CHECK (numeral_system IN ('latin', 'arabic')),
  contract_id INTEGER REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  payment_id INTEGER REFERENCES contract_payments(id) ON DELETE RESTRICT,
  deposit_id INTEGER REFERENCES deposits(id) ON DELETE RESTRICT,
  inspection_id INTEGER REFERENCES vehicle_inspections(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE RESTRICT,
  maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE RESTRICT,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE RESTRICT,
  cash_session_id INTEGER REFERENCES cash_register_sessions(id) ON DELETE RESTRICT,
  is_copy INTEGER NOT NULL DEFAULT 0 CHECK (is_copy IN (0, 1)),
  source_document_id INTEGER REFERENCES generated_documents_v5(id) ON DELETE RESTRICT,
  reprint_count INTEGER NOT NULL DEFAULT 0 CHECK (reprint_count >= 0),
  template_version INTEGER NOT NULL DEFAULT 1,
  generation_status TEXT NOT NULL DEFAULT 'READY' CHECK (generation_status IN ('READY', 'FAILED')),
  file_path TEXT NOT NULL,
  original_file_name TEXT NOT NULL DEFAULT 'document.pdf',
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  sha256_hash TEXT,
  metadata_snapshot_json TEXT NOT NULL DEFAULT '{}',
  template_snapshot_json TEXT NOT NULL DEFAULT '{}',
  generated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  generated_by_username TEXT NOT NULL DEFAULT 'system',
  last_printed_at TEXT,
  last_printed_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO generated_documents_v5 (
  id, document_number, document_kind, format, title, language, numeral_system,
  contract_id, payment_id, deposit_id, inspection_id, invoice_id,
  file_path, original_file_name, reprint_count,
  generated_by_user_id, generated_by_username, created_at
)
SELECT
  gd.id,
  gd.document_number,
  gd.document_kind,
  gd.format,
  gd.document_number,
  'fr',
  'latin',
  gd.contract_id,
  gd.payment_id,
  gd.deposit_id,
  gd.inspection_id,
  gd.invoice_id,
  gd.file_path,
  gd.document_number || '.pdf',
  gd.reprint_count,
  gd.generated_by_user_id,
  COALESCE((SELECT u.username FROM users u WHERE u.id = gd.generated_by_user_id), 'system'),
  gd.created_at
FROM generated_documents gd;

DROP TABLE generated_documents;
ALTER TABLE generated_documents_v5 RENAME TO generated_documents;

CREATE INDEX IF NOT EXISTS idx_gen_docs_kind_date ON generated_documents(document_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen_docs_customer ON generated_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_gen_docs_vehicle ON generated_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_gen_docs_contract ON generated_documents(contract_id);
CREATE INDEX IF NOT EXISTS idx_gen_docs_source ON generated_documents(source_document_id);
CREATE INDEX IF NOT EXISTS idx_gen_docs_created ON generated_documents(created_at DESC);

-- 3. Extend invoices table for discount, currency, configurable tax rate & notes
ALTER TABLE invoices ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN currency TEXT NOT NULL DEFAULT 'DZD';
ALTER TABLE invoices ADD COLUMN tax_rate_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN notes TEXT;

-- 4. Upgrade customer_documents with expiration tracking, reminder lead time, notes & non-destructive replacement
ALTER TABLE customer_documents ADD COLUMN document_number TEXT;
ALTER TABLE customer_documents ADD COLUMN issue_date TEXT;
ALTER TABLE customer_documents ADD COLUMN expiration_date TEXT;
ALTER TABLE customer_documents ADD COLUMN reminder_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE customer_documents ADD COLUMN notes TEXT;
ALTER TABLE customer_documents ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_documents ADD COLUMN replaces_doc_id INTEGER REFERENCES customer_documents(id) ON DELETE RESTRICT;
ALTER TABLE customer_documents ADD COLUMN replaced_by_doc_id INTEGER REFERENCES customer_documents(id) ON DELETE RESTRICT;
ALTER TABLE customer_documents ADD COLUMN archived_at TEXT;
ALTER TABLE customer_documents ADD COLUMN archived_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_customer_docs_exp ON customer_documents(customer_id, is_archived, expiration_date);

-- 5. Seed configurable document template, branding, numbering & printing settings
INSERT OR IGNORE INTO application_settings (setting_key, setting_group, setting_value) VALUES
  ('agency.logo_vault_path', 'agency', ''),
  ('agency.logo_mime_type', 'agency', ''),
  ('documents.default_language', 'documents', 'fr'),
  ('documents.default_format', 'documents', 'A4_PDF'),
  ('documents.thermal_width', 'documents', '80MM'),
  ('documents.default_printer_a4', 'documents', ''),
  ('documents.default_printer_thermal', 'documents', ''),
  ('documents.show_logo', 'documents', '1'),
  ('documents.show_fiscal_ids', 'documents', '1'),
  ('documents.show_signature_boxes', 'documents', '1'),
  ('documents.invoice_fiscally_compliant', 'documents', '0'),
  ('documents.invoice_tax_rate_percent', 'documents', '0'),
  ('documents.template_version', 'documents', '1'),
  ('documents.footer_fr', 'documents', 'Document généré localement par le système de gestion de l''agence. Conserver ce justificatif.'),
  ('documents.footer_ar', 'documents', 'وثيقة صادرة محلياً عن نظام تسيير الوكالة. يرجى الاحتفاظ بهذا المستند.'),
  ('documents.signature_agency_fr', 'documents', 'Cachet & signature de l''agence'),
  ('documents.signature_agency_ar', 'documents', 'ختم وتوقيع الوكالة'),
  ('documents.signature_customer_fr', 'documents', 'Lu et approuvé — Signature du client'),
  ('documents.signature_customer_ar', 'documents', 'قرئ وصودق عليه — توقيع الزبون'),
  ('documents.contract_terms_fr', 'documents', 'Le locataire s''engage à restituer le véhicule dans l''état constaté au départ, à la date prévue au contrat, et demeure responsable des contraventions routières commises durant la location.'),
  ('documents.contract_terms_ar', 'documents', 'يلتزم المستأجر بإرجاع المركبة في الحالة المعاينة عند الانطلاق وفي التاريخ المحدد بالعقد، ويبقى مسؤولاً عن المخالفات المرورية المسجلة طوال مدة الكراء.'),
  ('documents.invoice_disclaimer_fr', 'documents', 'Document de facturation généré localement selon la configuration de l''agence.'),
  ('documents.invoice_disclaimer_ar', 'documents', 'فاتورة صادرة محلياً وفق الإعدادات المعتمدة من طرف الوكالة.'),
  ('documents.prefix_RENTAL_CONTRACT', 'documents', 'CTR'),
  ('documents.prefix_CONTRACT_AMENDMENT', 'documents', 'AVN'),
  ('documents.prefix_DEPARTURE_INSPECTION', 'documents', 'EDL-D'),
  ('documents.prefix_RETURN_INSPECTION', 'documents', 'EDL-R'),
  ('documents.prefix_DAMAGE_REPORT', 'documents', 'DMG'),
  ('documents.prefix_PAYMENT_RECEIPT', 'documents', 'REC'),
  ('documents.prefix_DEPOSIT_RECEIPT', 'documents', 'CAU'),
  ('documents.prefix_DEPOSIT_SETTLEMENT', 'documents', 'DEC'),
  ('documents.prefix_INVOICE', 'documents', 'FAC'),
  ('documents.prefix_EXPENSE_RECEIPT', 'documents', 'DEP'),
  ('documents.prefix_MAINTENANCE_REPORT', 'documents', 'MNT'),
  ('documents.prefix_VEHICLE_HISTORY', 'documents', 'HIST'),
  ('documents.prefix_CUSTOMER_STATEMENT', 'documents', 'REL'),
  ('documents.prefix_CASH_REGISTER_CLOSING', 'documents', 'CAI'),
  ('documents.prefix_FINANCIAL_SUMMARY', 'documents', 'FIN'),
  ('documents.prefix_CUSTOM_REPORT', 'documents', 'RPT');
