-- ============================================================================
-- Migration 001: Initial Algerian Car Rental Management ERP Schema
-- Monetary convention: ALL currency values stored as INTEGER minor units (centimes).
-- Date/time convention: ISO-8601 UTC strings; business day calculations in Africa/Algiers.
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- 1. USERS, ROLES & PERMISSIONS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('ADMIN', 'AGENT')),
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  description_fr TEXT NOT NULL,
  description_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  preferred_language TEXT NOT NULL DEFAULT 'fr' CHECK (preferred_language IN ('fr', 'ar')),
  preferred_theme TEXT NOT NULL DEFAULT 'light' CHECK (preferred_theme IN ('light', 'dark')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted INTEGER NOT NULL DEFAULT 1 CHECK (granted IN (0, 1)),
  granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- 2. FLEET MANAGEMENT
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_code TEXT NOT NULL UNIQUE,
  matricule TEXT NOT NULL UNIQUE,
  vin TEXT UNIQUE,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year >= 1980 AND year <= 2050),
  color TEXT NOT NULL,
  category TEXT NOT NULL,
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('ESSENCE', 'DIESEL', 'GPL', 'OTHER')),
  transmission TEXT NOT NULL CHECK (transmission IN ('MANUAL', 'AUTOMATIC')),
  seats INTEGER NOT NULL DEFAULT 5 CHECK (seats >= 2 AND seats <= 9),
  current_odometer_km INTEGER NOT NULL DEFAULT 0 CHECK (current_odometer_km >= 0),
  acquisition_date TEXT,
  acquisition_cost_minor INTEGER CHECK (acquisition_cost_minor IS NULL OR acquisition_cost_minor >= 0),
  default_daily_rate_minor INTEGER NOT NULL DEFAULT 0 CHECK (default_daily_rate_minor >= 0),
  default_weekly_rate_minor INTEGER CHECK (default_weekly_rate_minor IS NULL OR default_weekly_rate_minor >= 0),
  default_monthly_rate_minor INTEGER CHECK (default_monthly_rate_minor IS NULL OR default_monthly_rate_minor >= 0),
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'RENTED', 'RESERVED', 'MAINTENANCE')),
  notes TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('CARTE_GRISE', 'ASSURANCE', 'VIGNETTE', 'CONTROLE_TECHNIQUE')),
  document_number TEXT,
  issue_date TEXT,
  expiration_date TEXT NOT NULL,
  reminder_days INTEGER NOT NULL DEFAULT 30 CHECK (reminder_days >= 0),
  file_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS vehicle_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  caption TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- 3. CUSTOMERS & RISK MANAGEMENT
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_type TEXT NOT NULL CHECK (customer_type IN ('INDIVIDUAL', 'COMPANY')),
  full_name TEXT NOT NULL,
  date_of_birth TEXT,
  phone TEXT NOT NULL,
  secondary_phone TEXT,
  address TEXT,
  wilaya_code TEXT,
  commune TEXT,
  cni_number TEXT,
  passport_number TEXT,
  driving_licence_number TEXT,
  driving_licence_issue_date TEXT,
  driving_licence_expiration_date TEXT,
  risk_status TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_status IN ('LOW', 'MEDIUM', 'HIGH', 'BLACKLISTED')),
  internal_notes TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS customer_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  legal_representative TEXT NOT NULL,
  rc_number TEXT,
  nif_number TEXT,
  nis_number TEXT,
  art_number TEXT,
  bon_de_commande_number TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS customer_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  doc_category TEXT NOT NULL CHECK (doc_category IN ('CNI', 'PASSPORT', 'DRIVING_LICENCE', 'COMPANY_RC', 'COMPANY_NIF', 'BON_COMMANDE', 'OTHER')),
  encrypted_file_path TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS customer_risk_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'BLACKLISTED')),
  reason TEXT NOT NULL CHECK (reason IN ('UNPAID_DEBT', 'TRAFFIC_FINE', 'RADAR_FINE', 'VEHICLE_DAMAGE', 'LATE_RETURN', 'CONTRACT_VIOLATION', 'OTHER')),
  description TEXT NOT NULL,
  incident_date TEXT NOT NULL,
  evidence_file_path TEXT,
  reported_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0, 1)),
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- 4. RESERVATIONS & RENTAL CONTRACTS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  start_date TEXT NOT NULL,
  expected_return_date TEXT NOT NULL,
  estimated_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (estimated_total_minor >= 0),
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING', 'CONFIRMED', 'CONVERTED', 'CANCELLED', 'NO_SHOW')),
  notes TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expected_return_date > start_date)
);

