# DATABASE_SCHEMA.md
## Gestion Agence de Location — تسيير وكالة كراء السيارات

### 1. Core Storage & Precision Rules
- **Engine**: SQLite 3 (`better-sqlite3`), `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = FULL`, `PRAGMA wal_autocheckpoint = 1000`, `PRAGMA busy_timeout = 5000`, non-destructive `PRAGMA quick_check(1)` on open, and `PRAGMA wal_checkpoint(TRUNCATE)` on clean shutdown.
- **Monetary Representation**: All currency amounts are stored as **exact integer minor units** (`*_minor`, `INTEGER`, 1 DZD = 100 centimes; 1 EUR = 100 cents). Floating-point arithmetic is prohibited for financial totals.
- **Temporal Representation**: All timestamps are stored as ISO-8601 UTC strings (`YYYY-MM-DDTHH:MM:SS.sssZ`). Business day boundaries, late-return durations, and cash sessions are evaluated in the `Africa/Algiers` timezone.
- **Referential Integrity & Soft Deletion**: `ON DELETE RESTRICT` is enforced on vehicles, customers, contracts, payments, deposits, maintenance, and invoices. Historical vehicles and customers referenced by contracts cannot be deleted; they use `is_archived = 1`.
- **Financial Immutability**: `contract_payments`, `deposit_movements`, `cash_register_movements`, and `audit_logs` are append-only. Corrections use explicit reversal rows (`reversal_of_payment_id`) or authorized adjustment records.

---

### 2. Entity Groups & Table Definitions (43 Tables)

#### Group A — Identity, RBAC & Audit (6 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `schema_migrations` | Versioned SQL migration ledger | `PK(version)`, SHA-256 `checksum` |
| `roles` | System roles (`ADMIN`, `AGENT`) | `PK(id)`, `UNIQUE(code)` |
| `permissions` | Fine-grained capability catalog | `PK(id)`, `UNIQUE(code)` |
| `role_permissions` | Default role-to-permission mappings | `PK(role_id, permission_id)` |
| `users` | Local agency operators | `PK(id)`, `UNIQUE(username)`, `FK(role_id -> roles.id)`, `failed_login_attempts`, `locked_until` |
| `user_permissions` | Per-user capability overrides | `PK(id)`, `UNIQUE(user_id, permission_id)`, `FK(user_id)`, `FK(permission_id)` |

#### Group A2 — Administrative Reference (1 table)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `wilayas` | Editable 69-wilaya directory (incl. 2026 division) | `PK(code)`, `is_newly_created_2026`, `FK(parent_wilaya_code -> wilayas.code)`, `decree_reference`, `effective_year` |

#### Group B — Fleet Management (4 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `vehicles` | Passenger car registry | `PK(id)`, `UNIQUE(internal_code)`, `UNIQUE(matricule)`, `UNIQUE(vin)`, `CHECK(fuel_type)`, `CHECK(transmission)`, `CHECK(status)` |
| `vehicle_documents` | Carte grise, Assurance, Vignette, Contrôle technique | `PK(id)`, `FK(vehicle_id -> vehicles.id RESTRICT)`, `expiration_date`, `reminder_days` |
| `vehicle_photos` | Vehicle gallery assets | `PK(id)`, `FK(vehicle_id -> vehicles.id CASCADE)` |
| `vehicle_blocked_periods` | Explicit vehicle unavailability blocks (`MAINTENANCE`, `ADMIN_HOLD`, `OTHER`) *(Migration 003)* | `PK(id)`, `FK(vehicle_id -> vehicles.id RESTRICT)`, `FK(created_by_user_id)`, `FK(released_by_user_id)`, `CHECK(end_date > start_date)` |

