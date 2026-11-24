# Gestion Agence de Location — تسيير وكالة كراء السيارات

**Offline-first bilingual (French LTR / Arabic RTL) Desktop ERP for Algerian car rental agencies — built with Electron, React, TypeScript, Tailwind CSS, and SQLite.**

![Version](https://img.shields.io/badge/version-1.0.0-0F766E)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-1D4ED8)
![Mode](https://img.shields.io/badge/mode-100%25%20Offline--First-059669)
![Languages](https://img.shields.io/badge/i18n-Fran%C3%A7ais%20%2F%20%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9%20RTL-7C3AED)
![Database](https://img.shields.io/badge/database-SQLite%20WAL%20%2B%20AES--256--GCM-334155)
![Tests](https://img.shields.io/badge/tests-32%2F32%20passing-16A34A)

---

## Overview

**Gestion Agence de Location** is a production-oriented Windows desktop management system designed specifically for passenger car rental agencies operating in Algeria. It replaces spreadsheets and disconnected paper records with a single transactional SQLite ledger, AES-256-GCM encrypted document vault, offline bilingual PDF/thermal printing engine, and verifiable disaster-recovery backups—all working **100% offline with zero cloud dependencies**.

### Built for Algerian Agency Workflows
- **69 Algerian Wilayas (`01`–`69`)**: Includes the 11 newly promoted wilayas (`59`–`69`) per Law No. 26-06 / Presidential Decree No. 26-206, editable in Settings.
- **Algerian Vehicle & Corporate Identifiers**: Validates Algerian matricules (`00123-124-16`), tracks *Carte grise*, *Assurance*, *Vignette*, and *Contrôle technique* expirations, and supports corporate clients with `RC`, `NIF`, `NIS`, `ART`, and *Bon de commande* references.
- **Exact Minor-Unit DZD Precision**: All monetary columns store exact integer centimes (`*_minor`, `1 DZD = 100 centimes`) to eliminate floating-point rounding drift.
- **Local Payment Methods & Fiscal Separation**: Supports **Espèces (DZD)**, **CCP**, **BaridiMob**, and **Virement bancaire**, strictly separating **security deposits (*cautions*)** as liabilities rather than rental revenue.
- **Instant Bilingual Switching**: Switch seamlessly between **French (LTR)** and **Arabic (RTL)**, **Latin (`0–9`)** or **Eastern Arabic (`٠–٩`)** numerals, and **Light / Dark** themes.

---

## Core Modules & Capabilities

### 1. Fleet Management & Availability Planning (`/vehicles`, `/planning`)
- Complete vehicle registry (internal code, matricule, VIN, brand/model/year, fuel, transmission, seats, odometer, daily/weekly/monthly rates, status).
- Administrative document tracking (*Assurance*, *Vignette*, *Contrôle technique*, *Carte grise*) with configurable expiry reminders.
- Vehicle unavailability blocks (`MAINTENANCE`, `ADMIN_HOLD`, `OTHER`).
- Visual **Day / Week / Month Availability Matrix** unified across reservations, active contracts, extensions, maintenance blocks, and vehicle status, backed by backend anti-overlap enforcement.

### 2. Customer Management & Encrypted Identity Vault (`/customers`)
- Supports **Individuals (`INDIVIDUAL`)** and **Companies (`COMPANY`)** with full legal & fiscal metadata.
- Stores CNI, Passport, Driving Licence, and corporate documents encrypted at rest (`AES-256-GCM`) outside static web directories.
- Non-destructive document replacement chains (preserving archived historical versions), expiration tracking, and automated expiry alerts.
- Documented risk incident ledger (`LOW`, `MEDIUM`, `HIGH`, `BLACKLISTED`) with Admin-only blacklist override & resolution tracking.

### 3. Multi-Tier Pricing, Reservations & Contracts (`/contracts`)
- **Pricing Engine**: Daily, weekly, monthly, seasonal date-range overrides, customer-specific negotiated rates, and percentage discounts.
- **Reservations**: Conflict-checked bookings with lifecycle tracking (`PENDING`, `CONFIRMED`, `CONVERTED`, `CANCELLED`, `NO_SHOW`).
- **Rental Contracts & Extensions**: 4-step contract wizard, itemized pricing breakdown, included/unlimited mileage modes, extra-km and late-return calculations, and traceable **immutable extensions** (`rental_extensions`) that preserve original contract terms.

### 4. Financial Management (`/finance`)
- **Daily Cash Register (*Caisse*)**: Opening balance, real-time cash inflows/outflows, manual authorized adjustments, expected vs. actual cash closing reconciliation, and carry-forward history.
- **Rental Payments**: Full and partial multi-payment support per contract, transaction references, reversals (append-only ledger), and bilingual receipts.
- **Security Deposits (*Cautions*)**: Held, returned, partially deducted, or fully deducted workflows linked to documented damages/fines/receipts; deposits are never counted as rental revenue.
- **Customer Financial Accounts**: Real-time customer balance ledger (total charged, net paid, overdue debt, held deposits, financial adjustments).
- **Expenses & Profitability**: Agency and vehicle-level expenses with supplier registry, encrypted proof attachments, reversals, vehicle ROI/profitability analysis, and CSV/PDF exports.

### 5. Vehicle Operations: Inspections, Maintenance & Spare Parts (`/inspections`, `/maintenance`, `/inventory`)
- **Departure & Return Inspections**: Mandatory `DEPARTURE` and `RETURN` checklists (`DRAFT` → immutable `FINALIZED`), odometer/fuel/late-return deltas, interactive SVG vehicle damage diagram, AES-256-GCM encrypted evidence photos, digital signature pads, damage resolution timeline, and strict **zero auto-charging** (financial deductions must pass explicitly through Finance).
- **Preventive Maintenance & Alerts**: Per-vehicle km/day maintenance schedules (`OK / APPROACHING / DUE / OVERDUE`), optional automatic vehicle blocking during workshop interventions, encrypted workshop invoices, max-1 `POSTED` Finance expense guarantee per record, and centralized deduplicated operational alerts on the Home dashboard.
- **Spare-Parts Inventory & Suppliers**: Part catalog with compatible models and minimum stock thresholds, immutable stock movement ledger (`INITIAL_STOCK`, `PURCHASE`, `ENTRY`, `WITHDRAWAL`, `MAINTENANCE_USE`, `RETURN`, `ADJUSTMENT`), negative-stock prevention, optional Finance expense posting on purchase, Admin-only stock adjustments, and atomic one-time stock deduction when a maintenance record completes.

### 6. Offline Bilingual PDF Engine, Printing & Reports (`/documents`, `/reports`)
- **16 Supported Document Kinds**: Rental contracts, extensions, departure/return inspection reports, damage reports, payment receipts, deposit receipts, invoices, expense vouchers, maintenance sheets, vehicle histories, customer statements, cash-closing summaries, and analytical reports.
- **4 Physical Output Formats**: `A4_PDF`, `A4_LANDSCAPE_PDF`, `THERMAL_80MM`, and `THERMAL_58MM`.
- **Offline Arabic Shaping & BiDi**: Embedded `DejaVuSans` Unicode fonts (`electron/assets/fonts/`), `arabic-persian-reshaper`, and `bidi-js` UAX #9 reordering with isolated LTR technical tokens (matricules, dates, document numbers, amounts).
- **Immutable Document Archive**: Frozen metadata/template snapshots, AES-256-GCM PDF storage, SHA-256 checksums, and watermarked certified reprints (`COPIE CONFORME` / `نسخة مطابقة`).
- **OS Printing & Multi-Format Exports**: Direct Electron OS printer discovery/printing plus centralized Financial, Fleet, Operational, and Custom reports exported to **PDF**, **UTF-8 BOM CSV**, and **Excel `.xlsx`** (with spreadsheet formula-injection neutralization).

### 7. Production Hardening, Encrypted Backups & Recovery (`/backups`, `/users`, `/settings`)
- **SQLite FULL Durability**: `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `synchronous = FULL`, `wal_autocheckpoint = 1000`, non-destructive open integrity check, `wal_checkpoint(TRUNCATE)` on clean close, and automatic `VACUUM INTO` `PRE_MIGRATION` snapshots before pending migrations.
- **Encrypted `.agbkp` Backup Engine**: Uses SQLite's Online Backup API (`db.backup()`) bundled with all vault attachments inside an AES-256-GCM archive protected by either the agency's **Vault Recovery Key (`AGL-RK1-...`)** or a **scrypt Passphrase** (8+ chars).
- **Verification & Atomic Restore**: Deep integrity + foreign-key + attachment verification, external USB export/import, daily auto-backup scheduler with configurable retention, and atomic restore with mandatory `PRE_RESTORE` snapshot, forward schema migrations, and automatic rollback on failure.
- **Security & RBAC**: 2 roles (`ADMIN`, `AGENT`) + 40+ fine-grained permissions with per-user overrides, `scrypt` per-user passwords, Windows DPAPI `safeStorage` vault key wrapping (`.vault.key.dpapi`), upload magic-byte validation across all 6 upload paths, synced backend/frontend inactivity auto-lock, 5-attempt unlock lockout, sliding-window auth rate limiting, and hardened Electron production windows (offline CSP, DevTools disabled, webviews/popups/external URLs blocked).

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Desktop Shell** | Electron (sandboxed renderer, `contextIsolation: true`, `nodeIntegration: false`, DPAPI `safeStorage`, NSIS x64 installer) |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, React Router v7, React Hook Form, Zod, Lucide Icons, Motion |
| **Backend & Preview Server** | Node.js, Express (`server.ts` isolated preview bridge), `esbuild` (CJS Electron bundle) |
| **Database & Migrations** | SQLite 3 via `better-sqlite3` (43 tables across 9 SHA-256-verified SQL migrations) |
| **Documents & Exports** | `pdf-lib`, `@pdf-lib/fontkit`, `arabic-persian-reshaper`, `bidi-js`, `exceljs`, `pdfjs-dist` (PDF test verification) |
| **Testing** | Node native test runner via `tsx --test` (`12` test suites / `32` tests) |

---

## Architecture & Runtime Isolation

The codebase enforces strict separation between the **Electron Production Desktop Runtime** and the **Browser Preview Runtime**:

| Dimension | Electron Desktop (Production) | Browser Preview (`npm run dev` on port `3000`) |
| :--- | :--- | :--- |
| **Transport** | `window.electronAPI.invoke()` via allowlisted `contextBridge` IPC | HTTP `/api/preview/*` via Express with Bearer tokens |
| **SQLite Database** | `%APPDATA%\Gestion Agence de Location\data\agency_erp.db` | `os.tmpdir()/algeria_car_rental_erp_preview/preview_isolated.sqlite` |
| **Vault Attachments** | `%APPDATA%\Gestion Agence de Location\secure_vault\` (DPAPI-wrapped key) | `os.tmpdir()/algeria_car_rental_erp_preview/vault/` |
| **Production Data Access** | Main process only (renderer never accesses SQLite or filesystem directly) | Strictly isolated — zero access to production database or vault |

---

## Project Structure

```text
.
├── electron/
│   ├── assets/fonts/           # Embedded DejaVuSans Unicode fonts for offline PDF generation
│   ├── backups/                # Encrypted .agbkp engine, verifier, atomic restore & daily scheduler
│   ├── database/
│   │   ├── connection.ts       # SQLite factory (WAL, synchronous=FULL, quick_check, safe close)
│   │   ├── migrator.ts         # SHA-256 verified SQL migration runner + PRE_MIGRATION hook
│   │   ├── migrations/         # 001_initial_schema.sql .. 009_phase6_hardening_backups.sql
│   │   └── services/           # Transactional domain services (fleet, contracts, finance, etc.)
│   ├── documents/              # Offline FR/AR RTL & thermal PDF generator + templates
│   ├── ipc/                    # Typed IPC channel registry & Zod envelope contracts
│   ├── main/                   # Electron lifecycle, appKernel, ipcRouter, printService, windowConfig
│   ├── preload/                # Sandboxed contextBridge preload script
│   └── security/               # scrypt, AES-256-GCM, DPAPI safeStorage, magic-byte validation, RBAC
├── shared/
│   ├── api/                    # Isolated browser preview endpoint registry
│   ├── constants/              # 69 Algerian Wilayas (01-69), matricule patterns, DZD formatting
│   ├── schemas/                # Shared Zod validation schemas
│   └── types/                  # Domain interfaces & PermissionCode catalog
├── src/
│   ├── components/             # Reusable accessible UI primitives (ModalDialog/ConfirmDialog portals)
│   ├── features/               # 15 domain feature modules (auth, fleet, contracts, finance, backups, ...)
│   ├── hooks/                  # Auth/auto-lock watchdog, theme, i18n, keyboard shortcuts
│   ├── i18n/                   # Complete French (LTR) & Arabic (RTL) translation dictionaries
│   ├── layouts/                # Responsive desktop ERP shell (sidebar, topbar, notifications)
│   └── lib/                    # Dual transport client (Electron IPC / Preview HTTP) & formatters
├── build/                      # Windows installer assets (icon.ico, icon.png, installer.nsh)
├── scripts/                    # Electron bundler (build-electron.mjs) & icon generator
├── tests/                      # 12 end-to-end test files (32 tests covering Phases 1-6)
├── server.ts                   # Isolated browser preview Express + Vite server (port 3000)
├── electron-builder.yml        # Windows 10/11 x64 NSIS packaging configuration
└── package.json
```

---

## Getting Started

### Prerequisites
- **Node.js** `20 LTS` or `22 LTS` (x64)
- **npm** (or Bun for lockfile compatibility)
- *For building the Windows `.exe` installer on Windows 10/11*: Visual Studio Build Tools (**Desktop development with C++**) + **Python 3** (required to compile `better-sqlite3` against Electron's ABI).

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Browser Preview Mode (Port 3000)
Runs the Express preview backend (using a strictly isolated temporary SQLite database in `os.tmpdir()`) alongside Vite on `http://localhost:3000`:
```bash
npm run dev
```
At first launch, create the initial **Admin** account on the bootstrap screen (no hardcoded default passwords exist).

### 3. Build Electron Bundles (Cross-Platform Check)
Compiles the Vite renderer (`dist/`), Electron main & sandboxed preload CommonJS bundles (`dist-electron/`), and runs TypeScript checks:
```bash
npm run build
npm run build:electron
```

### 4. Package Windows 10/11 x64 Installer (`.exe`)
Execute on a **Windows 10/11 x64** build machine:
```bash
npm install
npx electron-rebuild -f -w better-sqlite3
npm run dist:win
```
This outputs the NSIS installer to:
```text
release/Gestion Agence de Location-Setup-1.0.0-x64.exe
```
> Agency data (`agency_erp.db`, `secure_vault/`, `backups/`) is stored in `%APPDATA%\Gestion Agence de Location\` with `deleteAppDataOnUninstall: false`, preserving data across app upgrades and uninstalls.

---

## Available Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Starts the local Vite + isolated Express preview server on port `3000` |
| `npm run build` | Builds the React + Tailwind frontend into `dist/` |
| `npm run build:electron` | Bundles Electron main and sandboxed preload scripts into `dist-electron/` |
| `npm run dist:win` | Full production Windows x64 NSIS build (`build` + `build:electron` + `electron-builder`) |
| `npm run lint` | Runs `tsc --noEmit` across frontend, shared, server, and Electron sources |
| `npm test` | Runs all 12 automated test suites (32 tests) via `tsx --test tests/*.test.ts` |
| `npm run clean` | Removes `dist/`, `dist-electron/`, and temporary build artifacts |

---

## Testing & Verification

Run the full automated test suite and static type checks:
```bash
npm test
npm run lint
npx tsc -p tsconfig.electron.json --noEmit
```

The test suite (`32/32` passing) verifies:
- **Database & Isolation**: Desktop vs. preview DB separation, 69-wilaya seed, WAL `synchronous = FULL`, `PRE_MIGRATION` snapshots, and corruption refusal.
- **Security & RBAC**: `scrypt` hashing, brute-force login/unlock lockouts, inactivity auto-lock, 40+ RBAC permissions, upload magic-byte blocking, path traversal rejection, and DPAPI `safeStorage` wrapping.
- **Business Logic**: Fleet availability anti-overlap, multi-tier pricing, contract extensions, daily cash register reconciliation, deposit-vs-revenue accounting rules, departure/return inspections with zero auto-charging, maintenance blocking, and negative-stock prevention.
- **Documents & Reports**: Offline FR/AR RTL & thermal PDF rendering verified with `pdfjs-dist`, immutable certified copies, and Excel `.xlsx` / CSV exports verified with `ExcelJS`.
- **Disaster Recovery & Scale**: Encrypted `.agbkp` creation, tamper/key-mismatch rejection, atomic restore (`PRE_RESTORE` + vault attachment recovery), retention pruning, and a production-scale benchmark (`100` vehicles, `600` customers, `1,200` contracts, `1,500` payments).

---

## Documentation

- [`ARCHITECTURE_AND_SECURITY.md`](./ARCHITECTURE_AND_SECURITY.md) — Dual-runtime architecture, encryption model, SQLite durability, and Windows build pipeline.
- [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — Complete reference for all 43 tables, precision rules, constraints, and indexes.
- [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) — Phase 0–6 implementation ledger and verified test coverage.
- [`USER_GUIDE.md`](./USER_GUIDE.md) — Bilingual French / Arabic operational manual for agency staff and administrators.
- [`RELEASE_NOTES.md`](./RELEASE_NOTES.md) — Release notes for `v1.0.0`.
