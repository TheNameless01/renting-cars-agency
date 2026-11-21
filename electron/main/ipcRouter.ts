import type Database from 'better-sqlite3';
import { ZodError } from 'zod';
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
} from '../../shared/schemas/index.ts';
import type { PermissionCode } from '../../shared/types/domain.ts';
import { listAuditLogs } from '../database/services/auditService.ts';
import {
  bootstrapFirstAdmin,
  changeOwnPassword,
  getAuthStatus,
  lockSession,
  loginUser,
  logoutUser,
  unlockSession,
} from '../database/services/authService.ts';
import { checkVehicleAvailability, getPlanningCalendar } from '../database/services/availabilityService.ts';
import {
  closeCashSession,
  getCashSessionDetail,
  getCurrentCashSession,
  listCashSessions,
  openCashSession,
  recordCashAdjustment,
} from '../database/services/cashRegisterService.ts';
import {
  activateContract,
  cancelContract,
  completeContract,
  createContract,
  extendContract,
  getContractDetail,
  listContracts,
} from '../database/services/contractService.ts';
import {
  createCustomerAdjustment,
  getCustomerFinancialLedger,
  listCustomerFinancialAccounts,
} from '../database/services/customerFinanceService.ts';
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
} from '../database/services/customerService.ts';
import {
  createTrafficFine,
  getDepositDetail,
  listDeposits,
  listTrafficFines,
  readDepositDocument,
  settleDeposit,
} from '../database/services/depositService.ts';
import {
  createSupplier,
  listExpenses,
  listSuppliers,
  readExpenseDocument,
  recordExpense,
  reverseExpense,
} from '../database/services/expenseService.ts';
import {
  buildFinancialReportCsv,
  getFinancialDashboardReports,
  getVehicleFinanceSummary,
  getVehicleProfitabilityReport,
} from '../database/services/financeReportService.ts';
import {
  archiveVehicle,
  createVehicle,
  createVehicleBlockedPeriod,
  getVehicleProfile,
  listVehicles,
  releaseVehicleBlockedPeriod,
  updateVehicle,
  upsertVehicleDocument,
} from '../database/services/fleetService.ts';
import {
  getPaymentReceipt,
  listPayments,
  recordPayment,
  reversePayment,
} from '../database/services/paymentService.ts';
import {
  calculateRentalPrice,
  createSeasonalRate,
  deleteSeasonalRate,
  listPricingRules,
  upsertCustomerCustomRate,
} from '../database/services/pricingService.ts';
import {
  createReservation,
  listReservations,
  updateReservationStatus,
} from '../database/services/reservationService.ts';
import { getAllSettings, updateSettingsBatch } from '../database/services/settingsService.ts';
import { createUser, listAllPermissions, listUsers, updateUser } from '../database/services/userService.ts';
import { listWilayas, upsertWilaya } from '../database/services/wilayaService.ts';
import { AuthError, requireAuthenticatedSession, requirePermission, resolveEffectivePermissions } from '../security/rbac.ts';
import type { SessionStore } from '../security/sessionStore.ts';
import { IPC_CHANNELS, type IpcChannel, type IpcResult } from '../ipc/contracts.ts';

export interface IpcEnvelope<T = unknown> {
  token?: string | null;
  data?: T;
}

export type IpcHandlerFn = (payload?: unknown) => Promise<IpcResult<unknown>>;

export interface IpcVaultContext {
  vaultRootDir: string;
  vaultKey: Buffer;
}

/**
 * Creates the desktop IPC handler map backed by SQLite + Zod + RBAC.
 * Testable independently from Electron GUI runtime.
 */