#### Group C — Customers & Risk Management (5 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `customers` | Individuals (`INDIVIDUAL`) and Companies (`COMPANY`) | `PK(id)`, `CHECK(customer_type)`, `CHECK(risk_status)` (`LOW/MEDIUM/HIGH/BLACKLISTED`), `wilaya_code` (`01..69`) |
| `customer_companies` | Corporate fiscal identifiers (RC, NIF, NIS, ART, Bon de commande) | `PK(id)`, `UNIQUE(customer_id)`, `FK(customer_id -> customers.id CASCADE)` |
| `customer_documents` | Encrypted CNI, Passport, Driving licence & company files *(extended in Migration 008)* | `PK(id)`, `FK(customer_id -> customers.id RESTRICT)`, `FK(uploaded_by_user_id -> users.id)`, `document_number`, `issue_date`, `expiration_date`, `reminder_days`, `is_archived`, `FK(replaces_doc_id)`, `FK(replaced_by_doc_id)`, `archived_at`, `FK(archived_by_user_id)` |
| `customer_risk_records` | Documented risk incidents & blacklist justifications | `PK(id)`, `FK(customer_id)`, `FK(reported_by_user_id)`, `FK(resolved_by_user_id)` |
| `customer_custom_rates` | Customer-specific negotiated rates & default discounts *(Migration 003)* | `PK(id)`, `FK(customer_id -> customers.id CASCADE)`, `FK(vehicle_id -> vehicles.id CASCADE)`, `CHECK(default_discount_percent BETWEEN 0 AND 100)` |

#### Group D — Reservations, Pricing & Rental Contracts (5 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `reservations` | Advance bookings before contract confirmation | `PK(id)`, `UNIQUE(reservation_number)`, `FK(customer_id)`, `FK(vehicle_id)`, `CHECK(expected_return_date > start_date)` |
| `seasonal_rates` | Date-range seasonal pricing overrides per vehicle or category *(Migration 003)* | `PK(id)`, `FK(vehicle_id -> vehicles.id CASCADE)`, `CHECK(end_date >= start_date)` |
| `rental_contracts` | Central contract ledger | `PK(id)`, `UNIQUE(contract_number)`, `FK(reservation_id)`, `FK(customer_id)`, `FK(vehicle_id)`, `CHECK(original_end_date > start_date)`, `CHECK(expected_return_date >= original_end_date)` |
| `rental_extensions` | Traceable contract extension history | `PK(id)`, `FK(contract_id -> rental_contracts.id RESTRICT)`, `CHECK(new_return_date > previous_return_date)`, `CHECK(added_days > 0)` |
| `contract_pricing_items` | Transparent breakdown of rates, discounts, fees & adjustments | `PK(id)`, `FK(contract_id)`, `FK(authorized_by_user_id)` |

#### Group E — Payments, Deposits & Fines (4 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `contract_payments` | Rental inflows & refunds (never mixed with deposits) | `PK(id)`, `UNIQUE(transaction_code)`, `UNIQUE(receipt_number)`, `FK(contract_id)`, `FK(customer_id)`, `FK(reversal_of_payment_id)` |
| `deposits` | Security deposit (*caution*) held per contract | `PK(id)`, `UNIQUE(contract_id)`, `FK(customer_id)`, `CHECK(deducted_amount_minor + refunded_amount_minor <= amount_minor)` |
| `deposit_movements` | Audit trail of deposit receipt, deductions & refunds | `PK(id)`, `FK(deposit_id -> deposits.id RESTRICT)` |
| `traffic_fines` | Traffic / radar / parking fines linked to rental or vehicle | `PK(id)`, `FK(contract_id)`, `FK(vehicle_id)`, `FK(customer_id)` |

#### Group F — Vehicle Inspections & Damage Management (5 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `vehicle_inspections` | Mandatory `DEPARTURE` and `RETURN` inspections with lifecycle lock *(extended in Migration 005)* | `PK(id)`, `UNIQUE(inspection_number)`, `UNIQUE(contract_id, stage)`, `status IN ('DRAFT', 'FINALIZED')`, `customer_acknowledged`, `late_return_minutes`, `mileage_delta_km`, `CHECK(fuel_level_percent BETWEEN 0 AND 100)` |
| `inspection_items` | Checklist item condition (`GOOD`, `DAMAGED`, `MISSING`) *(extended in Migration 005)* | `PK(id)`, `FK(inspection_id -> vehicle_inspections.id CASCADE)`, `category`, `sort_order` |
| `inspection_photos` | AES-256-GCM encrypted inspection evidence photos *(extended in Migration 005)* | `PK(id)`, `FK(inspection_id -> vehicle_inspections.id CASCADE)`, `FK(damage_id -> vehicle_damages.id SET NULL)`, `original_file_name`, `mime_type` |
| `vehicle_damages` | Interactive diagram & zone-tagged damage registry *(Migration 005)* | `PK(id)`, `UNIQUE(damage_code)`, `FK(vehicle_id RESTRICT)`, `FK(contract_id RESTRICT)`, `FK(inspection_id RESTRICT)`, `FK(linked_expense_id SET NULL)`, `status IN ('REPORTED','UNDER_REVIEW','CONFIRMED','UNDER_REPAIR','REPAIRED','REJECTED')` |
| `damage_resolution_records` | Immutable timeline of damage status transitions & repair references *(Migration 005)* | `PK(id)`, `FK(damage_id CASCADE)`, `FK(linked_expense_id SET NULL)`, `FK(recorded_by_user_id RESTRICT)` |

