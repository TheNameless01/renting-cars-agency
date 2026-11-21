# DATABASE_SCHEMA.md
## Gestion Agence de Location — تسيير وكالة كراء السيارات

### 1. Core Storage & Precision Rules
- **Engine**: SQLite 3 (`better-sqlite3`), `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`.
- **Monetary Representation**: All currency amounts are stored as **exact integer minor units** (`*_minor`, `INTEGER`, 1 DZD = 100 centimes; 1 EUR = 100 cents). Floating-point arithmetic is prohibited for financial totals.
- **Temporal Representation**: All timestamps are stored as ISO-8601 UTC strings (`YYYY-MM-DDTHH:MM:SS.sssZ`). Business day boundaries, late-return durations, and cash sessions are evaluated in the `Africa/Algiers` timezone.
- **Referential Integrity & Soft Deletion**: `ON DELETE RESTRICT` is enforced on vehicles, customers, contracts, payments, deposits, maintenance, and invoices. Historical vehicles and customers referenced by contracts cannot be deleted; they use `is_archived = 1`.
- **Financial Immutability**: `contract_payments`, `deposit_movements`, `cash_register_movements`, and `audit_logs` are append-only. Corrections use explicit reversal rows (`reversal_of_payment_id`) or authorized adjustment records.

---

### 2. Entity Groups & Table Definitions (40 Tables)

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

#### Group B — Fleet Management (3 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `vehicles` | Passenger car registry | `PK(id)`, `UNIQUE(internal_code)`, `UNIQUE(matricule)`, `UNIQUE(vin)`, `CHECK(fuel_type)`, `CHECK(transmission)`, `CHECK(status)` |
| `vehicle_documents` | Carte grise, Assurance, Vignette, Contrôle technique | `PK(id)`, `FK(vehicle_id -> vehicles.id RESTRICT)`, `expiration_date`, `reminder_days` |
| `vehicle_photos` | Vehicle gallery assets | `PK(id)`, `FK(vehicle_id -> vehicles.id CASCADE)` |

#### Group C — Customers & Risk Management (4 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `customers` | Individuals (`INDIVIDUAL`) and Companies (`COMPANY`) | `PK(id)`, `CHECK(customer_type)`, `CHECK(risk_status)` (`LOW/MEDIUM/HIGH/BLACKLISTED`), `wilaya_code` (`01..69`) |
| `customer_companies` | Corporate fiscal identifiers (RC, NIF, NIS, ART, Bon de commande) | `PK(id)`, `UNIQUE(customer_id)`, `FK(customer_id -> customers.id CASCADE)` |
| `customer_documents` | Encrypted CNI, Passport, Driving licence & company files | `PK(id)`, `FK(customer_id -> customers.id RESTRICT)`, `FK(uploaded_by_user_id -> users.id)` |
| `customer_risk_records` | Documented risk incidents & blacklist justifications | `PK(id)`, `FK(customer_id)`, `FK(reported_by_user_id)`, `FK(resolved_by_user_id)` |

#### Group D — Reservations & Rental Contracts (4 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `reservations` | Advance bookings before contract confirmation | `PK(id)`, `UNIQUE(reservation_number)`, `FK(customer_id)`, `FK(vehicle_id)`, `CHECK(expected_return_date > start_date)` |
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

#### Group F — Vehicle Inspections (3 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `vehicle_inspections` | Mandatory `DEPARTURE` and `RETURN` inspections | `PK(id)`, `UNIQUE(inspection_number)`, `UNIQUE(contract_id, stage)`, `CHECK(fuel_level_percent BETWEEN 0 AND 100)` |
| `inspection_items` | Checklist item condition (`GOOD`, `DAMAGED`, `MISSING`) | `PK(id)`, `FK(inspection_id -> vehicle_inspections.id CASCADE)` |
| `inspection_photos` | Inspection evidence photos | `PK(id)`, `FK(inspection_id -> vehicle_inspections.id CASCADE)` |