CREATE TABLE IF NOT EXISTS rental_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_number TEXT NOT NULL UNIQUE,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'ACTIVE', 'EXTENDED', 'COMPLETED', 'CANCELLED')),
  start_date TEXT NOT NULL,
  original_end_date TEXT NOT NULL,
  expected_return_date TEXT NOT NULL,
  actual_return_date TEXT,
  departure_odometer_km INTEGER NOT NULL CHECK (departure_odometer_km >= 0),
  return_odometer_km INTEGER CHECK (return_odometer_km IS NULL OR return_odometer_km >= 0),
  odometer_correction_reason TEXT,
  mileage_mode TEXT NOT NULL DEFAULT 'DAILY_ALLOWANCE' CHECK (mileage_mode IN ('UNLIMITED', 'DAILY_ALLOWANCE', 'CUSTOM_TOTAL')),
  daily_mileage_allowance_km INTEGER CHECK (daily_mileage_allowance_km IS NULL OR daily_mileage_allowance_km >= 0),
  included_total_km INTEGER CHECK (included_total_km IS NULL OR included_total_km >= 0),
  extra_km_rate_minor INTEGER NOT NULL DEFAULT 0 CHECK (extra_km_rate_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'DZD' CHECK (currency IN ('DZD', 'EUR')),
  base_rental_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (base_rental_total_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  extension_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (extension_total_minor >= 0),
  extra_km_charge_minor INTEGER NOT NULL DEFAULT 0 CHECK (extra_km_charge_minor >= 0),
  late_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (late_fee_minor >= 0),
  damage_charge_minor INTEGER NOT NULL DEFAULT 0 CHECK (damage_charge_minor >= 0),
  other_charges_minor INTEGER NOT NULL DEFAULT 0 CHECK (other_charges_minor >= 0),
  total_contract_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_contract_amount_minor >= 0),
  blacklist_override_reason TEXT,
  blacklist_override_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  closed_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expected_return_date >= original_end_date),
  CHECK (original_end_date > start_date)
);

CREATE TABLE IF NOT EXISTS rental_extensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  previous_return_date TEXT NOT NULL,
  new_return_date TEXT NOT NULL,
  added_days INTEGER NOT NULL CHECK (added_days > 0),
  additional_amount_minor INTEGER NOT NULL CHECK (additional_amount_minor >= 0),
  additional_km_allowance INTEGER NOT NULL DEFAULT 0 CHECK (additional_km_allowance >= 0),
  notes TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (new_return_date > previous_return_date)
);

CREATE TABLE IF NOT EXISTS contract_pricing_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL CHECK (item_type IN ('DAILY_RATE', 'WEEKLY_RATE', 'MONTHLY_RATE', 'SEASONAL_RATE', 'CUSTOM_RATE', 'FIXED_DISCOUNT', 'PERCENT_DISCOUNT', 'EXTRA_KM', 'LATE_FEE', 'DAMAGE', 'ADJUSTMENT')),
  label TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  is_authorized_adjustment INTEGER NOT NULL DEFAULT 0 CHECK (is_authorized_adjustment IN (0, 1)),
  authorized_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- 5. PAYMENTS, DEPOSITS & FINES (STRICT SEPARATION)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contract_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_code TEXT NOT NULL UNIQUE,
  receipt_number TEXT NOT NULL UNIQUE,
  contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('INFLOW', 'REFUND')),
  method TEXT NOT NULL CHECK (method IN ('CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER')),
  payment_reference TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'DZD' CHECK (currency IN ('DZD', 'EUR')),
  payment_date TEXT NOT NULL,
  description TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reversal_of_payment_id INTEGER REFERENCES contract_payments(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL UNIQUE REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'DZD' CHECK (currency IN ('DZD', 'EUR')),
  status TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'RETURNED', 'PARTIALLY_DEDUCTED', 'FULLY_DEDUCTED')),
  received_date TEXT NOT NULL,
  returned_date TEXT,
  deducted_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (deducted_amount_minor >= 0),
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_minor >= 0),
  deduction_reason TEXT,
  received_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  settled_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  supporting_doc_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (deducted_amount_minor + refunded_amount_minor <= amount_minor)
);