#### Group G — Suppliers, Maintenance & Spare Parts Inventory (7 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `suppliers` | Garages, parts vendors, insurers *(extended in Migration 007)* | `PK(id)`, `email`, `wilaya_code`, `is_archived IN (0, 1)` |
| `maintenance_types` | Configurable intervals (`VIDANGE`, `CABIN_FILTER`, `BRAKES`, etc.) *(seeded in Migration 002 & 006)* | `PK(id)`, `UNIQUE(code)`, `default_km_interval`, `default_day_interval`, `km_warning_threshold`, `day_warning_threshold` |
| `vehicle_maintenance_schedules` | Per-vehicle preventive interval overrides *(Migration 006)* | `PK(id)`, `UNIQUE(vehicle_id, maintenance_type_id)`, `FK(vehicle_id CASCADE)`, `FK(maintenance_type_id CASCADE)` |
| `maintenance_records` | Scheduled, active & completed work, blocking, Finance link & encrypted invoice *(extended in Migration 006)* | `PK(id)`, `UNIQUE(record_number)`, `FK(vehicle_id)`, `FK(maintenance_type_id)`, `FK(supplier_id)`, `FK(blocked_period_id SET NULL)`, `status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')`, `parts_consumed_locked` |
| `inventory_parts` | Spare parts stock catalog, unit & minimum thresholds *(extended in Migration 007)* | `PK(id)`, `UNIQUE(part_code)`, `FK(supplier_id)`, `unit_label`, `compatible_models`, `is_archived` |
| `maintenance_parts` | Parts consumed per maintenance intervention | `PK(id)`, `FK(maintenance_record_id CASCADE)`, `FK(part_id RESTRICT)` |
| `inventory_movements` | Immutable stock ledger (`INITIAL_STOCK`, `PURCHASE`, `ENTRY`, `WITHDRAWAL`, `MAINTENANCE_USE`, `RETURN`, `ADJUSTMENT`) *(recreated in Migration 007)* | `PK(id)`, `FK(part_id RESTRICT)`, `FK(maintenance_record_id RESTRICT)`, `FK(vehicle_id SET NULL)`, `FK(supplier_id SET NULL)`, `FK(expense_id SET NULL)`, `CHECK(quantity_delta != 0)` |

#### Group H — Expenses & Daily Cash Register (3 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `expenses` | Agency & vehicle operating expenses *(indexed in Migration 006 for max 1 `POSTED` expense per maintenance)* | `PK(id)`, `UNIQUE(expense_number)`, `FK(vehicle_id)`, `FK(supplier_id)`, `FK(maintenance_record_id)`, `idx_expenses_unique_posted_maintenance` |
| `cash_register_sessions` | Daily cash drawer open/close & reconciliation | `PK(id)`, `UNIQUE(session_date)`, `CHECK(status IN ('OPEN', 'CLOSED'))` |
| `cash_register_movements` | Cash inflows/outflows linked to session & source record | `PK(id)`, `FK(session_id)`, `FK(payment_id)`, `FK(deposit_movement_id)`, `FK(expense_id)` |