#### Group G — Suppliers, Maintenance & Spare Parts Inventory (6 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `suppliers` | Garages, parts vendors, insurers | `PK(id)` |
| `maintenance_types` | Configurable intervals (vidange, filters, tires, brakes, etc.) | `PK(id)`, `UNIQUE(code)`, `default_km_interval`, `default_day_interval` |
| `maintenance_records` | Completed maintenance work & next due triggers | `PK(id)`, `FK(vehicle_id)`, `FK(maintenance_type_id)`, `FK(supplier_id)` |
| `inventory_parts` | Spare parts stock & minimum thresholds | `PK(id)`, `UNIQUE(part_code)`, `FK(supplier_id)` |
| `maintenance_parts` | Parts consumed per maintenance job | `PK(id)`, `FK(maintenance_record_id CASCADE)`, `FK(part_id RESTRICT)` |
| `inventory_movements` | Immutable stock ledger (`PURCHASE`, `ENTRY`, `WITHDRAWAL`, `MAINTENANCE_USE`, `ADJUSTMENT`) | `PK(id)`, `FK(part_id RESTRICT)`, `FK(maintenance_record_id)`, `CHECK(quantity_delta != 0)` |

#### Group H — Expenses & Daily Cash Register (3 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `expenses` | Agency & vehicle operating expenses | `PK(id)`, `UNIQUE(expense_number)`, `FK(vehicle_id)`, `FK(supplier_id)`, `FK(maintenance_record_id)` |
| `cash_register_sessions` | Daily cash drawer open/close & reconciliation | `PK(id)`, `UNIQUE(session_date)`, `CHECK(status IN ('OPEN', 'CLOSED'))` |
| `cash_register_movements` | Cash inflows/outflows linked to session & source record | `PK(id)`, `FK(session_id)`, `FK(payment_id)`, `FK(deposit_movement_id)`, `FK(expense_id)` |

#### Group I — Documents, Alerts, Audit, Settings & Backups (6 tables)
| Table | Purpose | Key Constraints & Relationships |
| :--- | :--- | :--- |
| `invoices` | Bilingual invoices with fiscal compliance flag | `PK(id)`, `UNIQUE(invoice_number)`, `FK(contract_id)`, `FK(customer_id)` |
| `generated_documents` | Archive of generated A4 PDFs and 58/80mm receipts | `PK(id)`, `UNIQUE(document_number)`, `reprint_count` |
| `notifications` | Centralized alerts (expiry, overdue, maintenance, low stock, debt) | `PK(id)`, `UNIQUE(dedupe_key)` |
| `audit_logs` | Immutable operational & financial audit trail | `PK(id)`, `FK(user_id SET NULL)` |
| `application_settings` | Key/value agency, pricing, document, and UI config | `PK(setting_key)` |
| `backup_records` | History & SHA-256 checksums of local backups | `PK(id)`, `CHECK(backup_type IN ('AUTO', 'MANUAL', 'PRE_RESTORE'))` |

---

### 3. Key Indexes
- `idx_vehicles_status` (`vehicles(status, is_archived)`)
- `idx_vehicle_docs_expiry` (`vehicle_documents(expiration_date, doc_type)`)
- `idx_customers_phone`, `idx_customers_name`, `idx_customers_risk`
- `idx_reservations_vehicle_dates` (`reservations(vehicle_id, status, start_date, expected_return_date)`)
- `idx_contracts_vehicle_dates` (`rental_contracts(vehicle_id, status, start_date, expected_return_date)`)
- `idx_contracts_customer` (`rental_contracts(customer_id, status)`)
- `idx_payments_contract`, `idx_payments_customer`, `idx_deposits_status`
- `idx_inspections_contract`, `idx_maintenance_vehicle_date`, `idx_inventory_movements_part`
- `idx_expenses_date_vehicle`, `idx_cash_movements_session`, `idx_notifications_state`, `idx_audit_logs_entity`
