-- ============================================================================
-- Migration 003: Phase 2 — Vehicle Blocked Periods & Configurable Pricing Rules
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_blocked_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  block_type TEXT NOT NULL CHECK (block_type IN ('MAINTENANCE', 'ADMIN_HOLD', 'OTHER')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  released_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  released_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (end_date > start_date)
);

CREATE TABLE IF NOT EXISTS seasonal_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vehicle_category TEXT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  daily_rate_minor INTEGER NOT NULL CHECK (daily_rate_minor >= 0),
  weekly_rate_minor INTEGER CHECK (weekly_rate_minor IS NULL OR weekly_rate_minor >= 0),
  monthly_rate_minor INTEGER CHECK (monthly_rate_minor IS NULL OR monthly_rate_minor >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS customer_custom_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_category TEXT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  daily_rate_minor INTEGER CHECK (daily_rate_minor IS NULL OR daily_rate_minor >= 0),
  weekly_rate_minor INTEGER CHECK (weekly_rate_minor IS NULL OR weekly_rate_minor >= 0),
  monthly_rate_minor INTEGER CHECK (monthly_rate_minor IS NULL OR monthly_rate_minor >= 0),
  default_discount_percent REAL NOT NULL DEFAULT 0 CHECK (default_discount_percent >= 0 AND default_discount_percent <= 100),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_blocked_periods_vehicle_dates
  ON vehicle_blocked_periods(vehicle_id, is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_seasonal_rates_dates
  ON seasonal_rates(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_customer_custom_rates_cust
  ON customer_custom_rates(customer_id, is_active);
