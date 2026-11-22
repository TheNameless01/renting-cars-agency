-- ============================================================================
-- Migration 006: Phase 4 Step 2 — Maintenance Management & Operational Alerts
-- Extends maintenance_types, maintenance_records, permissions, and adds
-- per-vehicle maintenance schedules. Reuses existing notifications table.
-- ============================================================================

-- 1. Granular Maintenance Permissions (keeping legacy 'maintenance:write')
INSERT OR IGNORE INTO permissions (code, module, description_fr, description_ar) VALUES
  ('maintenance:view', 'maintenance', 'Consulter les maintenances et échéanciers', 'الاطلاع على الصيانة وجداولها'),
  ('maintenance:create', 'maintenance', 'Planifier ou enregistrer une maintenance', 'برمجة أو تسجيل عملية صيانة'),
  ('maintenance:update', 'maintenance', 'Modifier une intervention de maintenance', 'تعديل عملية صيانة'),
  ('maintenance:complete', 'maintenance', 'Clôturer une maintenance et libérer le véhicule', 'إنهاء الصيانة وإتاحة المركبة'),
  ('maintenance:manage_types', 'maintenance', 'Configurer les types et périodicités de maintenance', 'إعداد أنواع الصيانة والفترات');

-- Grant all new maintenance permissions to ADMIN
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN'
  AND p.code IN (
    'maintenance:view',
    'maintenance:create',
    'maintenance:update',
    'maintenance:complete',
    'maintenance:manage_types'
  );

-- Grant operational maintenance permissions to AGENT (excluding manage_types)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
ON p.code IN (
  'maintenance:view',
  'maintenance:create',
  'maintenance:update',
  'maintenance:complete'
)
WHERE r.code = 'AGENT';

-- 2. Seed additional standard Algerian fleet maintenance types
INSERT OR IGNORE INTO maintenance_types (
  code, name_fr, name_ar, default_km_interval, default_day_interval, km_warning_threshold, day_warning_threshold
) VALUES
  ('CABIN_FILTER', 'Filtre d''habitacle', 'فلتر المقصورة', 15000, 365, 1000, 14),
  ('TIMING_CHAIN', 'Chaîne de distribution', 'سلسلة التوزيع', 120000, NULL, 5000, 30),
  ('BRAKES', 'Système de freinage complet', 'نظام الفرامل الكامل', 40000, 730, 2000, 30),
  ('COOLING_SYSTEM', 'Circuit de refroidissement', 'نظام التبريد', 40000, 730, 2000, 30),
  ('AIR_CONDITIONING', 'Climatisation', 'مكيف الهواء', NULL, 365, 0, 14),
  ('SUSPENSION', 'Suspension & Amortisseurs', 'نظام التعليق وممتص الصدمات', 60000, NULL, 3000, 30),
  ('ELECTRICAL', 'Système électrique & Diagnostic', 'النظام الكهربائي والتشخيص', NULL, 365, 0, 14),
  ('OTHER', 'Autre intervention', 'تدخل صيانة آخر', NULL, NULL, 0, 0);

-- 3. Per-vehicle configurable maintenance schedules
CREATE TABLE IF NOT EXISTS vehicle_maintenance_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_type_id INTEGER NOT NULL REFERENCES maintenance_types(id) ON DELETE CASCADE,
  km_interval INTEGER CHECK (km_interval IS NULL OR km_interval > 0),
  day_interval INTEGER CHECK (day_interval IS NULL OR day_interval > 0),
  km_warning_threshold INTEGER NOT NULL DEFAULT 1000 CHECK (km_warning_threshold >= 0),
  day_warning_threshold INTEGER NOT NULL DEFAULT 14 CHECK (day_warning_threshold >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (vehicle_id, maintenance_type_id)
);

-- 4. Extend maintenance_records for full operational lifecycle & finance/availability integration
ALTER TABLE maintenance_records
  ADD COLUMN record_number TEXT;

ALTER TABLE maintenance_records
  ADD COLUMN status TEXT NOT NULL DEFAULT 'COMPLETED'
    CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'));

ALTER TABLE maintenance_records
  ADD COLUMN is_emergency INTEGER NOT NULL DEFAULT 0 CHECK (is_emergency IN (0, 1));

ALTER TABLE maintenance_records
  ADD COLUMN scheduled_start_date TEXT;

ALTER TABLE maintenance_records
  ADD COLUMN scheduled_end_date TEXT;

ALTER TABLE maintenance_records
  ADD COLUMN technician_name TEXT;

ALTER TABLE maintenance_records
  ADD COLUMN notes TEXT;

ALTER TABLE maintenance_records
  ADD COLUMN invoice_original_name TEXT;

ALTER TABLE maintenance_records
  ADD COLUMN invoice_mime_type TEXT;

ALTER TABLE maintenance_records
  ADD COLUMN blocked_period_id INTEGER REFERENCES vehicle_blocked_periods(id) ON DELETE SET NULL;

ALTER TABLE maintenance_records
  ADD COLUMN parts_consumed_locked INTEGER NOT NULL DEFAULT 0 CHECK (parts_consumed_locked IN (0, 1));

ALTER TABLE maintenance_records
  ADD COLUMN completed_at TEXT;

ALTER TABLE maintenance_records
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z';

CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_record_number
  ON maintenance_records(record_number)
  WHERE record_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_status
  ON maintenance_records(status, vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_maint_schedules_vehicle
  ON vehicle_maintenance_schedules(vehicle_id, is_active);

CREATE INDEX IF NOT EXISTS idx_notifications_entity
  ON notifications(entity_type, entity_id, is_resolved);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_unique_posted_maintenance
  ON expenses(maintenance_record_id)
  WHERE maintenance_record_id IS NOT NULL AND status = 'POSTED';
