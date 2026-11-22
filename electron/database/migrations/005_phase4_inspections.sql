-- ============================================================================
-- Phase 4 Step 1: Vehicle Inspections (Departure & Return) & Damage Management
-- ============================================================================

-- 1. Seed granular inspection permissions (preserving legacy inspections:write)
INSERT OR IGNORE INTO permissions (code, module, description_fr, description_ar) VALUES
  ('inspections:view', 'inspections', 'Consulter les états des lieux et dommages', 'عرض محاضر المعاينة والأضرار'),
  ('inspections:create', 'inspections', 'Créer un état des lieux (départ / retour)', 'إنشاء محضر معاينة (انطلاق / إرجاع)'),
  ('inspections:update', 'inspections', 'Modifier un état des lieux en brouillon', 'تعديل مسودة محضر المعاينة'),
  ('inspections:finalize', 'inspections', 'Valider définitivement un état des lieux', 'اعتماد محضر المعاينة نهائياً'),
  ('inspections:manage_damage', 'inspections', 'Gérer le suivi et la résolution des dommages', 'تسيير ومتابعة إصلاح الأضرار');

-- Grant all new permissions to ADMIN
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN'
  AND p.code IN (
    'inspections:view',
    'inspections:create',
    'inspections:update',
    'inspections:finalize',
    'inspections:manage_damage'
  );

-- Grant operational inspection permissions to AGENT
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
  'inspections:view',
  'inspections:create',
  'inspections:update',
  'inspections:finalize'
)
WHERE r.code = 'AGENT';

-- 2. Extend vehicle_inspections for lifecycle lock & return deltas
ALTER TABLE vehicle_inspections ADD COLUMN status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINALIZED'));
ALTER TABLE vehicle_inspections ADD COLUMN customer_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (customer_acknowledged IN (0, 1));
ALTER TABLE vehicle_inspections ADD COLUMN customer_acknowledgment_notes TEXT;
ALTER TABLE vehicle_inspections ADD COLUMN late_return_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_return_minutes >= 0);
ALTER TABLE vehicle_inspections ADD COLUMN mileage_delta_km INTEGER CHECK (mileage_delta_km IS NULL OR mileage_delta_km >= 0);
ALTER TABLE vehicle_inspections ADD COLUMN finalized_at TEXT;
ALTER TABLE vehicle_inspections ADD COLUMN finalized_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE vehicle_inspections ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

UPDATE vehicle_inspections SET updated_at = created_at WHERE updated_at = '1970-01-01T00:00:00.000Z';

-- 3. Extend inspection_items with structured categories and display ordering
ALTER TABLE inspection_items ADD COLUMN category TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE inspection_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- 4. Create structured vehicle_damages table
CREATE TABLE IF NOT EXISTS vehicle_damages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  damage_code TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  contract_id INTEGER REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  inspection_id INTEGER REFERENCES vehicle_inspections(id) ON DELETE RESTRICT,
  zone_code TEXT NOT NULL,
  diagram_x REAL CHECK (diagram_x IS NULL OR (diagram_x >= 0 AND diagram_x <= 100)),
  diagram_y REAL CHECK (diagram_y IS NULL OR (diagram_y >= 0 AND diagram_y <= 100)),
  damage_type TEXT NOT NULL CHECK (damage_type IN ('SCRATCH', 'DENT', 'CRACK', 'BROKEN', 'MISSING_ACCESSORY', 'OTHER')),
  severity TEXT NOT NULL CHECK (severity IN ('MINOR', 'MODERATE', 'MAJOR', 'CRITICAL')),
  description TEXT NOT NULL,
  is_pre_existing INTEGER NOT NULL DEFAULT 0 CHECK (is_pre_existing IN (0, 1)),
  is_newly_discovered INTEGER NOT NULL DEFAULT 0 CHECK (is_newly_discovered IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'REPORTED' CHECK (status IN ('REPORTED', 'UNDER_REVIEW', 'CONFIRMED', 'UNDER_REPAIR', 'REPAIRED', 'REJECTED')),
  estimated_repair_cost_minor INTEGER CHECK (estimated_repair_cost_minor IS NULL OR estimated_repair_cost_minor >= 0),
  repair_reference TEXT,
  linked_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  reported_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. Create immutable damage_resolution_records timeline
CREATE TABLE IF NOT EXISTS damage_resolution_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  damage_id INTEGER NOT NULL REFERENCES vehicle_damages(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL CHECK (new_status IN ('REPORTED', 'UNDER_REVIEW', 'CONFIRMED', 'UNDER_REPAIR', 'REPAIRED', 'REJECTED')),
  notes TEXT NOT NULL,
  repair_reference TEXT,
  linked_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. Extend inspection_photos for encrypted vault metadata & optional damage link
ALTER TABLE inspection_photos ADD COLUMN original_file_name TEXT;
ALTER TABLE inspection_photos ADD COLUMN mime_type TEXT;
ALTER TABLE inspection_photos ADD COLUMN damage_id INTEGER REFERENCES vehicle_damages(id) ON DELETE SET NULL;
ALTER TABLE inspection_photos ADD COLUMN uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_inspections_vehicle ON vehicle_inspections(vehicle_id, inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_contract ON vehicle_inspections(contract_id, stage);
CREATE INDEX IF NOT EXISTS idx_damages_vehicle ON vehicle_damages(vehicle_id, status, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_damages_inspection ON vehicle_damages(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_photos_insp ON inspection_photos(inspection_id, damage_id);