#### Group I — Documents, Alerts, Audit, Settings & Backups (6 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `invoices` | Bilingual invoices with fiscal compliance flag *(extended in Migration 008)* | `PK(id)`, `UNIQUE(invoice_number)`, `FK(contract_id)`, `FK(customer_id)`, `discount_minor`, `currency`, `tax_rate_percent`, `is_fiscally_compliant`, `notes` |
| `generated_documents` | Archive of encrypted A4/Landscape PDFs & 58/80mm thermal receipts *(upgraded in Migration 008)* | `PK(id)`, `UNIQUE(document_number)`, `document_kind` (16 types), `format` (`A4_PDF`, `A4_LANDSCAPE_PDF`, `THERMAL_80MM`, `THERMAL_58MM`), `language`, `numeral_system`, `is_copy`, `FK(source_document_id)`, `reprint_count`, `template_version`, `sha256_hash`, `metadata_snapshot_json`, `template_snapshot_json`, `last_printed_at`, entity FKs (`contract_id`, `payment_id`, `deposit_id`, `inspection_id`, `invoice_id`, `customer_id`, `vehicle_id`, `maintenance_record_id`, `expense_id`, `cash_session_id`) |
| `notifications` | Centralized operational alerts (`MAINTENANCE_DUE`, `MAINTENANCE_OVERDUE`, `VEHICLE_DOCUMENT`, `CUSTOMER_DOCUMENT`, `MILEAGE_ANOMALY`, `LOW_STOCK`) | `PK(id)`, `UNIQUE(dedupe_key)` |
| `audit_logs` | Immutable operational & financial audit trail | `PK(id)`, `FK(user_id SET NULL)` |
| `application_settings` | Key/value agency, pricing, document, and UI config | `PK(setting_key)` |
| `backup_records` | Encrypted `.agbkp` backup history, SHA-256 checksums & verification ledger *(extended in Migration 009)* | `PK(id)`, `CHECK(backup_type IN ('AUTO', 'MANUAL', 'PRE_RESTORE'))`, `file_name`, `app_version`, `schema_version`, `includes_vault`, `attachment_count`, `backup_format`, `is_encrypted`, `encryption_mode` (`VAULT_RECOVERY_KEY` \| `PASSPHRASE`), `recovery_key_fingerprint`, `verified_at`, `verification_status`, `verification_summary_json`, `triggered_by_username`, `notes` (paired with Admin-only `db:health`, `backups:manage`, `backups:restore` permissions) |

---

### 3. Key Indexes
- `idx_vehicles_status` (`vehicles(status, is_archived)`)
- `idx_vehicle_docs_expiry` (`vehicle_documents(expiration_date, doc_type)`)
- `idx_blocked_periods_vehicle_dates` (`vehicle_blocked_periods(vehicle_id, is_active, start_date, end_date)`)
- `idx_customers_phone`, `idx_customers_name`, `idx_customers_risk`
- `idx_customer_custom_rates_cust` (`customer_custom_rates(customer_id, is_active)`)
- `idx_reservations_vehicle_dates` (`reservations(vehicle_id, status, start_date, expected_return_date)`)
- `idx_seasonal_rates_dates` (`seasonal_rates(is_active, start_date, end_date)`)
- `idx_contracts_vehicle_dates` (`rental_contracts(vehicle_id, status, start_date, expected_return_date)`)
- `idx_contracts_customer` (`rental_contracts(customer_id, status)`)
- `idx_payments_contract`, `idx_payments_customer`, `idx_deposits_status`
- `idx_inspections_vehicle`, `idx_inspections_contract`, `idx_damages_vehicle`, `idx_damages_inspection`, `idx_inspection_photos_insp`
- `idx_maintenance_record_number`, `idx_maintenance_status`, `idx_maintenance_vehicle_date`, `idx_vehicle_maint_schedules_vehicle`, `idx_expenses_unique_posted_maintenance`
- `idx_inventory_parts_stock`, `idx_inventory_movements_part`, `idx_inventory_movements_maintenance`, `idx_suppliers_archived`
- `idx_expenses_date_vehicle`, `idx_cash_movements_session`, `idx_notifications_state`, `idx_notifications_entity`, `idx_audit_logs_entity`
- `idx_gen_docs_kind_date`, `idx_gen_docs_customer`, `idx_gen_docs_vehicle`, `idx_gen_docs_contract`, `idx_gen_docs_source`, `idx_gen_docs_created` *(Migration 008)*
- `idx_customer_docs_exp` (`customer_documents(customer_id, is_archived, expiration_date)`) *(Migration 008)*
- `idx_audit_logs_created`, `idx_expenses_status_date`, `idx_contracts_expected_return`, `idx_payments_date`, `idx_backup_records_created` *(Migration 009 scale indexes)*
