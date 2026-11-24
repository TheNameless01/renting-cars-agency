# ARCHITECTURE_AND_SECURITY.md
## Phase 0 Architecture Decisions & Security Boundaries

### 1. Project Folder Structure
```text
/
├── electron/
│   ├── main/                 # Electron main process lifecycle, window, auto-backup scheduler
│   ├── preload/              # contextBridge preload exposing window.electronAPI only
│   ├── ipc/
│   │   └── contracts.ts      # Typed IPC channel registry & request/response contracts
│   ├── database/
│   │   ├── connection.ts     # SQLite connection factory (desktop vs isolated preview scope)
│   │   ├── migrator.ts       # Transactional SQL migration runner with SHA-256 verification
│   │   ├── migrations/       # Ordered SQL migrations (001_initial_schema.sql, ...)
│   │   ├── repositories/     # Pure SQL prepared-statement data access layer
│   │   └── services/         # ACID transactional business logic & RBAC enforcement
│   ├── security/             # scrypt password hashing, AES-256-GCM doc encryption, path guards
│   ├── documents/            # Bilingual FR/AR PDF & 58/80mm thermal receipt generators
│   └── backups/              # SQLite Online Backup API & pre-restore safety snapshot service
├── shared/
│   ├── constants/
│   │   └── algeria.ts        # Verified 69 Algerian Wilayas (01-69), matricule regex, DZD rules
│   ├── types/
│   │   └── domain.ts         # Shared TypeScript models & permission codes
│   ├── schemas/
│   │   └── index.ts          # Zod validation schemas shared across frontend & backend
│   └── api/
│       └── previewContracts.ts # Isolated browser preview HTTP contract (/api/preview/*)
├── src/
│   ├── components/           # Reusable accessible ERP UI primitives (tables, drawers, dialogs)
│   ├── layouts/              # Sidebar + Top bar desktop workspace layout (LTR/RTL, Light/Dark)
│   ├── features/             # 12 domain modules + notifications/audit
│   ├── hooks/                # Auth session, theme, i18n, keyboard shortcuts
│   ├── i18n/                 # Centralized French (default) & Arabic dictionaries
│   └── lib/                  # Transport adapter (Electron IPC vs Preview API) & formatters
├── server.ts                 # Local Vite/Express preview bridge (temporary DB only)
├── electron-builder.yml      # Windows 10/11 x64 NSIS packaging configuration
├── DATABASE_SCHEMA.md        # Relational database reference
├── DEVELOPMENT_STATUS.md     # Incremental phase tracker
└── USER_GUIDE.md             # French & Arabic agency user manual
```

---

### 2. Dual-Runtime Architecture & Isolation Boundary

| Dimension | Production Desktop Runtime (Electron) | Browser Preview Runtime (Port 3000) |
| :--- | :--- | :--- |
| **Transport** | `window.electronAPI.invoke()` via `contextBridge` IPC | HTTP `/api/preview/*` via Express (`server.ts`) |
| **SQLite Database** | `app.getPath('userData')/data/agency_erp.db` | `os.tmpdir()/algeria_car_rental_erp_preview/preview_isolated.sqlite` |
| **Authentication** | Local desktop `users` table (`scrypt`), first-run Admin setup, lock screen | Isolated preview `users` inside temporary preview DB only |
| **Session Storage** | Main-process memory session + lock timer | In-memory `Authorization: Bearer <token>` in React state (never `localStorage`) |
| **Attachment Storage** | `%APPDATA%/.../secure_vault/` (AES-256-GCM encrypted) | Isolated `os.tmpdir()` preview vault (never reads real agency PII) |
| **Production DB Exposure** | Internal main process only; renderer never touches SQLite | **Strictly blocked** — preview API has zero path/access to production DB |

---

### 3. Security Boundaries & Controls
1. **Electron Renderer & Session Hardening**:
   - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, DevTools disabled in production (`devTools: isDev`).
   - Renderer interacts exclusively through whitelisted channels in `electron/ipc/contracts.ts`.
   - `session.defaultSession` denies all browser permission requests/checks, disables `<webview>` attachment (`will-attach-webview`), blocks external navigation (`will-navigate`) and popups (`setWindowOpenHandler`), and injects strict offline Content-Security-Policy (`default-src 'self'`, `script-src 'self'`, `connect-src 'self'`, `img-src 'self' data: blob:`).
   - Every IPC handler validates input with Zod (`shared/schemas/index.ts`) and verifies the active session + `PermissionCode` on the backend before touching SQLite.
