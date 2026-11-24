/**
 * Browser Preview API Contracts (Isolated Runtime)
 *
 * SECURITY BOUNDARY:
 * - Used ONLY when running in the Vite/Express browser preview environment (port 3000).
 * - Connects strictly to an isolated temporary SQLite database in os.tmpdir() (never the production desktop DB).
 * - Browser preview authentication is completely isolated from production desktop authentication.
 * - All endpoints live under `/api/preview/*` and require an in-memory Bearer token for protected mutations/reads.
 */

export const PREVIEW_API_BASE = '/api/preview';

export const PREVIEW_ENDPOINTS = {
  HEALTH: `${PREVIEW_API_BASE}/health`,
  AUTH_STATUS: `${PREVIEW_API_BASE}/auth/status`,
  AUTH_BOOTSTRAP: `${PREVIEW_API_BASE}/auth/bootstrap`,
  AUTH_LOGIN: `${PREVIEW_API_BASE}/auth/login`,
  AUTH_LOGOUT: `${PREVIEW_API_BASE}/auth/logout`,
  AUTH_LOCK: `${PREVIEW_API_BASE}/auth/lock`,
  AUTH_UNLOCK: `${PREVIEW_API_BASE}/auth/unlock`,
  AUTH_CHANGE_PASSWORD: `${PREVIEW_API_BASE}/auth/change-password`,
  AUTH_ME: `${PREVIEW_API_BASE}/auth/me`,
  USERS: `${PREVIEW_API_BASE}/users`,
  USERS_PERMISSIONS: `${PREVIEW_API_BASE}/users/permissions`,
  SETTINGS: `${PREVIEW_API_BASE}/settings`,
  WILAYAS: `${PREVIEW_API_BASE}/wilayas`,
  DASHBOARD: `${PREVIEW_API_BASE}/dashboard`,
  VEHICLES: `${PREVIEW_API_BASE}/vehicles`,
  CUSTOMERS: `${PREVIEW_API_BASE}/customers`,
  PRICING: `${PREVIEW_API_BASE}/pricing`,
  PLANNING: `${PREVIEW_API_BASE}/planning`,
  RESERVATIONS: `${PREVIEW_API_BASE}/reservations`,
  CONTRACTS: `${PREVIEW_API_BASE}/contracts`,
  INSPECTIONS: `${PREVIEW_API_BASE}/inspections`,
  FINANCE: `${PREVIEW_API_BASE}/finance`,
  MAINTENANCE: `${PREVIEW_API_BASE}/maintenance`,
  INVENTORY: `${PREVIEW_API_BASE}/inventory`,
  DOCUMENTS: `${PREVIEW_API_BASE}/documents`,
  REPORTS: `${PREVIEW_API_BASE}/reports`,
  NOTIFICATIONS: `${PREVIEW_API_BASE}/notifications`,
  AUDIT: `${PREVIEW_API_BASE}/audit`,
  BACKUPS: `${PREVIEW_API_BASE}/backups`,
  BACKUPS_HEALTH: `${PREVIEW_API_BASE}/backups/health`,
  BACKUPS_VERIFY: `${PREVIEW_API_BASE}/backups/verify`,
  BACKUPS_RESTORE: `${PREVIEW_API_BASE}/backups/restore`,
  BACKUPS_EXPORT: `${PREVIEW_API_BASE}/backups/export`,
  BACKUPS_IMPORT: `${PREVIEW_API_BASE}/backups/import`,
  BACKUPS_RECOVERY_KEY: `${PREVIEW_API_BASE}/backups/recovery-key`,
} as const;

export interface PreviewEnvironmentBanner {
  runtime: 'preview';
  databaseScope: 'temporary_isolated';
  isProductionDesktop: false;
}
