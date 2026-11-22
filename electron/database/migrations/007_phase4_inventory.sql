-- ============================================================================
-- Migration 007: Phase 4 Step 3 — Spare Parts Inventory & Supplier Management
-- Extends suppliers, inventory_parts, inventory_movements, and adds granular
-- inventory RBAC permissions (with Admin-only stock adjustment).
-- ============================================================================

-- 1. Granular Inventory Permissions (keeping legacy inventory:read / inventory:write)
INSERT OR IGNORE INTO permissions (code, module, description_fr, description_ar) VALUES
  ('inventory:view', 'inventory', 'Consulter le catalogue et les mouvements de stock', 'الاطلاع على مخزون قطع الغيار والحركات'),
  ('inventory:manage_parts', 'inventory', 'Créer ou modifier des fiches de pièces détachées', 'إنشاء أو تعديل بطاقات قطع الغيار'),
  ('inventory:record_movements', 'inventory', 'Enregistrer des achats, entrées, sorties et retours de stock', 'تسجيل المشتريات والإدخالات والإخراجات والمرتجعات'),
  ('inventory:manage_suppliers', 'inventory', 'Gérer les fournisseurs et garages partenaires', 'إدارة الموردين وورشات الصيانة'),
  ('inventory:adjust_stock', 'inventory', 'Effectuer un ajustement d''inventaire (Admin uniquement)', 'تعديل كميات الجرد يدوياً (للمدير فقط)');

-- Grant all inventory permissions to ADMIN
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN'
  AND p.code IN (
    'inventory:view',
    'inventory:manage_parts',
    'inventory:record_movements',
    'inventory:manage_suppliers',
    'inventory:adjust_stock'
  );

-- Grant standard operational inventory permissions to AGENT (excluding adjust_stock)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
ON p.code IN (
  'inventory:view',
  'inventory:manage_parts',
  'inventory:record_movements',
  'inventory:manage_suppliers'
)
WHERE r.code = 'AGENT';

-- 2. Extend suppliers for full directory management (inventory + finance + maintenance)
ALTER TABLE suppliers ADD COLUMN email TEXT;
ALTER TABLE suppliers ADD COLUMN wilaya_code TEXT;
ALTER TABLE suppliers ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_suppliers_archived
  ON suppliers(is_archived, name);

-- 3. Extend inventory_parts with unit, vehicle compatibility, and archive flag
ALTER TABLE inventory_parts ADD COLUMN unit_label TEXT NOT NULL DEFAULT 'PIECE';
ALTER TABLE inventory_parts ADD COLUMN compatible_models TEXT;
ALTER TABLE inventory_parts ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_inventory_parts_stock
  ON inventory_parts(is_archived, quantity_available, minimum_stock);

-- 4. Recreate inventory_movements to expand movement_type CHECK and link vehicle/supplier/expense
CREATE TABLE inventory_movements_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES inventory_parts(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('INITIAL_STOCK', 'PURCHASE', 'ENTRY', 'WITHDRAWAL', 'MAINTENANCE_USE', 'RETURN', 'ADJUSTMENT')
  ),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
  maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE RESTRICT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  reference_code TEXT,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  movement_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now')),
  notes TEXT,
  override_reason TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO inventory_movements_new (
  id, part_id, movement_type, quantity_delta, unit_cost_minor,
  maintenance_record_id, movement_date, notes, override_reason,
  recorded_by_user_id, created_at
)
SELECT
  id, part_id, movement_type, quantity_delta, unit_cost_minor,
  maintenance_record_id, substr(created_at, 1, 10), notes, override_reason,
  recorded_by_user_id, created_at
FROM inventory_movements;

DROP TABLE inventory_movements;
ALTER TABLE inventory_movements_new RENAME TO inventory_movements;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_part
  ON inventory_movements(part_id, movement_date, id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_maintenance
  ON inventory_movements(maintenance_record_id);