2. **Authentication, Auto-Lock & Brute-Force Protection**:
   - Passwords hashed with Node `crypto.scryptSync` + 16-byte random per-user salt (`timingSafeEqual` verification).
   - No hardcoded default admin password in production: if zero users exist, a one-time atomic first-run Admin Setup/Claim screen creates the initial `ADMIN` account and permanently disables bootstrap thereafter.
   - Backend + frontend inactivity auto-lock synced to `app.auto_lock_minutes` emits `SESSION_AUTO_LOCKED` audit entries and locks the session on expiry.
   - Failed login and unlock counters lock an account after 5 consecutive failures, revoke locked sessions on unlock failure, and write `UNLOCK_FAILED` / `LOGIN_FAILED` audit records.
   - Express preview auth endpoints enforce a sliding-window rate limiter (`SlidingWindowRateLimiter`) plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store`.
3. **Sensitive Vault Key DPAPI Wrapping, Upload Validation & Path Guards**:
   - CNI, passport, driving licence, inspection photos, workshop invoices, expense receipts, generated PDFs, and agency logos are stored outside public/static folders as opaque `.enc` files encrypted with AES-256-GCM.
   - On Electron Windows, `loadOrCreateVaultKey` wraps the 256-bit vault key via Windows DPAPI (`safeStorage`) into `.vault.key.dpapi` and automatically upgrades/removes legacy `.vault.key`.
   - All 6 upload paths validate decoded binary headers (magic bytes for JPEG/PNG/WebP/PDF) via `validateAndDecodeUpload`, reject disguised executables (`MZ`/`ELF`), ZIP archives, SVG, HTML, or XML scripts, enforce size limits, and sanitize filenames.
   - All filesystem reads/writes verify `resolvedPath.startsWith(baseDir + path.sep)` to block path traversal.
4. **SQLite Durability, Encrypted Backups & Atomic Restore**:
   - `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = FULL`, `PRAGMA wal_autocheckpoint = 1000`, non-destructive `PRAGMA quick_check(1)` on open, and `PRAGMA wal_checkpoint(TRUNCATE)` on clean close.
   - Pending migrations automatically trigger synchronous `VACUUM INTO` `PRE_MIGRATION` snapshots + vault copy prior to DDL execution.
   - `.agbkp` encrypted backups (`BACKUP_FORMAT_NAME = AGENCY_BACKUP_V1`) capture an online SQLite snapshot via `db.backup()` plus all vault attachments decrypted and re-packed into a single AES-256-GCM archive protected by either the `AGL-RK1-...` Vault Recovery Key or an 8+ character scrypt passphrase.
   - Restores verify archive integrity + foreign keys + checksums upfront, take a mandatory `PRE_RESTORE` snapshot, apply forward schema migrations if restoring an older archive, re-encrypt attachments under the active vault key, and perform an atomic swap with automatic rollback on failure.
   - Note on offline dependencies: `exceljs` uses transitive `uuid@8.3.2` locally for XLSX generation with zero network calls.
5. **SQL Injection & Financial Integrity**:
   - 100% prepared statements via `better-sqlite3` (`?` parameter binding).
   - Multi-record mutations run inside `db.transaction(...)` (`BEGIN IMMEDIATE`).
   - Financial records are append-only; reversals and authorized adjustments preserve full audit history.

---

### 4. Windows 10 / 11 Packaging Requirements (Electron Builder)
Because this development environment runs on **headless Linux without Windows NSIS or Wine**, the `.exe` installer must be built on the target Windows host. All production bundling scripts, icons (`build/icon.ico`, `build/icon.png`), NSIS hook (`build/installer.nsh`), and `electron-builder.yml` are prepared:
- **Build Host Prerequisites (Windows 10/11)**:
  - Node.js 20 LTS or 22 LTS (x64)
  - Visual Studio Build Tools ("Desktop development with C++") + Python 3 (for rebuilding `better-sqlite3` native `.node` against Electron's ABI via `electron-rebuild`)
- **Packaging Steps**:
  1. `npm install`
  2. `npx electron-rebuild -f -w better-sqlite3`
  3. `npm run dist:win` (runs `npm run build` + `npm run build:electron` producing `dist-electron/` CJS bundles with `dist-electron/package.json` `{"type": "commonjs"}` + `electron-builder --win --x64`)
- **Output**: `release/Gestion Agence de Location-Setup-1.0.0-x64.exe` (NSIS per-user installer, desktop & Start Menu shortcuts, `asarUnpack` configured for `better-sqlite3`, migrations, and PDF fonts, `deleteAppDataOnUninstall: false` to preserve `%APPDATA%` agency data).
