-- ============================================================================
-- Migration 004: Phase 3 — Financial Management Extensions
-- Enhances cash register, deposits, expenses, reversals, and customer adjustments
-- without duplicating existing Phase 0-2 ledger tables.
-- ============================================================================

-- Cash Register reconciliation & opening notes
ALTER TABLE cash_register_sessions
  ADD COLUMN cash_adjustments_minor INTEGER NOT NULL DEFAULT 0;

ALTER TABLE cash_register_sessions
  ADD COLUMN opening_notes TEXT;

-- Deposit payment method tracking & encrypted supporting evidence metadata
ALTER TABLE deposits
  ADD COLUMN received_method TEXT NOT NULL DEFAULT 'CASH'
    CHECK (received_method IN ('CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER'));

ALTER TABLE deposits
  ADD COLUMN refund_method TEXT
    CHECK (refund_method IS NULL OR refund_method IN ('CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER'));

ALTER TABLE deposits
  ADD COLUMN supporting_doc_original_name TEXT;

ALTER TABLE deposits
  ADD COLUMN supporting_doc_mime_type TEXT;

ALTER TABLE deposit_movements
  ADD COLUMN charge_category TEXT
    CHECK (charge_category IS NULL OR charge_category IN ('DAMAGE', 'TRAFFIC_FINE', 'LATE_FEE', 'EXTRA_KM', 'CLEANING', 'FUEL', 'OTHER'));

ALTER TABLE deposit_movements
  ADD COLUMN traffic_fine_id INTEGER REFERENCES traffic_fines(id) ON DELETE RESTRICT;

ALTER TABLE deposit_movements
  ADD COLUMN payment_method TEXT
    CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER'));

-- Expenses immutability (POSTED / REVERSED), reference & vault receipt metadata
ALTER TABLE expenses
  ADD COLUMN status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED'));

ALTER TABLE expenses
  ADD COLUMN payment_reference TEXT;

ALTER TABLE expenses
  ADD COLUMN receipt_original_name TEXT;

ALTER TABLE expenses
  ADD COLUMN receipt_mime_type TEXT;

CREATE TABLE IF NOT EXISTS expense_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL UNIQUE REFERENCES expenses(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  reversed_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cash_adjustment_movement_id INTEGER REFERENCES cash_register_movements(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Customer Financial Accounts adjustments (credit notes, extra debit charges, write-offs)
CREATE TABLE IF NOT EXISTS customer_financial_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  contract_id INTEGER REFERENCES rental_contracts(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('CREDIT_NOTE', 'DEBIT_CHARGE', 'WRITE_OFF')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'DZD' CHECK (currency IN ('DZD', 'EUR')),
  adjustment_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  authorized_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reversal_of_adjustment_id INTEGER REFERENCES customer_financial_adjustments(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_single_reversal
  ON contract_payments(reversal_of_payment_id)
  WHERE reversal_of_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_adjustments_single_reversal
  ON customer_financial_adjustments(reversal_of_adjustment_id)
  WHERE reversal_of_adjustment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cust_adj_customer
  ON customer_financial_adjustments(customer_id, adjustment_date);

CREATE INDEX IF NOT EXISTS idx_deposit_movements_deposit
  ON deposit_movements(deposit_id, created_at);

CREATE INDEX IF NOT EXISTS idx_fines_contract
  ON traffic_fines(contract_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_expenses_status_date
  ON expenses(status, expense_date);
