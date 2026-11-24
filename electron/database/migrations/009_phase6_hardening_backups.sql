-- ============================================================================
-- Migration 009: Phase 6 Production Hardening, Database Health & Backups
-- Strictly additive / backward-compatible migration.
-- ============================================================================

-- 1. Database Health permission (ADMIN only)
INSERT OR IGNORE INTO permissions (code, module, description_fr, description_ar) VALUES
  ('db:health', 'backups', 'Consulter la santé et l''intégrité de la base de données', 'فحص سلامة وتكامل قاعدة البيانات');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('db:health', 'backups:manage', 'backups:restore')
WHERE r.code = 'ADMIN';

-- 2. Extend backup_records with verifiable metadata, schema/app versions, and vault attachment tracking
ALTER TABLE backup_records ADD COLUMN file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE backup_records ADD COLUMN app_version TEXT NOT NULL DEFAULT '1.0.0';
ALTER TABLE backup_records ADD COLUMN schema_version TEXT NOT NULL DEFAULT '009';
ALTER TABLE backup_records ADD COLUMN includes_vault INTEGER NOT NULL DEFAULT 1;
ALTER TABLE backup_records ADD COLUMN attachment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backup_records ADD COLUMN backup_format TEXT NOT NULL DEFAULT 'AGENCY_BACKUP_V1';
ALTER TABLE backup_records ADD COLUMN is_encrypted INTEGER NOT NULL DEFAULT 1;
ALTER TABLE backup_records ADD COLUMN encryption_mode TEXT NOT NULL DEFAULT 'VAULT_RECOVERY_KEY';
ALTER TABLE backup_records ADD COLUMN recovery_key_fingerprint TEXT;
ALTER TABLE backup_records ADD COLUMN verified_at TEXT;
ALTER TABLE backup_records ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE backup_records ADD COLUMN verification_summary_json TEXT;
ALTER TABLE backup_records ADD COLUMN triggered_by_username TEXT;
ALTER TABLE backup_records ADD COLUMN notes TEXT;

-- 3. Additional performance indexes for production scale (1,000+ contracts/customers/payments)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status_date ON expenses(status, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_expected_return ON rental_contracts(status, expected_return_date);
CREATE INDEX IF NOT EXISTS idx_payments_date ON contract_payments(payment_date DESC, direction);
CREATE INDEX IF NOT EXISTS idx_backup_records_created ON backup_records(created_at DESC, backup_type);