CREATE TABLE IF NOT EXISTS deposit_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deposit_id INTEGER NOT NULL REFERENCES deposits(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIVED', 'DEDUCTED', 'REFUNDED', 'ADJUSTMENT')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  reason TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS traffic_fines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  fine_type TEXT NOT NULL CHECK (fine_type IN ('TRAFFIC', 'RADAR', 'PARKING', 'OTHER')),
  reference_number TEXT,
  incurred_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  is_paid_by_customer INTEGER NOT NULL DEFAULT 0 CHECK (is_paid_by_customer IN (0, 1)),
  notes TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- 6. VEHICLE INSPECTIONS (ÉTAT DES LIEUX)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_number TEXT NOT NULL UNIQUE,
  contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK (stage IN ('DEPARTURE', 'RETURN')),
  odometer_km INTEGER NOT NULL CHECK (odometer_km >= 0),
  fuel_level_percent INTEGER NOT NULL CHECK (fuel_level_percent >= 0 AND fuel_level_percent <= 100),
  exterior_notes TEXT,
  interior_notes TEXT,
  agency_signature_data TEXT,
  customer_signature_data TEXT,
  inspector_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  inspected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (contract_id, stage)
);

CREATE TABLE IF NOT EXISTS inspection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  label_fr TEXT NOT NULL,
  label_ar TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('GOOD', 'DAMAGED', 'MISSING')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS inspection_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- 7. SUPPLIERS, MAINTENANCE & SPARE PARTS INVENTORY
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  specialty TEXT,
  nif_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS maintenance_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  default_km_interval INTEGER CHECK (default_km_interval IS NULL OR default_km_interval > 0),
  default_day_interval INTEGER CHECK (default_day_interval IS NULL OR default_day_interval > 0),
  km_warning_threshold INTEGER NOT NULL DEFAULT 1000 CHECK (km_warning_threshold >= 0),
  day_warning_threshold INTEGER NOT NULL DEFAULT 14 CHECK (day_warning_threshold >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  maintenance_type_id INTEGER NOT NULL REFERENCES maintenance_types(id) ON DELETE RESTRICT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  work_description TEXT NOT NULL,
  performed_date TEXT NOT NULL,
  odometer_km INTEGER NOT NULL CHECK (odometer_km >= 0),
  next_due_date TEXT,
  next_due_odometer_km INTEGER CHECK (next_due_odometer_km IS NULL OR next_due_odometer_km >= 0),
  labor_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (labor_cost_minor >= 0),
  parts_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (parts_cost_minor >= 0),
  total_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_minor >= 0),
  invoice_file_path TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS inventory_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_code TEXT NOT NULL UNIQUE,
  part_name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  minimum_stock INTEGER NOT NULL DEFAULT 1 CHECK (minimum_stock >= 0),
  unit_purchase_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_purchase_price_minor >= 0),
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  storage_location TEXT,
  last_purchase_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS maintenance_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_record_id INTEGER NOT NULL REFERENCES maintenance_records(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES inventory_parts(id) ON DELETE RESTRICT,
  quantity_used INTEGER NOT NULL CHECK (quantity_used > 0),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  total_cost_minor INTEGER NOT NULL CHECK (total_cost_minor >= 0)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES inventory_parts(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('PURCHASE', 'ENTRY', 'WITHDRAWAL', 'MAINTENANCE_USE', 'ADJUSTMENT')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
  maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE RESTRICT,
  notes TEXT,
  override_reason TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- 8. EXPENSES & CASH REGISTER
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_number TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('MAINTENANCE', 'REPAIRS', 'SPARE_PARTS', 'INSURANCE', 'VIGNETTE', 'TECHNICAL_INSPECTION', 'CLEANING', 'ADMINISTRATIVE', 'OTHER')),
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE RESTRICT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'DZD' CHECK (currency IN ('DZD', 'EUR')),
  expense_date TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER')),
  description TEXT NOT NULL,
  receipt_file_path TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS cash_register_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  cash_received_minor INTEGER NOT NULL DEFAULT 0 CHECK (cash_received_minor >= 0),
  cash_refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK (cash_refunded_minor >= 0),
  cash_expenses_minor INTEGER NOT NULL DEFAULT 0 CHECK (cash_expenses_minor >= 0),
  expected_closing_minor INTEGER NOT NULL DEFAULT 0,
  actual_closing_minor INTEGER,
  discrepancy_minor INTEGER,
  discrepancy_notes TEXT,
  opened_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  closed_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS cash_register_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES cash_register_sessions(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('PAYMENT_INFLOW', 'PAYMENT_REFUND', 'DEPOSIT_INFLOW', 'DEPOSIT_REFUND', 'EXPENSE', 'ADJUSTMENT')),
  amount_minor INTEGER NOT NULL,
  payment_id INTEGER REFERENCES contract_payments(id) ON DELETE RESTRICT,
  deposit_movement_id INTEGER REFERENCES deposit_movements(id) ON DELETE RESTRICT,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE RESTRICT,
  description TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- 9. INVOICES, DOCUMENTS, NOTIFICATIONS, AUDIT, SETTINGS & BACKUPS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  issue_date TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  is_fiscally_compliant INTEGER NOT NULL DEFAULT 0 CHECK (is_fiscally_compliant IN (0, 1)),
  pdf_file_path TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS generated_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_number TEXT NOT NULL UNIQUE,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('RENTAL_CONTRACT', 'DEPARTURE_INSPECTION', 'RETURN_INSPECTION', 'INVOICE', 'PAYMENT_RECEIPT', 'DEPOSIT_RECEIPT')),
  format TEXT NOT NULL CHECK (format IN ('A4_PDF', 'THERMAL_58MM', 'THERMAL_80MM')),
  contract_id INTEGER REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  payment_id INTEGER REFERENCES contract_payments(id) ON DELETE RESTRICT,
  deposit_id INTEGER REFERENCES deposits(id) ON DELETE RESTRICT,
  inspection_id INTEGER REFERENCES vehicle_inspections(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  reprint_count INTEGER NOT NULL DEFAULT 0 CHECK (reprint_count >= 0),
  generated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  title_fr TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  message_fr TEXT NOT NULL,
  message_ar TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  dedupe_key TEXT UNIQUE,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0, 1)),
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username_snapshot TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  previous_value_json TEXT,
  new_value_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS application_settings (
  setting_key TEXT PRIMARY KEY,
  setting_group TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS backup_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('AUTO', 'MANUAL', 'PRE_RESTORE')),
  destination_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  checksum_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
  error_message TEXT,
  triggered_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status, is_archived);
CREATE INDEX IF NOT EXISTS idx_vehicle_docs_expiry ON vehicle_documents(expiration_date, doc_type);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(full_name);
CREATE INDEX IF NOT EXISTS idx_customers_risk ON customers(risk_status);
CREATE INDEX IF NOT EXISTS idx_reservations_vehicle_dates ON reservations(vehicle_id, status, start_date, expected_return_date);
CREATE INDEX IF NOT EXISTS idx_contracts_vehicle_dates ON rental_contracts(vehicle_id, status, start_date, expected_return_date);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON rental_contracts(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_contract ON contract_payments(contract_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON contract_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_inspections_contract ON vehicle_inspections(contract_id, stage);
CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle_date ON maintenance_records(vehicle_id, performed_date);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_part ON inventory_movements(part_id, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_date_vehicle ON expenses(expense_date, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_register_movements(session_id);
CREATE INDEX IF NOT EXISTS idx_notifications_state ON notifications(is_resolved, is_read, severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
