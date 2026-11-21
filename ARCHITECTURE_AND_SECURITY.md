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
1. **Electron Renderer Hardening**:
   - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
   - Renderer interacts exclusively through whitelisted channels in `electron/ipc/contracts.ts`.
   - Every IPC handler validates input with Zod (`shared/schemas/index.ts`) and verifies the active session + `PermissionCode` on the backend before touching SQLite.
2. **Authentication & Brute-Force Protection**:
   - Passwords hashed with Node `crypto.scryptSync` + 16-byte random per-user salt (`timingSafeEqual` verification).
   - No hardcoded default admin password in production: if zero users exist, a one-time atomic first-run Admin Setup/Claim screen creates the initial `ADMIN` account and permanently disables bootstrap thereafter.
   - Failed login counter (`failed_login_attempts`) locks an account temporarily (`locked_until`) after 5 consecutive failures.
3. **Sensitive Customer Document Protection**:
   - CNI, passport, driving licence, and company documents are stored outside public/static folders, renamed to opaque UUIDs, validated by MIME/extension allowlist, and encrypted at rest using AES-256-GCM with a locally protected key stored in Electron's `safeStorage` (Windows DPAPI) or dedicated OS user keyfile.
   - All filesystem reads/writes verify `resolvedPath.startsWith(baseDir + path.sep)` to block path traversal.
4. **SQL Injection & Financial Integrity**:
   - 100% prepared statements via `better-sqlite3` (`?` parameter binding).
   - Multi-record mutations (contract creation, extension, payment + cash session update, deposit settlement, maintenance + inventory deduction) run inside `db.transaction(...)` (`BEGIN IMMEDIATE`).
   - Financial records are append-only; reversals and authorized adjustments preserve full audit history.

---

### 4. Windows 10 / 11 Packaging Requirements (Electron Builder)
Because this development environment runs on **headless Linux (`gvisor`) without Windows NSIS or Wine**, the actual `.exe` installer cannot be built inside this sandbox. The repository includes complete packaging configuration (`electron-builder.yml`) for local Windows build execution:
- **Build Host Prerequisites (Windows 10/11)**:
  - Node.js 20 LTS or 22 LTS (x64)
  - Visual Studio Build Tools ("Desktop development with C++") + Python 3 (for rebuilding `better-sqlite3` native `.node` against Electron's ABI via `electron-rebuild`)
- **Packaging Steps**:
  1. `npm install`
  2. `npx electron-rebuild -f -w better-sqlite3`
  3. `npm run build` (compiles Vite renderer + Electron TypeScript main/preload)
  4. `npx electron-builder --win nsis --x64`
- **Output**: `release/Gestion Agence de Location-Setup-<version>-x64.exe` (NSIS per-user installer, desktop & Start Menu shortcuts, `asarUnpack` configured for `better-sqlite3`).
