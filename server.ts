import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { ZodError } from 'zod';
import { openSqliteConnection, resolveDatabasePath } from './electron/database/connection.ts';
import { runMigrations } from './electron/database/migrator.ts';
import { listAuditLogs } from './electron/database/services/auditService.ts';
import {
  bootstrapFirstAdmin,
  changeOwnPassword,
  getAuthStatus,
  lockSession,
  loginUser,
  logoutUser,
  unlockSession,
} from './electron/database/services/authService.ts';
import { checkVehicleAvailability, getPlanningCalendar } from './electron/database/services/availabilityService.ts';
import {
  closeCashSession,
  getCashSessionDetail,
  getCurrentCashSession,
  listCashSessions,
  openCashSession,
  recordCashAdjustment,
} from './electron/database/services/cashRegisterService.ts';
import {
  activateContract,
  cancelContract,
  completeContract,
  createContract,
  extendContract,
  getContractDetail,
  listContracts,
} from './electron/database/services/contractService.ts';
import {
  createCustomerAdjustment,
  getCustomerFinancialLedger,
  listCustomerFinancialAccounts,
} from './electron/database/services/customerFinanceService.ts';
import {
  addCustomerRiskRecord,
  archiveCustomer,
  checkCustomerEligibility,
  createCustomer,
  getCustomerProfile,
  listCustomers,
  readCustomerDocument,
  resolveCustomerRiskRecord,
  updateCustomer,
  uploadCustomerDocument,
} from './electron/database/services/customerService.ts';
import {
  createTrafficFine,
  getDepositDetail,
  listDeposits,
  listTrafficFines,
  readDepositDocument,
  settleDeposit,
} from './electron/database/services/depositService.ts';
import {
  createSupplier,
  listExpenses,
  listSuppliers,
  readExpenseDocument,
  recordExpense,
  reverseExpense,
} from './electron/database/services/expenseService.ts';
import {
  buildFinancialReportCsv,
  getFinancialDashboardReports,
  getVehicleFinanceSummary,
  getVehicleProfitabilityReport,
} from './electron/database/services/financeReportService.ts';
import {
  archiveVehicle,
  createVehicle,
  createVehicleBlockedPeriod,
  getVehicleProfile,
  listVehicles,
  releaseVehicleBlockedPeriod,
  updateVehicle,
  upsertVehicleDocument,
} from './electron/database/services/fleetService.ts';
import {
  getPaymentReceipt,
  listPayments,
  recordPayment,
  reversePayment,
} from './electron/database/services/paymentService.ts';
import {
  calculateRentalPrice,
  createSeasonalRate,
  deleteSeasonalRate,
  listPricingRules,
  upsertCustomerCustomRate,
} from './electron/database/services/pricingService.ts';
import {
  createReservation,
  listReservations,
  updateReservationStatus,
} from './electron/database/services/reservationService.ts';
import { getAllSettings, updateSettingsBatch } from './electron/database/services/settingsService.ts';
import { createUser, listAllPermissions, listUsers, updateUser } from './electron/database/services/userService.ts';
import { listWilayas, upsertWilaya } from './electron/database/services/wilayaService.ts';
import { getOrCreateLocalVaultKey } from './electron/security/crypto.ts';
import { AuthError, requireAuthenticatedSession, requirePermission, resolveEffectivePermissions } from './electron/security/rbac.ts';
import { SessionStore } from './electron/security/sessionStore.ts';
import { PREVIEW_ENDPOINTS } from './shared/api/previewContracts.ts';
import {
  BootstrapAdminSchema,
  CalculatePriceSchema,
  ChangePasswordSchema,
  CloseCashSessionSchema,
  CompleteContractSchema,
  CreateBlockedPeriodSchema,
  CreateContractPhase2Schema,
  CreateCustomerAdjustmentSchema,
  CreateCustomerSchema,
  CreateExpenseSchema,
  CreateReservationSchema,
  CreateRiskRecordSchema,
  CreateSeasonalRateSchema,
  CreateSupplierSchema,
  CreateTrafficFineSchema,
  CreateUserSchema,
  CreateVehicleSchema,
  ExtendContractSchema,
  LoginSchema,
  OpenCashSessionSchema,
  RecordCashAdjustmentSchema,
  RecordPaymentSchema,
  ResolveRiskRecordSchema,
  ReverseExpenseSchema,
  ReversePaymentSchema,
  SettleDepositSchema,
  UnlockSessionSchema,
  UpdateCustomerSchema,
  UpdateReservationStatusSchema,
  UpdateSettingsBatchSchema,
  UpdateUserSchema,
  UpdateVehicleSchema,
  UploadCustomerDocSchema,
  UpsertCustomerCustomRateSchema,
  UpsertVehicleDocSchema,
  UpsertWilayaSchema,
} from './shared/schemas/index.ts';
import type { PermissionCode } from './shared/types/domain.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPreviewExpressApp(customDbPath?: string) {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  // SECURITY BOUNDARY: Strictly isolated temporary SQLite database & vault in os.tmpdir() (or test temp path).
  const previewDbPath = customDbPath
    ? path.resolve(customDbPath)
    : resolveDatabasePath({ scope: 'browser_preview_temp' });
  const previewVaultDir = customDbPath
    ? path.join(path.dirname(previewDbPath), 'preview_vault')
    : path.join(os.tmpdir(), 'algeria_car_rental_erp_preview', 'vault');
  const previewVaultKey = getOrCreateLocalVaultKey(previewVaultDir);

  const db = openSqliteConnection(previewDbPath);
  const migrationsDir = path.resolve(__dirname, 'electron/database/migrations');
  runMigrations(db, migrationsDir);

  // Isolated preview SessionStore (never shared with desktop main process)
  const previewSessionStore = new SessionStore('preview');

  const extractBearer = (req: express.Request): string | null => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    return auth.slice(7).trim();
  };

  const hasLivePerm = (userId: number, perm: PermissionCode) => {
    const row = db
      .prepare<[number], { role_id: number }>('SELECT role_id FROM users WHERE id = ? AND is_active = 1')
      .get(userId);
    if (!row) return false;
    return resolveEffectivePermissions(db, userId, row.role_id).includes(perm);
  };

  const requireAnyPermission = (userId: number, perms: PermissionCode[]) => {
    if (!perms.some((p) => hasLivePerm(userId, p))) {
      throw new AuthError('FORBIDDEN', `Permission insuffisante (${perms.join(' | ')})`);
    }
  };

  const handleError = (res: express.Response, err: unknown) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: err.issues[0]?.message || 'Données invalides',
          details: err.issues,
        },
      });
    }
    if (err instanceof AuthError) {
      return res.status(err.httpStatus).json({
        ok: false,
        error: { code: err.code, message: err.message },
      });
    }
    return res.status(500).json({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Erreur interne',
      },
    });
  };

  // Explicit guard: block any direct access outside /api/preview/*
  app.get(PREVIEW_ENDPOINTS.HEALTH, (_req, res) => {
    res.json({
      ok: true,
      data: {
        runtime: 'preview',
        databaseScope: 'temporary_isolated',
        isProductionDesktop: false,
      },
    });
  });

  app.get(PREVIEW_ENDPOINTS.AUTH_STATUS, (_req, res) => {
    try {
      res.json({ ok: true, data: getAuthStatus(db, 'preview') });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP, (req, res) => {
    try {
      const parsed = BootstrapAdminSchema.parse(req.body);
      const session = bootstrapFirstAdmin(db, previewSessionStore, 'preview', parsed);
      res.status(201).json({ ok: true, data: session });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.AUTH_LOGIN, (req, res) => {
    try {
      const parsed = LoginSchema.parse(req.body);
      const session = loginUser(db, previewSessionStore, 'preview', parsed.username, parsed.password);
      res.json({ ok: true, data: session });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(PREVIEW_ENDPOINTS.AUTH_ME, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req), true);
      res.json({
        ok: true,
        data: {
          token: session.token,
          user: session.user,
          permissions: session.permissions,
          isLocked: session.isLocked,
          expiresAt: session.expiresAt,
          runtimeMode: 'preview',
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.AUTH_LOCK, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req), true);
      lockSession(db, previewSessionStore, session.token);
      res.json({ ok: true, data: { locked: true } });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.AUTH_UNLOCK, (req, res) => {
    try {
      const token = extractBearer(req);
      if (!token) throw new AuthError('UNAUTHORIZED', 'Jeton de session manquant');
      const parsed = UnlockSessionSchema.parse(req.body);
      const session = unlockSession(db, previewSessionStore, token, parsed.password);
      res.json({ ok: true, data: session });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.AUTH_LOGOUT, (req, res) => {
    try {
      const token = extractBearer(req);
      if (token) {
        logoutUser(db, previewSessionStore, token);
      }
      res.json({ ok: true, data: { loggedOut: true } });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.AUTH_CHANGE_PASSWORD, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      const parsed = ChangePasswordSchema.parse(req.body);
      changeOwnPassword(db, session.userId, parsed.currentPassword, parsed.newPassword);
      res.json({ ok: true, data: { changed: true } });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Users & RBAC (ADMIN only)
  app.get(PREVIEW_ENDPOINTS.USERS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'users:manage');
      res.json({ ok: true, data: listUsers(db) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(PREVIEW_ENDPOINTS.USERS_PERMISSIONS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'users:manage');
      res.json({ ok: true, data: listAllPermissions(db) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.USERS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'users:manage');
      const parsed = CreateUserSchema.parse(req.body);
      const created = createUser(db, { id: session.userId, username: session.username }, parsed);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(PREVIEW_ENDPOINTS.USERS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'users:manage');
      const parsed = UpdateUserSchema.parse(req.body);
      const updated = updateUser(
        db,
        previewSessionStore,
        { id: session.userId, username: session.username },
        parsed.userId,
        {
          fullName: parsed.fullName,
          roleCode: parsed.roleCode,
          isActive: parsed.isActive,
          unlockAccount: parsed.unlockAccount,
          resetPassword: parsed.resetPassword,
          permissionOverrides: parsed.permissionOverrides as
            | Array<{ code: PermissionCode; granted: boolean | null }>
            | undefined,
        }
      );
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Settings (read authenticated, write ADMIN only)
  app.get(PREVIEW_ENDPOINTS.SETTINGS, (req, res) => {
    try {
      requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      res.json({ ok: true, data: getAllSettings(db) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put(PREVIEW_ENDPOINTS.SETTINGS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'settings:manage');
      const parsed = UpdateSettingsBatchSchema.parse(req.body);
      const updated = updateSettingsBatch(db, { id: session.userId, username: session.username }, parsed.updates);
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Editable 69-Wilaya Reference
  app.get(PREVIEW_ENDPOINTS.WILAYAS, (req, res) => {
    try {
      requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      const activeOnly = req.query.activeOnly === 'true';
      res.json({ ok: true, data: listWilayas(db, activeOnly) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put(PREVIEW_ENDPOINTS.WILAYAS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'settings:manage');
      const parsed = UpsertWilayaSchema.parse(req.body);
      const saved = upsertWilaya(db, { id: session.userId, username: session.username }, {
        code: parsed.code,
        nameFr: parsed.nameFr,
        nameAr: parsed.nameAr,
        isNewlyCreated2026: parsed.isNewlyCreated2026,
        parentWilayaCode: parsed.parentWilayaCode ?? null,
        decreeReference: parsed.decreeReference ?? null,
        effectiveYear: parsed.effectiveYear,
        isActive: parsed.isActive,
        notes: parsed.notes ?? null,
      });
      res.json({ ok: true, data: saved });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Audit Logs (ADMIN only)
  app.get(PREVIEW_ENDPOINTS.AUDIT, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'audit:view');
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
      res.json({ ok: true, data: listAuditLogs(db, { limit, entityType }) });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ============================================================================
  // Phase 2: Fleet Management
  // ============================================================================
  app.get(PREVIEW_ENDPOINTS.VEHICLES, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'vehicles:read');
      const data = listVehicles(db, {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        includeArchived: req.query.includeArchived === 'true',
      });
      res.json({ ok: true, data });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.VEHICLES}/:id`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'vehicles:read');
      res.json({ ok: true, data: getVehicleProfile(db, Number(req.params.id)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.VEHICLES, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'vehicles:write');
      const parsed = CreateVehicleSchema.parse(req.body);
      const created = createVehicle(db, { id: session.userId, username: session.username }, parsed);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(`${PREVIEW_ENDPOINTS.VEHICLES}/:id`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'vehicles:write');
      const parsed = UpdateVehicleSchema.parse({ ...req.body, id: Number(req.params.id) });
      const updated = updateVehicle(db, { id: session.userId, username: session.username }, parsed);
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.VEHICLES}/:id/archive`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'vehicles:write');
      archiveVehicle(db, { id: session.userId, username: session.username }, Number(req.params.id));
      res.json({ ok: true, data: { archived: true } });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.VEHICLES}/:id/documents`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'vehicles:write');
      const parsed = UpsertVehicleDocSchema.parse({ ...req.body, vehicleId: Number(req.params.id) });
      const saved = upsertVehicleDocument(db, { id: session.userId, username: session.username }, parsed);
      res.json({ ok: true, data: saved });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.VEHICLES}/:id/blocks`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'vehicles:write');
      const parsed = CreateBlockedPeriodSchema.parse({ ...req.body, vehicleId: Number(req.params.id) });
      const created = createVehicleBlockedPeriod(db, { id: session.userId, username: session.username }, parsed);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.VEHICLES}/blocks/:blockId/release`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'vehicles:write');
      releaseVehicleBlockedPeriod(db, { id: session.userId, username: session.username }, Number(req.params.blockId));
      res.json({ ok: true, data: { released: true } });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ============================================================================
  // Phase 2: Customers & Risk Management
  // ============================================================================
  app.get(PREVIEW_ENDPOINTS.CUSTOMERS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:read');
      const data = listCustomers(db, {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        customerType: typeof req.query.customerType === 'string' ? req.query.customerType : undefined,
        riskStatus: typeof req.query.riskStatus === 'string' ? req.query.riskStatus : undefined,
        includeArchived: req.query.includeArchived === 'true',
      });
      res.json({ ok: true, data });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.CUSTOMERS}/:id`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:read');
      res.json({ ok: true, data: getCustomerProfile(db, Number(req.params.id)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.CUSTOMERS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:write');
      const parsed = CreateCustomerSchema.parse(req.body);
      const created = createCustomer(db, { id: session.userId, username: session.username }, parsed);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(`${PREVIEW_ENDPOINTS.CUSTOMERS}/:id`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:write');
      const parsed = UpdateCustomerSchema.parse({ ...req.body, id: Number(req.params.id) });
      const updated = updateCustomer(db, { id: session.userId, username: session.username }, parsed);
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CUSTOMERS}/:id/archive`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:write');
      archiveCustomer(db, { id: session.userId, username: session.username }, Number(req.params.id));
      res.json({ ok: true, data: { archived: true } });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CUSTOMERS}/:id/risk`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:write');
      const parsed = CreateRiskRecordSchema.parse({ ...req.body, customerId: Number(req.params.id) });
      const created = addCustomerRiskRecord(db, { id: session.userId, username: session.username }, parsed);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CUSTOMERS}/risk/:riskRecordId/resolve`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:override_blacklist');
      const parsed = ResolveRiskRecordSchema.parse({
        ...req.body,
        riskRecordId: Number(req.params.riskRecordId),
      });
      const resolved = resolveCustomerRiskRecord(db, { id: session.userId, username: session.username }, parsed);
      res.json({ ok: true, data: resolved });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CUSTOMERS}/:id/documents`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:write');
      const parsed = UploadCustomerDocSchema.parse({ ...req.body, customerId: Number(req.params.id) });
      const saved = uploadCustomerDocument(
        db,
        { id: session.userId, username: session.username },
        previewVaultDir,
        previewVaultKey,
        parsed
      );
      res.status(201).json({ ok: true, data: saved });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.CUSTOMERS}/documents/:docId`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:read');
      const doc = readCustomerDocument(db, previewVaultDir, previewVaultKey, Number(req.params.docId));
      res.json({ ok: true, data: doc });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CUSTOMERS}/:id/eligibility`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'customers:read');
      const rentalEndDate = String(req.body?.rentalEndDate || new Date().toISOString());
      res.json({ ok: true, data: checkCustomerEligibility(db, Number(req.params.id), rentalEndDate) });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ============================================================================
  // Phase 2: Pricing Engine
  // ============================================================================
  app.post(`${PREVIEW_ENDPOINTS.PRICING}/calculate`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:read');
      const parsed = CalculatePriceSchema.parse(req.body);
      res.json({ ok: true, data: calculateRentalPrice(db, parsed) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.PRICING}/rules`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:read');
      res.json({ ok: true, data: listPricingRules(db) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.PRICING}/seasonal`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'settings:manage');
      const parsed = CreateSeasonalRateSchema.parse(req.body);
      const created = createSeasonalRate(db, { id: session.userId, username: session.username }, parsed);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete(`${PREVIEW_ENDPOINTS.PRICING}/seasonal/:id`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'settings:manage');
      deleteSeasonalRate(db, { id: session.userId, username: session.username }, Number(req.params.id));
      res.json({ ok: true, data: { deleted: true } });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.PRICING}/customer-rates`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'settings:manage');
      const parsed = UpsertCustomerCustomRateSchema.parse(req.body);
      const saved = upsertCustomerCustomRate(db, { id: session.userId, username: session.username }, parsed);
      res.status(201).json({ ok: true, data: saved });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ============================================================================
  // Phase 2: Planning & Reservations
  // ============================================================================
  app.get(`${PREVIEW_ENDPOINTS.PLANNING}/calendar`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:read');
      const startDate = String(req.query.startDate || '');
      const endDate = String(req.query.endDate || '');
      if (!startDate || !endDate) {
        throw new AuthError('VALIDATION_ERROR', 'startDate et endDate requis');
      }
      res.json({ ok: true, data: getPlanningCalendar(db, startDate, endDate) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.PLANNING}/check-availability`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:read');
      const { vehicleId, startDate, endDate, excludeContractId, excludeReservationId } = req.body || {};
      res.json({
        ok: true,
        data: checkVehicleAvailability(db, {
          vehicleId: Number(vehicleId),
          startDate: String(startDate),
          endDate: String(endDate),
          excludeContractId: excludeContractId ? Number(excludeContractId) : undefined,
          excludeReservationId: excludeReservationId ? Number(excludeReservationId) : undefined,
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(PREVIEW_ENDPOINTS.RESERVATIONS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:read');
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      res.json({ ok: true, data: listReservations(db, status) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.RESERVATIONS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:write');
      const parsed = CreateReservationSchema.parse(req.body);
      const created = createReservation(db, { id: session.userId, username: session.username }, parsed);
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(`${PREVIEW_ENDPOINTS.RESERVATIONS}/:id/status`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:write');
      const parsed = UpdateReservationStatusSchema.parse({
        ...req.body,
        reservationId: Number(req.params.id),
      });
      const updated = updateReservationStatus(db, { id: session.userId, username: session.username }, parsed);
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ============================================================================
  // Phase 2: Rental Contracts & Extensions
  // ============================================================================
  app.get(PREVIEW_ENDPOINTS.CONTRACTS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:read');
      const data = listContracts(db, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      });
      res.json({ ok: true, data });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.CONTRACTS}/:id`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:read');
      res.json({ ok: true, data: getContractDetail(db, Number(req.params.id)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(PREVIEW_ENDPOINTS.CONTRACTS, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:write');
      const parsed = CreateContractPhase2Schema.parse(req.body);
      const created = createContract(
        db,
        { id: session.userId, username: session.username },
        {
          canOverrideBlacklist: hasLivePerm(session.userId, 'customers:override_blacklist'),
          canApproveDiscount: hasLivePerm(session.userId, 'finance:approve_adjustment'),
        },
        parsed
      );
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CONTRACTS}/:id/activate`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:write');
      const departureOdometerKm =
        req.body?.departureOdometerKm != null ? Number(req.body.departureOdometerKm) : undefined;
      const updated = activateContract(
        db,
        { id: session.userId, username: session.username },
        Number(req.params.id),
        departureOdometerKm
      );
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CONTRACTS}/:id/extend`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:extend');
      const parsed = ExtendContractSchema.parse({ ...req.body, contractId: Number(req.params.id) });
      const updated = extendContract(db, { id: session.userId, username: session.username }, parsed);
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CONTRACTS}/:id/complete`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:write');
      const parsed = CompleteContractSchema.parse({ ...req.body, contractId: Number(req.params.id) });
      const updated = completeContract(
        db,
        { id: session.userId, username: session.username },
        hasLivePerm(session.userId, 'finance:approve_adjustment'),
        parsed
      );
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.CONTRACTS}/:id/cancel`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'contracts:cancel');
      const reason = String(req.body?.reason || 'Annulation contrat');
      const updated = cancelContract(
        db,
        { id: session.userId, username: session.username },
        Number(req.params.id),
        reason
      );
      res.json({ ok: true, data: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ============================================================================
  // Phase 3: Financial Management
  // ============================================================================
  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/payments`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:record_payment']);
      res.json({
        ok: true,
        data: listPayments(db, {
          contractId: req.query.contractId ? Number(req.query.contractId) : undefined,
          customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
          method: typeof req.query.method === 'string' ? req.query.method : undefined,
          direction: typeof req.query.direction === 'string' ? req.query.direction : undefined,
          dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
          dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/payments`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:record_payment');
      const parsed = RecordPaymentSchema.parse(req.body);
      res.status(201).json({
        ok: true,
        data: recordPayment(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/payments/:id/reverse`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:approve_adjustment');
      const parsed = ReversePaymentSchema.parse({ ...req.body, paymentId: Number(req.params.id) });
      res.json({
        ok: true,
        data: reversePayment(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/payments/:id/receipt`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, [
        'finance:read',
        'finance:record_payment',
        'contracts:read',
        'documents:generate',
      ]);
      res.json({ ok: true, data: getPaymentReceipt(db, Number(req.params.id)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/deposits`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_deposit']);
      res.json({
        ok: true,
        data: listDeposits(db, {
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/deposits/:id`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_deposit', 'contracts:read']);
      res.json({ ok: true, data: getDepositDetail(db, Number(req.params.id)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/deposits/:id/settle`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:manage_deposit');
      const parsed = SettleDepositSchema.parse({ ...req.body, depositId: Number(req.params.id) });
      res.json({
        ok: true,
        data: settleDeposit(
          db,
          { id: session.userId, username: session.username },
          previewVaultDir,
          previewVaultKey,
          parsed
        ),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/deposits/:id/document`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_deposit']);
      res.json({
        ok: true,
        data: readDepositDocument(db, previewVaultDir, previewVaultKey, Number(req.params.id)),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/fines`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_deposit']);
      res.json({
        ok: true,
        data: listTrafficFines(db, {
          contractId: req.query.contractId ? Number(req.query.contractId) : undefined,
          customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/fines`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:manage_deposit');
      const parsed = CreateTrafficFineSchema.parse(req.body);
      res.status(201).json({
        ok: true,
        data: createTrafficFine(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/customers/accounts`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'reports:view', 'finance:approve_adjustment']);
      res.json({
        ok: true,
        data: listCustomerFinancialAccounts(db, {
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          onlyWithBalance: req.query.onlyWithBalance === 'true',
          onlyOverdue: req.query.onlyOverdue === 'true',
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/customers/:id/ledger`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, [
        'finance:read',
        'reports:view',
        'finance:approve_adjustment',
        'customers:read',
      ]);
      res.json({ ok: true, data: getCustomerFinancialLedger(db, Number(req.params.id)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/customers/:id/adjustments`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:approve_adjustment');
      const parsed = CreateCustomerAdjustmentSchema.parse({
        ...req.body,
        customerId: Number(req.params.id),
      });
      res.status(201).json({
        ok: true,
        data: createCustomerAdjustment(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/suppliers`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_expenses']);
      res.json({ ok: true, data: listSuppliers(db) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/suppliers`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:manage_expenses');
      const parsed = CreateSupplierSchema.parse(req.body);
      res.status(201).json({
        ok: true,
        data: createSupplier(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/expenses`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_expenses']);
      res.json({
        ok: true,
        data: listExpenses(db, {
          category: typeof req.query.category === 'string' ? req.query.category : undefined,
          vehicleId: req.query.vehicleId ? Number(req.query.vehicleId) : undefined,
          supplierId: req.query.supplierId ? Number(req.query.supplierId) : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          scope:
            req.query.scope === 'VEHICLE' || req.query.scope === 'AGENCY' ? req.query.scope : 'ALL',
          dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
          dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/expenses`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:manage_expenses');
      const parsed = CreateExpenseSchema.parse(req.body);
      res.status(201).json({
        ok: true,
        data: recordExpense(
          db,
          { id: session.userId, username: session.username },
          previewVaultDir,
          previewVaultKey,
          parsed
        ),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/expenses/:id/reverse`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:approve_adjustment');
      const parsed = ReverseExpenseSchema.parse({ ...req.body, expenseId: Number(req.params.id) });
      res.json({
        ok: true,
        data: reverseExpense(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/expenses/:id/document`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_expenses']);
      res.json({
        ok: true,
        data: readExpenseDocument(db, previewVaultDir, previewVaultKey, Number(req.params.id)),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/cash-register/current`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:cash_register']);
      res.json({ ok: true, data: getCurrentCashSession(db) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/cash-register/sessions`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:cash_register']);
      const limit = req.query.limit ? Number(req.query.limit) : 90;
      res.json({ ok: true, data: listCashSessions(db, limit) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/cash-register/sessions/:id`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:cash_register']);
      res.json({ ok: true, data: getCashSessionDetail(db, Number(req.params.id)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/cash-register/open`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:cash_register');
      const parsed = OpenCashSessionSchema.parse(req.body);
      res.status(201).json({
        ok: true,
        data: openCashSession(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/cash-register/sessions/:id/close`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:cash_register');
      const parsed = CloseCashSessionSchema.parse({ ...req.body, sessionId: Number(req.params.id) });
      res.json({
        ok: true,
        data: closeCashSession(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(`${PREVIEW_ENDPOINTS.FINANCE}/cash-register/sessions/:id/adjustment`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requirePermission(db, session, 'finance:approve_adjustment');
      const parsed = RecordCashAdjustmentSchema.parse({ ...req.body, sessionId: Number(req.params.id) });
      res.status(201).json({
        ok: true,
        data: recordCashAdjustment(db, { id: session.userId, username: session.username }, parsed),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.REPORTS}/dashboard`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'reports:view']);
      res.json({
        ok: true,
        data: getFinancialDashboardReports(db, {
          dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
          dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.REPORTS}/vehicle-profitability`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'reports:view']);
      res.json({
        ok: true,
        data: getVehicleProfitabilityReport(db, {
          dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
          dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
          includeArchived: req.query.includeArchived === 'true',
        }),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.FINANCE}/vehicles/:id/summary`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_expenses', 'reports:view']);
      res.json({ ok: true, data: getVehicleFinanceSummary(db, Number(req.params.id)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(`${PREVIEW_ENDPOINTS.REPORTS}/export-csv`, (req, res) => {
    try {
      const session = requireAuthenticatedSession(db, previewSessionStore, extractBearer(req));
      requireAnyPermission(session.userId, ['finance:read', 'reports:view']);
      const report = getFinancialDashboardReports(db, {
        dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
        dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
      });
      const lang = req.query.lang === 'ar' ? 'ar' : 'fr';
      res.json({
        ok: true,
        data: {
          fileName: `rapport-financier-${report.dateFrom}_${report.dateTo}.csv`,
          csvContent: buildFinancialReportCsv(report, lang),
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Reject any unknown /api/* path cleanly (never expose production DB or static FS)
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint API introuvable' } });
  });

  return { app, db, previewDbPath, previewVaultDir, previewSessionStore };
}

async function startServer() {
  const { app } = createPreviewExpressApp();
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3000);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[Preview Server] Running on http://0.0.0.0:${port} (Isolated temp SQLite DB)`);
  });
}

// Start HTTP server only when executed directly as entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  startServer().catch((err) => {
    console.error('Failed to start preview server:', err);
    process.exit(1);
  });
}