export function createIpcHandlers(
  db: Database.Database,
  sessionStore: SessionStore,
  vault?: IpcVaultContext
): Record<string, IpcHandlerFn> {
  const wrap = (fn: (envelope: IpcEnvelope<any>) => unknown): IpcHandlerFn => {
    return async (rawPayload?: unknown) => {
      try {
        const envelope: IpcEnvelope =
          rawPayload && typeof rawPayload === 'object' && ('data' in rawPayload || 'token' in rawPayload)
            ? (rawPayload as IpcEnvelope)
            : { data: rawPayload };
        const result = await fn(envelope);
        return { ok: true, data: result };
      } catch (err) {
        if (err instanceof ZodError) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: err.issues[0]?.message || 'Données invalides',
              details: err.issues,
            },
          };
        }
        if (err instanceof AuthError) {
          return {
            ok: false,
            error: {
              code: err.code,
              message: err.message,
            },
          };
        }
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : 'Erreur interne du serveur',
          },
        };
      }
    };
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

  return {
    [IPC_CHANNELS.AUTH_STATUS]: wrap(() => getAuthStatus(db, 'desktop')),

    [IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN]: wrap((env) => {
      const parsed = BootstrapAdminSchema.parse(env.data);
      return bootstrapFirstAdmin(db, sessionStore, 'desktop', parsed);
    }),

    [IPC_CHANNELS.AUTH_LOGIN]: wrap((env) => {
      const parsed = LoginSchema.parse(env.data);
      return loginUser(db, sessionStore, 'desktop', parsed.username, parsed.password);
    }),

    [IPC_CHANNELS.AUTH_ME]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token, true);
      return {
        token: session.token,
        user: session.user,
        permissions: session.permissions,
        isLocked: session.isLocked,
        expiresAt: session.expiresAt,
        runtimeMode: 'desktop',
      };
    }),

    [IPC_CHANNELS.AUTH_LOCK]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token, true);
      lockSession(db, sessionStore, session.token);
      return { locked: true };
    }),

    [IPC_CHANNELS.AUTH_UNLOCK]: wrap((env) => {
      const parsed = UnlockSessionSchema.parse(env.data);
      if (!env.token) throw new AuthError('UNAUTHORIZED', 'Jeton de session manquant');
      return unlockSession(db, sessionStore, env.token, parsed.password);
    }),

    [IPC_CHANNELS.AUTH_LOGOUT]: wrap((env) => {
      if (env.token) {
        logoutUser(db, sessionStore, env.token);
      }
      return { loggedOut: true };
    }),

    [IPC_CHANNELS.AUTH_CHANGE_PASSWORD]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      const parsed = ChangePasswordSchema.parse(env.data);
      changeOwnPassword(db, session.userId, parsed.currentPassword, parsed.newPassword);
      return { changed: true };
    }),

    [IPC_CHANNELS.USERS_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'users:manage');
      return listUsers(db);
    }),

    [IPC_CHANNELS.USERS_PERMISSIONS]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'users:manage');
      return listAllPermissions(db);
    }),

    [IPC_CHANNELS.USERS_CREATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'users:manage');
      const parsed = CreateUserSchema.parse(env.data);
      return createUser(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.USERS_UPDATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'users:manage');
      const parsed = UpdateUserSchema.parse(env.data);
      return updateUser(db, sessionStore, { id: session.userId, username: session.username }, parsed.userId, {
        fullName: parsed.fullName,
        roleCode: parsed.roleCode,
        isActive: parsed.isActive,
        unlockAccount: parsed.unlockAccount,
        resetPassword: parsed.resetPassword,
        permissionOverrides: parsed.permissionOverrides as Array<{ code: PermissionCode; granted: boolean | null }> | undefined,
      });
    }),

    [IPC_CHANNELS.SETTINGS_GET_ALL]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      return getAllSettings(db);
    }),

    [IPC_CHANNELS.SETTINGS_UPDATE_BATCH]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'settings:manage');
      const parsed = UpdateSettingsBatchSchema.parse(env.data);
      return updateSettingsBatch(db, { id: session.userId, username: session.username }, parsed.updates);
    }),

    [IPC_CHANNELS.WILAYAS_LIST]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      const activeOnly = Boolean((env.data as { activeOnly?: boolean } | undefined)?.activeOnly);
      return listWilayas(db, activeOnly);
    }),

    [IPC_CHANNELS.WILAYAS_UPSERT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'settings:manage');
      const parsed = UpsertWilayaSchema.parse(env.data);
      return upsertWilaya(db, { id: session.userId, username: session.username }, {
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
    }),

    [IPC_CHANNELS.AUDIT_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'audit:view');
      const opts = (env.data as { limit?: number; entityType?: string; operation?: string } | undefined) ?? {};
      return listAuditLogs(db, opts);
    }),

    // Phase 2: Fleet Management
    [IPC_CHANNELS.VEHICLES_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'vehicles:read');
      return listVehicles(db, env.data as any);
    }),

    [IPC_CHANNELS.VEHICLES_GET]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'vehicles:read');
      return getVehicleProfile(db, Number(env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.VEHICLES_CREATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'vehicles:write');
      const parsed = CreateVehicleSchema.parse(env.data);
      return createVehicle(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.VEHICLES_UPDATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'vehicles:write');
      const parsed = UpdateVehicleSchema.parse(env.data);
      return updateVehicle(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.VEHICLES_ARCHIVE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'vehicles:write');
      archiveVehicle(db, { id: session.userId, username: session.username }, Number(env.data?.id ?? env.data));
      return { archived: true };
    }),

    [IPC_CHANNELS.VEHICLES_UPSERT_DOC]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'vehicles:write');
      const parsed = UpsertVehicleDocSchema.parse(env.data);
      return upsertVehicleDocument(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.VEHICLES_CREATE_BLOCK]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'vehicles:write');
      const parsed = CreateBlockedPeriodSchema.parse(env.data);
      return createVehicleBlockedPeriod(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.VEHICLES_RELEASE_BLOCK]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'vehicles:write');
      releaseVehicleBlockedPeriod(db, { id: session.userId, username: session.username }, Number(env.data?.blockId ?? env.data));
      return { released: true };
    }),

    // Phase 2: Customers & Risk
    [IPC_CHANNELS.CUSTOMERS_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:read');
      return listCustomers(db, env.data as any);
    }),

    [IPC_CHANNELS.CUSTOMERS_GET]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:read');
      return getCustomerProfile(db, Number(env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.CUSTOMERS_CREATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:write');
      const parsed = CreateCustomerSchema.parse(env.data);
      return createCustomer(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.CUSTOMERS_UPDATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:write');
      const parsed = UpdateCustomerSchema.parse(env.data);
      return updateCustomer(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.CUSTOMERS_ARCHIVE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:write');
      archiveCustomer(db, { id: session.userId, username: session.username }, Number(env.data?.id ?? env.data));
      return { archived: true };
    }),

    [IPC_CHANNELS.CUSTOMERS_ADD_RISK]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:write');
      const parsed = CreateRiskRecordSchema.parse(env.data);
      return addCustomerRiskRecord(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.CUSTOMERS_RESOLVE_RISK]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:override_blacklist');
      const parsed = ResolveRiskRecordSchema.parse(env.data);
      return resolveCustomerRiskRecord(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.CUSTOMERS_UPLOAD_DOC]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:write');
      if (!vault) throw new Error('Vault non configuré');
      const parsed = UploadCustomerDocSchema.parse(env.data);
      return uploadCustomerDocument(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.CUSTOMERS_READ_DOC]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:read');
      if (!vault) throw new Error('Vault non configuré');
      return readCustomerDocument(db, vault.vaultRootDir, vault.vaultKey, Number(env.data?.docId ?? env.data));
    }),

    [IPC_CHANNELS.CUSTOMERS_CHECK_ELIGIBILITY]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:read');
      return checkCustomerEligibility(db, Number(env.data.customerId), String(env.data.rentalEndDate));
    }),

    // Phase 2: Pricing Engine
    [IPC_CHANNELS.PRICING_CALCULATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:read');
      const parsed = CalculatePriceSchema.parse(env.data);
      return calculateRentalPrice(db, parsed);
    }),

    [IPC_CHANNELS.PRICING_LIST_RULES]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:read');
      return listPricingRules(db);
    }),

    [IPC_CHANNELS.PRICING_CREATE_SEASONAL]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'settings:manage');
      const parsed = CreateSeasonalRateSchema.parse(env.data);
      return createSeasonalRate(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.PRICING_DELETE_SEASONAL]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'settings:manage');
      deleteSeasonalRate(db, { id: session.userId, username: session.username }, Number(env.data?.id ?? env.data));
      return { deleted: true };
    }),

    [IPC_CHANNELS.PRICING_UPSERT_CUSTOMER_RATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'settings:manage');
      const parsed = UpsertCustomerCustomRateSchema.parse(env.data);
      return upsertCustomerCustomRate(db, { id: session.userId, username: session.username }, parsed);
    }),

    // Phase 2: Planning & Reservations
    [IPC_CHANNELS.PLANNING_CALENDAR]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:read');
      return getPlanningCalendar(db, String(env.data.startDate), String(env.data.endDate));
    }),

    [IPC_CHANNELS.PLANNING_CHECK_AVAILABILITY]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:read');
      return checkVehicleAvailability(db, env.data);
    }),

    [IPC_CHANNELS.RESERVATIONS_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:read');
      return listReservations(db, env.data?.status);
    }),

    [IPC_CHANNELS.RESERVATIONS_CREATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:write');
      const parsed = CreateReservationSchema.parse(env.data);
      return createReservation(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.RESERVATIONS_UPDATE_STATUS]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:write');
      const parsed = UpdateReservationStatusSchema.parse(env.data);
      return updateReservationStatus(db, { id: session.userId, username: session.username }, parsed);
    }),

    // Phase 2: Rental Contracts & Extensions
    [IPC_CHANNELS.CONTRACTS_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:read');
      return listContracts(db, env.data as any);
    }),

    [IPC_CHANNELS.CONTRACTS_GET]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:read');
      return getContractDetail(db, Number(env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.CONTRACTS_CREATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:write');
      const parsed = CreateContractPhase2Schema.parse(env.data);
      return createContract(
        db,
        { id: session.userId, username: session.username },
        {
          canOverrideBlacklist: hasLivePerm(session.userId, 'customers:override_blacklist'),
          canApproveDiscount: hasLivePerm(session.userId, 'finance:approve_adjustment'),
        },
        parsed
      );
    }),

    [IPC_CHANNELS.CONTRACTS_ACTIVATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:write');
      return activateContract(
        db,
        { id: session.userId, username: session.username },
        Number(env.data.contractId),
        env.data.departureOdometerKm != null ? Number(env.data.departureOdometerKm) : undefined
      );
    }),

    [IPC_CHANNELS.CONTRACTS_EXTEND]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:extend');
      const parsed = ExtendContractSchema.parse(env.data);
      return extendContract(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.CONTRACTS_COMPLETE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:write');
      const parsed = CompleteContractSchema.parse(env.data);
      return completeContract(
        db,
        { id: session.userId, username: session.username },
        hasLivePerm(session.userId, 'finance:approve_adjustment'),
        parsed
      );
    }),

    [IPC_CHANNELS.CONTRACTS_CANCEL]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'contracts:cancel');
      return cancelContract(
        db,
        { id: session.userId, username: session.username },
        Number(env.data.contractId),
        String(env.data.reason || 'Annulation contrat')
      );
    }),

    // Phase 3: Financial Management
    [IPC_CHANNELS.FINANCE_LIST_PAYMENTS]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:record_payment']);
      return listPayments(db, env.data as any);
    }),

    [IPC_CHANNELS.FINANCE_RECORD_PAYMENT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:record_payment');
      const parsed = RecordPaymentSchema.parse(env.data);
      return recordPayment(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_REVERSE_PAYMENT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:approve_adjustment');
      const parsed = ReversePaymentSchema.parse(env.data);
      return reversePayment(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_GET_PAYMENT_RECEIPT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'finance:read',
        'finance:record_payment',
        'contracts:read',
        'documents:generate',
      ]);
      return getPaymentReceipt(db, Number(env.data?.paymentId ?? env.data));
    }),

    [IPC_CHANNELS.FINANCE_LIST_DEPOSITS]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_deposit']);
      return listDeposits(db, env.data as any);
    }),

    [IPC_CHANNELS.FINANCE_GET_DEPOSIT_DETAIL]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_deposit', 'contracts:read']);
      return getDepositDetail(db, Number(env.data?.depositId ?? env.data));
    }),

    [IPC_CHANNELS.FINANCE_SETTLE_DEPOSIT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:manage_deposit');
      if (!vault) throw new Error('Vault non configuré');
      const parsed = SettleDepositSchema.parse(env.data);
      return settleDeposit(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.FINANCE_READ_DEPOSIT_DOC]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_deposit']);
      if (!vault) throw new Error('Vault non configuré');
      return readDepositDocument(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.depositId ?? env.data)
      );
    }),

    [IPC_CHANNELS.FINANCE_LIST_FINES]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_deposit']);
      return listTrafficFines(db, env.data as any);
    }),

    [IPC_CHANNELS.FINANCE_CREATE_FINE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:manage_deposit');
      const parsed = CreateTrafficFineSchema.parse(env.data);
      return createTrafficFine(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_CUSTOMER_ACCOUNTS]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'reports:view', 'finance:approve_adjustment']);
      return listCustomerFinancialAccounts(db, env.data as any);
    }),

    [IPC_CHANNELS.FINANCE_CUSTOMER_LEDGER]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'finance:read',
        'reports:view',
        'finance:approve_adjustment',
        'customers:read',
      ]);
      return getCustomerFinancialLedger(db, Number(env.data?.customerId ?? env.data));
    }),

    [IPC_CHANNELS.FINANCE_CREATE_CUSTOMER_ADJUSTMENT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:approve_adjustment');
      const parsed = CreateCustomerAdjustmentSchema.parse(env.data);
      return createCustomerAdjustment(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_LIST_SUPPLIERS]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_expenses']);
      return listSuppliers(db);
    }),

    [IPC_CHANNELS.FINANCE_CREATE_SUPPLIER]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:manage_expenses');
      const parsed = CreateSupplierSchema.parse(env.data);
      return createSupplier(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_LIST_EXPENSES]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_expenses']);
      return listExpenses(db, env.data as any);
    }),

    [IPC_CHANNELS.FINANCE_RECORD_EXPENSE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:manage_expenses');
      if (!vault) throw new Error('Vault non configuré');
      const parsed = CreateExpenseSchema.parse(env.data);
      return recordExpense(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.FINANCE_REVERSE_EXPENSE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:approve_adjustment');
      const parsed = ReverseExpenseSchema.parse(env.data);
      return reverseExpense(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_READ_EXPENSE_DOC]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_expenses']);
      if (!vault) throw new Error('Vault non configuré');
      return readExpenseDocument(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.expenseId ?? env.data)
      );
    }),

    [IPC_CHANNELS.FINANCE_CASH_SESSION_CURRENT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:cash_register']);
      return getCurrentCashSession(db);
    }),

    [IPC_CHANNELS.FINANCE_CASH_SESSION_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:cash_register']);
      return listCashSessions(db, env.data?.limit ? Number(env.data.limit) : 90);
    }),

    [IPC_CHANNELS.FINANCE_CASH_SESSION_DETAIL]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:cash_register']);
      return getCashSessionDetail(db, Number(env.data?.sessionId ?? env.data));
    }),

    [IPC_CHANNELS.FINANCE_CASH_SESSION_OPEN]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:cash_register');
      const parsed = OpenCashSessionSchema.parse(env.data);
      return openCashSession(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_CASH_SESSION_CLOSE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:cash_register');
      const parsed = CloseCashSessionSchema.parse(env.data);
      return closeCashSession(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_CASH_RECORD_ADJUSTMENT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'finance:approve_adjustment');
      const parsed = RecordCashAdjustmentSchema.parse(env.data);
      return recordCashAdjustment(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_DASHBOARD_REPORTS]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'reports:view']);
      return getFinancialDashboardReports(db, env.data as any);
    }),

    [IPC_CHANNELS.FINANCE_VEHICLE_PROFITABILITY]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'reports:view']);
      return getVehicleProfitabilityReport(db, env.data as any);
    }),

    [IPC_CHANNELS.FINANCE_VEHICLE_SUMMARY]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'finance:manage_expenses', 'reports:view']);
      return getVehicleFinanceSummary(db, Number(env.data?.vehicleId ?? env.data));
    }),

    [IPC_CHANNELS.FINANCE_EXPORT_CSV]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['finance:read', 'reports:view']);
      const report = getFinancialDashboardReports(db, env.data as any);
      const lang = env.data?.lang === 'ar' ? 'ar' : 'fr';
      return {
        fileName: `rapport-financier-${report.dateFrom}_${report.dateTo}.csv`,
        csvContent: buildFinancialReportCsv(report, lang),
      };
    }),
  };
}

export const REGISTERED_PHASE1_IPC_CHANNELS: readonly IpcChannel[] = [
  IPC_CHANNELS.AUTH_STATUS,
  IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN,
  IPC_CHANNELS.AUTH_LOGIN,
  IPC_CHANNELS.AUTH_ME,
  IPC_CHANNELS.AUTH_LOCK,
  IPC_CHANNELS.AUTH_UNLOCK,
  IPC_CHANNELS.AUTH_LOGOUT,
  IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
  IPC_CHANNELS.USERS_LIST,
  IPC_CHANNELS.USERS_PERMISSIONS,
  IPC_CHANNELS.USERS_CREATE,
  IPC_CHANNELS.USERS_UPDATE,
  IPC_CHANNELS.SETTINGS_GET_ALL,
  IPC_CHANNELS.SETTINGS_UPDATE_BATCH,
  IPC_CHANNELS.WILAYAS_LIST,
  IPC_CHANNELS.WILAYAS_UPSERT,
  IPC_CHANNELS.AUDIT_LIST,
];
