# DEVELOPMENT_STATUS.md
## Gestion Agence de Location — تسيير وكالة كراء السيارات

**Last Updated**: Phase 2 Completed
**Current Phase**: Phase 2 (Core Business Operations) Complete → Ready for Review before Phase 3

---

### Completed Features (Phase 0, Phase 1 & Phase 2)
- **Phase 0 (Architecture & Database Foundation)**:
  - Verified 69 Algerian Wilayas (`01`–`69`) per Law No. 26-06 / Presidential Decree No. 26-206 (`shared/constants/algeria.ts`).
  - Relational SQLite schema (`001_initial_schema.sql`) with `PRAGMA foreign_keys = ON`, WAL journaling, integer minor-unit currency columns, CHECK constraints, and indexes.
  - Transactional SHA-256-verified SQL migration runner (`electron/database/migrator.ts`).
  - Strict database runtime isolation (`electron/database/connection.ts`): `desktop_production` vs. `browser_preview_temp` (`os.tmpdir()`).
- **Phase 1 (Foundation, Security, Auth, RBAC, Localization & Settings)**:
  - **Migration `002_wilayas_and_rbac_seed.sql`**: Editable `wilayas` table (69 wilayas seeded including 11 newly promoted 2026 wilayas `59`–`69`), `role_permissions` table, 27 RBAC permissions, `ADMIN` & `AGENT` roles, default `maintenance_types`, and `application_settings`.
  - **Electron Desktop & Browser Preview Separation**: Hardened `BrowserWindow` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`), allowlisted preload bridge, Zod-validated IPC & Express preview endpoints, `scrypt` per-user auth, brute-force lockout, lock/unlock, and immutable `audit_logs`.
  - **Bilingual UI Foundation**: French (LTR) / Arabic (RTL) switching, Latin / Eastern Arabic numerals, Light / Dark themes, Users & RBAC management, and 5-tab Settings.
- **Phase 2 (Core Business Operations)**:
  - **Migration `003_phase2_pricing_and_blocks.sql`**: Added `vehicle_blocked_periods`, `seasonal_rates`, and `customer_custom_rates` (43 total SQLite tables).
  - **Fleet Management (`fleetService.ts`, `VehiclesPage`, `VehicleProfilePage`)**: Vehicle CRUD, Algerian matricule, VIN, mileage, daily/weekly/monthly/deposit/extra-km rates, archive/unarchive (`ON DELETE RESTRICT` safe), administrative documents (`CARTE_GRISE`, `ASSURANCE`, `VIGNETTE`, `CONTROLE_TECHNIQUE`) with expiry indicators, rental history, and vehicle blocked periods.
  - **Customer Management (`customerService.ts`, `CustomersPage`, `CustomerProfilePage`)**: Individuals & Companies (`RC`, `NIF`, `NIS`, `ART`, `Bon de commande`), CNI/Passport/Driving Licence tracking, 69-wilaya selection, AES-256-GCM encrypted document vault (`customers/` subdir with path-traversal confinement & image/PDF preview), risk history & blacklist enforcement (`ADMIN`-only resolution), custom pricing rates, and live rental statistics.
  - **Availability & Anti-Overlap Engine (`availabilityService.ts`)**: Shared backend validation checking active reservations (`PENDING`, `CONFIRMED`), rental contracts (`DRAFT`, `CONFIRMED`, `ACTIVE`), extensions (`expected_return_date`), active `vehicle_blocked_periods`, and `MAINTENANCE`/`OUT_OF_SERVICE` vehicle status.
  - **Multi-Tier Pricing Engine (`pricingService.ts`)**: Daily, weekly, monthly, seasonal (`seasonal_rates`), customer-specific (`customer_custom_rates`), and customized rates with agent discount cap enforcement (`max_agent_discount_percent`), extra fees, and transparent line-item breakdown.
  - **Reservations & Planning Calendar (`reservationService.ts`, `PlanningPage`)**: Day/Week/Month fleet availability matrix, live overlap checker, reservation creation, status transitions (`PENDING` → `CONFIRMED` / `CANCELLED`), and one-click conversion to Rental Contract.
  - **Rental Contracts & Extensions (`contractService.ts`, `ContractsPage`, `NewContractWizardPage`, `ContractDetailPage`)**: Atomic 4-step contract creation wizard, separate initial rental payment (`contract_payments`) and security deposit (`deposits` + `deposit_movements`), activation (`HANDOVER` → `ACTIVE`), immutable `rental_extensions` preserving `original_end_date` and appending audit-logged pricing lines, completion with extra-km calculation, and cancellation.

### Actual Tests Executed (Phase 2)
- **`npm test` (`tsx --test tests/*.test.ts`) — 9/9 passed**:
  1. `Desktop Kernel startup, 69-wilaya seed, first-run Admin bootstrap, lock/unlock, logout, and RBAC enforcement` — **PASS**
  2. `Browser Preview Express API enforces Bearer auth, lock state, and Admin/Agent RBAC` — **PASS**
  3. `Database scope strictly isolates browser preview temp DB from desktop production DB` — **PASS**
  4. `Desktop and Preview databases & authentication sessions remain completely isolated` — **PASS**
  5. `Vault encryption round-trip and path traversal protection` — **PASS**
  6. `Electron BrowserWindow security options and Preload IPC channel allowlist` — **PASS**
  7. `Phase 2 Availability anti-overlap, Multi-tier Pricing Engine, Reservations, Contracts, and Extensions` — **PASS**
  8. `Phase 2 Preview Express HTTP API end-to-end flow (Vehicles, Customers, Pricing, Planning, Contracts)` — **PASS**
  9. `Phase 2 Fleet Management & Customer Vault/Risk enforcement via Desktop IPC` — **PASS**
- **`npm run lint` (`tsc --noEmit`)** — **PASS** (0 errors)
- **`npm run build` (`vite build`)** — **PASS**
- **Live Preview Server HTTP Smoke Check** (`GET /api/preview/health`, `GET /api/preview/auth/status`, `GET /`) — **PASS** (`HTTP 200`, `databaseScope: temporary_isolated`)

### Known Limitations & Unfinished Work
- **Headless Linux Sandbox Limitations**:
  - `xvfb` and `libgtk-3` are absent in this container (`no xvfb`), and Windows NSIS/Wine is unavailable. Native Electron GUI launch and Windows `.exe` installer packaging cannot execute inside this sandbox; Electron main/preload/IPC handlers and security options were verified via `tsx --test`.
- **Unfinished Modules (Scheduled for Phases 3–6)**:
  - **Phase 3 (Finance)**: Full payments ledger UI, deposit deductions/refunds UI, customer debts reconciliation, daily cash register (`open/close/movements`), operating expenses, and vehicle profitability (`VehicleProfilePage` Phase 3 tabs remain read-only placeholders).
  - **Phase 4 (Inspections & Maintenance)**: Departure/Return checklists (`État des lieux`) with damage photos, scheduled maintenance workflows (date + km triggers), spare parts inventory movements, and centralized expiry/overdue notifications (`VehicleProfilePage` Phase 4 tabs remain placeholders).
  - **Phase 5 (Documents & Reports)**: Bilingual A4 contract/invoice PDFs, 58/80mm thermal receipts, and CSV/Excel exports.
  - **Phase 6 (Backups & Packaging)**: SQLite online backup & Admin restore UI, full Electron/Windows installer build verification.
