import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { ZodError } from 'zod';
import {
  AdjustInventoryStockSchema,
  AddVehicleDamageSchema,
  ArchiveCustomerDocSchema,
  BootstrapAdminSchema,
  CalculatePriceSchema,
  ChangePasswordSchema,
  CloseCashSessionSchema,
  CompleteContractSchema,
  CreateBackupSchema,
  CreateBlockedPeriodSchema,
  CreateContractPhase2Schema,
  CreateCustomerAdjustmentSchema,
  CreateCustomerSchema,
  CreateExpenseSchema,
  CreateInspectionSchema,
  CreateMaintenanceRecordSchema,
  CreateReservationSchema,
  CreateRiskRecordSchema,
  CreateSeasonalRateSchema,
  CreateSupplierSchema,
  CreateTrafficFineSchema,
  CreateUserSchema,
  CreateVehicleSchema,
  ExportBackupSchema,
  ExportReportSchema,
  ExtendContractSchema,
  GenerateDocumentSchema,
  ImportBackupSchema,
  ListDocumentsSchema,
  LoginSchema,
  OpenCashSessionSchema,
  PrintDocumentSchema,
  RecordCashAdjustmentSchema,
  RecordInventoryMovementSchema,
  RecordPaymentSchema,
  ReportFilterSchema,
  ReprintDocumentSchema,
  ResolveRiskRecordSchema,
  RestoreBackupSchema,
  ReverseExpenseSchema,
  ReversePaymentSchema,
  SettleDepositSchema,
  ShowRecoveryKeySchema,
  UnlockSessionSchema,
  UpdateCustomerDocMetaSchema,
  UpdateCustomerSchema,
  UpdateDamageStatusSchema,
  UpdateDocumentTemplatesSchema,
  UpdateInspectionDraftSchema,
  UpdateMaintenanceRecordSchema,
  UpdateReservationStatusSchema,
  UpdateSettingsBatchSchema,
  UpdateUserSchema,
  UpdateVehicleSchema,
  UploadAgencyLogoSchema,
  UploadCustomerDocSchema,
  UploadInspectionPhotoSchema,
  UpsertCustomerCustomRateSchema,
  UpsertInventoryPartSchema,
  UpsertMaintenanceTypeSchema,
  UpsertSupplierSchema,
  UpsertVehicleDocSchema,
  UpsertVehicleMaintenanceScheduleSchema,
  UpsertWilayaSchema,
  VerifyBackupSchema,
} from '../../shared/schemas/index.ts';
import type { PermissionCode } from '../../shared/types/domain.ts';
import {
  listOperationalAlerts,
  markAlertRead,
  resolveAlert,
  syncOperationalAlerts,
} from '../database/services/alertService.ts';
import { listAuditLogs, writeAuditLog } from '../database/services/auditService.ts';
import {
  createBackup,
  exportBackupFile,
  getBackupRecordById,
  importBackupExternal,
  listBackups,
  restoreFromBackup,
  verifyBackupArchive,
} from '../backups/backupService.ts';
import { checkDatabaseHealth } from '../database/services/healthService.ts';
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
  archiveCustomerDocument,
  checkCustomerEligibility,
  createCustomer,
  getCustomerProfile,
  listCustomers,
  readCustomerDocument,
  resolveCustomerRiskRecord,
  updateCustomer,
  updateCustomerDocumentMeta,
  uploadCustomerDocument,
} from '../database/services/customerService.ts';
import {
  generateAndArchiveDocument,
  getDocumentById,
  getDocumentTemplateConfig,
  listDocuments,
  readAgencyLogo,
  readArchivedDocumentPdf,
  recordDocumentPrintEvent,
  reprintArchivedDocument,
  updateDocumentTemplateConfig,
  uploadAgencyLogo,
} from '../database/services/documentService.ts';
import {
  buildReportCsv,
  buildReportXlsx,
  generateReportDataset,
} from '../database/services/reportService.ts';
import { createNoopPrintAdapter, type DesktopPrintAdapter } from './printService.ts';
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
  upsertSupplier,
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
  addVehicleDamage,
  createInspection,
  deleteInspectionPhoto,
  finalizeInspection,
  getContractInspections,
  getInspectionDetail,
  getInspectionPdfPayload,
  listInspections,
  listVehicleDamages,
  readInspectionPhoto,
  updateDamageStatus,
  updateInspectionDraft,
  uploadInspectionPhoto,
} from '../database/services/inspectionService.ts';
import {
  adjustInventoryStock,
  archiveInventoryPart,
  getInventoryOverview,
  getInventoryPartDetail,
  listInventoryMovements,
  listInventoryParts,
  recordInventoryMovement,
  upsertInventoryPart,
} from '../database/services/inventoryService.ts';
import {
  createMaintenanceRecord,
  getMaintenanceRecordDetail,
  getVehicleMaintenanceOverview,
  listMaintenanceRecords,
  listMaintenanceTypes,
  readMaintenanceInvoice,
  updateMaintenanceRecord,
  upsertMaintenanceType,
  upsertVehicleMaintenanceSchedule,
} from '../database/services/maintenanceService.ts';
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
import { formatVaultRecoveryKey, getVaultKeyFingerprint, verifyPassword } from '../security/crypto.ts';
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
  protectionMode?: 'dpapi_safestorage' | 'local_file_0600';
}

export interface IpcRuntimeContext {
  dbPath?: string;
  migrationsDir?: string;
  backupDir?: string;
  appVersion?: string;
  onDatabaseReplaced?: (nextDb: Database.Database) => void;
  pickBackupPath?: (options: {
    mode: 'save' | 'open';
    defaultFileName?: string;
  }) => Promise<{ canceled: boolean; filePath: string | null }>;
}

/**
 * Creates the desktop IPC handler map backed by SQLite + Zod + RBAC.
 * Testable independently from Electron GUI runtime.
 */
export function createIpcHandlers(
  initialDb: Database.Database,
  sessionStore: SessionStore,
  vault?: IpcVaultContext,
  printAdapter: DesktopPrintAdapter = createNoopPrintAdapter(),
  runtimeContext?: IpcRuntimeContext
): Record<string, IpcHandlerFn> {
  let db = initialDb;
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

    [IPC_CHANNELS.CUSTOMERS_UPDATE_DOC_META]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:write');
      const parsed = UpdateCustomerDocMetaSchema.parse(env.data);
      return updateCustomerDocumentMeta(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.CUSTOMERS_ARCHIVE_DOC]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'customers:write');
      const parsed = ArchiveCustomerDocSchema.parse(env.data);
      return archiveCustomerDocument(db, { id: session.userId, username: session.username }, parsed.docId, parsed.reason);
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

    // Phase 4 Step 1: Vehicle Inspections & Damage Management
    [IPC_CHANNELS.INSPECTIONS_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inspections:view',
        'inspections:create',
        'inspections:update',
        'inspections:finalize',
        'inspections:manage_damage',
        'inspections:write',
        'contracts:read',
      ]);
      return listInspections(db, env.data as any);
    }),

    [IPC_CHANNELS.INSPECTIONS_GET]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inspections:view',
        'inspections:create',
        'inspections:update',
        'inspections:finalize',
        'inspections:manage_damage',
        'inspections:write',
        'contracts:read',
      ]);
      return getInspectionDetail(db, Number(env.data?.inspectionId ?? env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.INSPECTIONS_GET_BY_CONTRACT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inspections:view',
        'inspections:create',
        'inspections:write',
        'contracts:read',
      ]);
      return getContractInspections(db, Number(env.data?.contractId ?? env.data));
    }),

    [IPC_CHANNELS.INSPECTIONS_CREATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inspections:create', 'inspections:write']);
      const parsed = CreateInspectionSchema.parse(env.data);
      if (parsed.finalizeNow) {
        requireAnyPermission(session.userId, ['inspections:finalize', 'inspections:write']);
      }
      return createInspection(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.INSPECTIONS_UPDATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inspections:update', 'inspections:write']);
      const parsed = UpdateInspectionDraftSchema.parse(env.data);
      return updateInspectionDraft(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.INSPECTIONS_FINALIZE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inspections:finalize', 'inspections:write']);
      return finalizeInspection(
        db,
        { id: session.userId, username: session.username },
        Number(env.data?.inspectionId ?? env.data)
      );
    }),

    [IPC_CHANNELS.INSPECTIONS_UPLOAD_PHOTO]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inspections:create', 'inspections:update', 'inspections:write']);
      if (!vault) throw new Error('Vault non configuré');
      const parsed = UploadInspectionPhotoSchema.parse(env.data);
      return uploadInspectionPhoto(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.INSPECTIONS_READ_PHOTO]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inspections:view', 'inspections:write', 'contracts:read']);
      if (!vault) throw new Error('Vault non configuré');
      return readInspectionPhoto(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.photoId ?? env.data)
      );
    }),

    [IPC_CHANNELS.INSPECTIONS_DELETE_PHOTO]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inspections:update', 'inspections:write']);
      if (!vault) throw new Error('Vault non configuré');
      return deleteInspectionPhoto(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        Number(env.data?.photoId ?? env.data)
      );
    }),

    [IPC_CHANNELS.INSPECTIONS_GET_PDF_PAYLOAD]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inspections:view', 'inspections:write', 'contracts:read', 'documents:generate']);
      if (!vault) throw new Error('Vault non configuré');
      return getInspectionPdfPayload(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.inspectionId ?? env.data)
      );
    }),

    [IPC_CHANNELS.DAMAGES_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inspections:view',
        'inspections:manage_damage',
        'inspections:write',
        'vehicles:read',
      ]);
      return listVehicleDamages(db, env.data as any);
    }),

    [IPC_CHANNELS.DAMAGES_ADD]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inspections:create',
        'inspections:update',
        'inspections:manage_damage',
        'inspections:write',
      ]);
      const parsed = AddVehicleDamageSchema.parse(env.data);
      return addVehicleDamage(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.DAMAGES_UPDATE_STATUS]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'inspections:manage_damage');
      const parsed = UpdateDamageStatusSchema.parse(env.data);
      return updateDamageStatus(db, { id: session.userId, username: session.username }, parsed);
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
      requireAnyPermission(session.userId, [
        'finance:read',
        'finance:manage_expenses',
        'inventory:view',
        'inventory:manage_parts',
        'inventory:manage_suppliers',
        'inventory:read',
        'inventory:write',
        'maintenance:view',
        'maintenance:create',
      ]);
      return listSuppliers(db, Boolean(env.data?.includeArchived));
    }),

    [IPC_CHANNELS.FINANCE_CREATE_SUPPLIER]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'finance:manage_expenses',
        'inventory:manage_suppliers',
        'inventory:write',
      ]);
      const parsed = CreateSupplierSchema.parse(env.data);
      return createSupplier(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.FINANCE_UPSERT_SUPPLIER]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'finance:manage_expenses',
        'inventory:manage_suppliers',
        'inventory:write',
      ]);
      const parsed = UpsertSupplierSchema.parse(env.data);
      return upsertSupplier(db, { id: session.userId, username: session.username }, parsed);
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

    // Phase 4 Step 2: Maintenance Management & Operational Alerts
    [IPC_CHANNELS.MAINTENANCE_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'maintenance:view',
        'maintenance:create',
        'maintenance:update',
        'maintenance:complete',
        'maintenance:write',
        'vehicles:read',
      ]);
      return listMaintenanceRecords(db, env.data as any);
    }),

    [IPC_CHANNELS.MAINTENANCE_GET]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'maintenance:view',
        'maintenance:create',
        'maintenance:update',
        'maintenance:complete',
        'maintenance:write',
        'vehicles:read',
      ]);
      return getMaintenanceRecordDetail(db, Number(env.data?.recordId ?? env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.MAINTENANCE_CREATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['maintenance:create', 'maintenance:write']);
      if (!vault) throw new Error('Vault non configuré');
      const parsed = CreateMaintenanceRecordSchema.parse(env.data);
      if (parsed.status === 'COMPLETED') {
        requireAnyPermission(session.userId, ['maintenance:complete', 'maintenance:write']);
      }
      if (parsed.recordInFinance) {
        requirePermission(db, session, 'finance:manage_expenses');
      }
      return createMaintenanceRecord(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.MAINTENANCE_UPDATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['maintenance:update', 'maintenance:complete', 'maintenance:write']);
      if (!vault) throw new Error('Vault non configuré');
      const parsed = UpdateMaintenanceRecordSchema.parse(env.data);
      if (parsed.status === 'COMPLETED') {
        requireAnyPermission(session.userId, ['maintenance:complete', 'maintenance:write']);
      }
      if (parsed.recordInFinance) {
        requirePermission(db, session, 'finance:manage_expenses');
      }
      return updateMaintenanceRecord(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.MAINTENANCE_READ_INVOICE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'maintenance:view',
        'maintenance:create',
        'maintenance:update',
        'maintenance:complete',
        'maintenance:write',
        'finance:read',
      ]);
      if (!vault) throw new Error('Vault non configuré');
      return readMaintenanceInvoice(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.recordId ?? env.data)
      );
    }),

    [IPC_CHANNELS.MAINTENANCE_TYPES_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'maintenance:view',
        'maintenance:create',
        'maintenance:manage_types',
        'maintenance:write',
        'vehicles:read',
      ]);
      return listMaintenanceTypes(db, env.data?.includeInactive !== false);
    }),

    [IPC_CHANNELS.MAINTENANCE_TYPES_UPSERT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'maintenance:manage_types');
      const parsed = UpsertMaintenanceTypeSchema.parse(env.data);
      return upsertMaintenanceType(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.MAINTENANCE_VEHICLE_OVERVIEW]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'maintenance:view',
        'maintenance:create',
        'maintenance:update',
        'maintenance:complete',
        'maintenance:write',
        'vehicles:read',
      ]);
      return getVehicleMaintenanceOverview(db, Number(env.data?.vehicleId ?? env.data));
    }),

    [IPC_CHANNELS.MAINTENANCE_SCHEDULE_UPSERT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['maintenance:manage_types', 'maintenance:update', 'maintenance:write']);
      const parsed = UpsertVehicleMaintenanceScheduleSchema.parse(env.data);
      return upsertVehicleMaintenanceSchedule(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.NOTIFICATIONS_LIST]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      return listOperationalAlerts(db, env.data as any);
    }),

    [IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      return syncOperationalAlerts(db, env.data?.referenceDate);
    }),

    [IPC_CHANNELS.NOTIFICATIONS_MARK_READ]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      return markAlertRead(db, Number(env.data?.alertId ?? env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.NOTIFICATIONS_RESOLVE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'maintenance:update',
        'maintenance:complete',
        'maintenance:write',
        'vehicles:write',
        'inventory:manage_parts',
        'inventory:adjust_stock',
      ]);
      return resolveAlert(
        db,
        { id: session.userId, username: session.username },
        Number(env.data?.alertId ?? env.data?.id ?? env.data)
      );
    }),

    // Phase 4 Step 3: Spare Parts Inventory
    [IPC_CHANNELS.INVENTORY_OVERVIEW]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inventory:view',
        'inventory:manage_parts',
        'inventory:record_movements',
        'inventory:manage_suppliers',
        'inventory:adjust_stock',
        'inventory:read',
        'inventory:write',
        'maintenance:view',
        'maintenance:create',
      ]);
      return getInventoryOverview(db);
    }),

    [IPC_CHANNELS.INVENTORY_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inventory:view',
        'inventory:manage_parts',
        'inventory:record_movements',
        'inventory:manage_suppliers',
        'inventory:adjust_stock',
        'inventory:read',
        'inventory:write',
        'maintenance:view',
        'maintenance:create',
        'maintenance:update',
      ]);
      return listInventoryParts(db, env.data as any);
    }),

    [IPC_CHANNELS.INVENTORY_GET]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inventory:view',
        'inventory:manage_parts',
        'inventory:record_movements',
        'inventory:adjust_stock',
        'inventory:read',
        'inventory:write',
      ]);
      return getInventoryPartDetail(db, Number(env.data?.partId ?? env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.INVENTORY_UPSERT_PART]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inventory:manage_parts', 'inventory:write']);
      const parsed = UpsertInventoryPartSchema.parse(env.data);
      return upsertInventoryPart(db, { id: session.userId, username: session.username }, parsed);
    }),

    [IPC_CHANNELS.INVENTORY_ARCHIVE_PART]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inventory:manage_parts', 'inventory:write']);
      return archiveInventoryPart(
        db,
        { id: session.userId, username: session.username },
        Number(env.data?.partId ?? env.data?.id ?? env.data),
        env.data?.archived !== false
      );
    }),

    [IPC_CHANNELS.INVENTORY_MOVEMENTS_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'inventory:view',
        'inventory:manage_parts',
        'inventory:record_movements',
        'inventory:adjust_stock',
        'inventory:read',
        'inventory:write',
      ]);
      return listInventoryMovements(db, env.data as any);
    }),

    [IPC_CHANNELS.INVENTORY_RECORD_MOVEMENT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['inventory:record_movements', 'inventory:write']);
      if (!vault) throw new Error('Vault non configuré');
      const parsed = RecordInventoryMovementSchema.parse(env.data);
      if (parsed.movementType === 'PURCHASE' && parsed.recordInFinance) {
        requirePermission(db, session, 'finance:manage_expenses');
      }
      return recordInventoryMovement(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.INVENTORY_ADJUST_STOCK]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'inventory:adjust_stock');
      const parsed = AdjustInventoryStockSchema.parse(env.data);
      return adjustInventoryStock(db, { id: session.userId, username: session.username }, parsed);
    }),

    // Phase 5: Documents, PDF Generation, Templates, Printing & Reports
    [IPC_CHANNELS.DOCUMENTS_GENERATE]: wrap(async (env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'documents:generate');
      if (!vault) throw new Error('Vault non configuré');
      const parsed = GenerateDocumentSchema.parse(env.data);
      return generateAndArchiveDocument(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed as any
      );
    }),

    [IPC_CHANNELS.DOCUMENTS_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:view', 'documents:generate']);
      const parsed = env.data ? ListDocumentsSchema.parse(env.data) : undefined;
      return listDocuments(db, parsed);
    }),

    [IPC_CHANNELS.DOCUMENTS_GET]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:view', 'documents:generate']);
      return getDocumentById(db, Number(env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.DOCUMENTS_READ]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:view', 'documents:generate']);
      if (!vault) throw new Error('Vault non configuré');
      return readArchivedDocumentPdf(db, vault.vaultRootDir, vault.vaultKey, Number(env.data?.id ?? env.data));
    }),

    [IPC_CHANNELS.DOCUMENTS_REPRINT]: wrap(async (env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:reprint', 'documents:generate']);
      if (!vault) throw new Error('Vault non configuré');
      const parsed = ReprintDocumentSchema.parse(env.data);
      return reprintArchivedDocument(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.DOCUMENTS_LIST_PRINTERS]: wrap(async (env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:view', 'documents:generate', 'documents:manage_templates']);
      return printAdapter.listPrinters();
    }),

    [IPC_CHANNELS.DOCUMENTS_PRINT]: wrap(async (env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:view', 'documents:reprint', 'documents:generate']);
      if (!vault) throw new Error('Vault non configuré');
      const parsed = PrintDocumentSchema.parse(env.data);
      const pdf = readArchivedDocumentPdf(db, vault.vaultRootDir, vault.vaultKey, parsed.documentId);
      const printRes = await printAdapter.printPdf({
        pdfBytes: Buffer.from(pdf.base64Data, 'base64'),
        documentNumber: pdf.document.documentNumber,
        format: pdf.document.format,
        printerName: parsed.printerName ?? null,
        silent: parsed.silent,
        copies: parsed.copies,
      });
      const updatedDoc = recordDocumentPrintEvent(
        db,
        { id: session.userId, username: session.username },
        parsed.documentId,
        { printerName: parsed.printerName, copies: parsed.copies, silent: parsed.silent }
      );
      return { ...printRes, document: updatedDoc };
    }),

    [IPC_CHANNELS.DOCUMENTS_TEMPLATES_GET]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, [
        'documents:view',
        'documents:generate',
        'documents:manage_templates',
        'settings:manage',
      ]);
      return getDocumentTemplateConfig(db);
    }),

    [IPC_CHANNELS.DOCUMENTS_TEMPLATES_UPDATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:manage_templates', 'settings:manage']);
      const parsed = UpdateDocumentTemplatesSchema.parse(env.data);
      return updateDocumentTemplateConfig(db, { id: session.userId, username: session.username }, parsed as any);
    }),

    [IPC_CHANNELS.DOCUMENTS_LOGO_UPLOAD]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:manage_templates', 'settings:manage']);
      if (!vault) throw new Error('Vault non configuré');
      const parsed = UploadAgencyLogoSchema.parse(env.data);
      return uploadAgencyLogo(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),

    [IPC_CHANNELS.DOCUMENTS_LOGO_READ]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['documents:view', 'documents:generate', 'documents:manage_templates', 'settings:manage']);
      if (!vault) throw new Error('Vault non configuré');
      return readAgencyLogo(db, vault.vaultRootDir, vault.vaultKey);
    }),

    [IPC_CHANNELS.REPORTS_GENERATE]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session.userId, ['reports:view', 'reports:export']);
      const parsed = ReportFilterSchema.parse(env.data);
      return generateReportDataset(db, parsed);
    }),

    [IPC_CHANNELS.REPORTS_EXPORT_FILE]: wrap(async (env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'reports:export');
      const parsed = ExportReportSchema.parse(env.data);
      const dataset = generateReportDataset(db, { ...parsed.filter, language: parsed.language });

      if (parsed.exportFormat === 'CSV') {
        const csv = buildReportCsv(dataset, parsed.language);
        return {
          exportFormat: 'CSV',
          fileName: `${dataset.reportCode}_${parsed.language}.csv`,
          mimeType: 'text/csv;charset=utf-8',
          base64Data: Buffer.from(csv, 'utf8').toString('base64'),
        };
      }
      if (parsed.exportFormat === 'XLSX') {
        const buf = await buildReportXlsx(dataset, parsed.language);
        return {
          exportFormat: 'XLSX',
          fileName: `${dataset.reportCode}_${parsed.language}.xlsx`,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          base64Data: buf.toString('base64'),
        };
      }
      if (!vault) throw new Error('Vault non configuré');
      const docKind = parsed.filter.category === 'FINANCIAL' ? 'FINANCIAL_SUMMARY' : 'CUSTOM_REPORT';
      const generated = await generateAndArchiveDocument(
        db,
        { id: session.userId, username: session.username },
        vault.vaultRootDir,
        vault.vaultKey,
        {
          documentKind: docKind,
          format: parsed.pdfFormat ?? 'A4_PDF',
          language: parsed.language,
          numeralSystem: parsed.numeralSystem,
          dateFrom: parsed.filter.dateFrom ?? null,
          dateTo: parsed.filter.dateTo ?? null,
          customerId: parsed.filter.customerId ?? null,
          vehicleId: parsed.filter.vehicleId ?? null,
          reportFilter: parsed.filter,
        }
      );
      return {
        exportFormat: 'PDF',
        fileName: generated.document.originalFileName,
        mimeType: 'application/pdf',
        base64Data: generated.pdfBase64,
        document: generated.document,
      };
    }),

    // Phase 6: Database Health, Encrypted Backups, Recovery Key & Atomic Restore
    [IPC_CHANNELS.BACKUPS_HEALTH]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'db:health');
      if (!vault) throw new Error('Vault non configuré');
      return checkDatabaseHealth(db, {
        dbPath: runtimeContext?.dbPath ?? db.name,
        migrationsDir: runtimeContext?.migrationsDir,
        vaultRootDir: vault.vaultRootDir,
        vaultProtectionMode: vault.protectionMode ?? 'local_file_0600',
        deepIntegrity: env.data?.deepIntegrity !== false,
      });
    }),

    [IPC_CHANNELS.BACKUPS_LIST]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'backups:manage');
      return listBackups(db, env.data?.limit ? Number(env.data.limit) : 100);
    }),

    [IPC_CHANNELS.BACKUPS_CREATE_MANUAL]: wrap(async (env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'backups:manage');
      if (!vault) throw new Error('Vault non configuré');
      const parsed = CreateBackupSchema.parse(env.data ?? {});
      const backupDir = runtimeContext?.backupDir ?? path.join(path.dirname(vault.vaultRootDir), 'backups');
      return createBackup(db, {
        backupDir,
        vaultRootDir: vault.vaultRootDir,
        vaultKey: vault.vaultKey,
        appVersion: runtimeContext?.appVersion ?? '1.0.0',
        backupType: parsed.backupType,
        encryptionMode: parsed.encryptionMode,
        passphrase: parsed.passphrase,
        destinationPath: parsed.destinationPath ?? null,
        notes: parsed.notes ?? null,
        actor: { id: session.userId, username: session.username },
      });
    }),

    [IPC_CHANNELS.BACKUPS_VERIFY]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'backups:manage');
      if (!vault) throw new Error('Vault non configuré');
      const parsed = VerifyBackupSchema.parse(env.data ?? {});
      let filePath = parsed.filePath;
      let tempPath: string | null = null;
      try {
        if (parsed.backupRecordId) {
          const rec = getBackupRecordById(db, parsed.backupRecordId);
          filePath = rec.destinationPath;
        } else if (parsed.base64Archive) {
          tempPath = path.join(os.tmpdir(), `agl-verify-ipc-${Date.now()}.agbkp`);
          fs.writeFileSync(tempPath, Buffer.from(parsed.base64Archive, 'base64'), { mode: 0o600 });
          filePath = tempPath;
        }
        if (!filePath) {
          throw new AuthError('VALIDATION_ERROR', 'Identifiant ou fichier de sauvegarde requis');
        }
        return verifyBackupArchive({
          filePath,
          passphrase: parsed.passphrase,
          recoveryKey: parsed.recoveryKey,
          vaultKey: vault.vaultKey,
          db,
          backupRecordId: parsed.backupRecordId,
          actor: { id: session.userId, username: session.username },
        });
      } finally {
        if (tempPath && fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { force: true });
        }
      }
    }),

    [IPC_CHANNELS.BACKUPS_EXPORT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'backups:manage');
      const parsed = ExportBackupSchema.parse(env.data ?? {});
      return exportBackupFile(db, {
        backupRecordId: parsed.backupRecordId,
        destinationPath: parsed.destinationPath,
        actor: { id: session.userId, username: session.username },
      });
    }),

    [IPC_CHANNELS.BACKUPS_IMPORT]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'backups:manage');
      if (!vault) throw new Error('Vault non configuré');
      const parsed = ImportBackupSchema.parse(env.data ?? {});
      const backupDir = runtimeContext?.backupDir ?? path.join(path.dirname(vault.vaultRootDir), 'backups');
      return importBackupExternal(db, {
        backupDir,
        vaultKey: vault.vaultKey,
        sourcePath: parsed.sourcePath,
        fileName: parsed.fileName,
        base64Archive: parsed.base64Archive,
        passphrase: parsed.passphrase,
        recoveryKey: parsed.recoveryKey,
        actor: { id: session.userId, username: session.username },
      });
    }),

    [IPC_CHANNELS.BACKUPS_RECOVERY_KEY]: wrap((env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'backups:manage');
      if (!vault) throw new Error('Vault non configuré');
      const parsed = ShowRecoveryKeySchema.parse(env.data ?? {});
      const adminRow = db
        .prepare<[number], { password_hash: string; is_active: number }>(
          'SELECT password_hash, is_active FROM users WHERE id = ?'
        )
        .get(session.userId);
      if (!adminRow || adminRow.is_active !== 1 || !verifyPassword(parsed.adminPassword, adminRow.password_hash)) {
        writeAuditLog(db, {
          userId: session.userId,
          usernameSnapshot: session.username,
          operation: 'SENSITIVE_ADMIN_AUTH_FAILED',
          entityType: 'users',
          entityId: session.userId,
        });
        throw new AuthError('UNAUTHORIZED', 'Mot de passe administrateur incorrect');
      }
      writeAuditLog(db, {
        userId: session.userId,
        usernameSnapshot: session.username,
        operation: 'VAULT_RECOVERY_KEY_VIEWED',
        entityType: 'backup_records',
        entityId: null,
        newValue: { fingerprint: getVaultKeyFingerprint(vault.vaultKey) },
      });
      return {
        recoveryKey: formatVaultRecoveryKey(vault.vaultKey),
        fingerprint: getVaultKeyFingerprint(vault.vaultKey),
        protectionMode: vault.protectionMode ?? 'local_file_0600',
      };
    }),

    [IPC_CHANNELS.BACKUPS_RESTORE]: wrap(async (env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'backups:restore');
      if (!vault) throw new Error('Vault non configuré');
      if (!runtimeContext?.migrationsDir) {
        throw new Error('Contexte migrations manquant pour la restauration');
      }
      const parsed = RestoreBackupSchema.parse(env.data ?? {});
      const adminRow = db
        .prepare<[number], { password_hash: string; is_active: number }>(
          'SELECT password_hash, is_active FROM users WHERE id = ?'
        )
        .get(session.userId);
      if (!adminRow || adminRow.is_active !== 1 || !verifyPassword(parsed.adminPassword, adminRow.password_hash)) {
        writeAuditLog(db, {
          userId: session.userId,
          usernameSnapshot: session.username,
          operation: 'RESTORE_AUTH_FAILED',
          entityType: 'backup_records',
          entityId: parsed.backupRecordId ?? null,
        });
        throw new AuthError('UNAUTHORIZED', 'Mot de passe administrateur incorrect');
      }

      const backupDir = runtimeContext.backupDir ?? path.join(path.dirname(vault.vaultRootDir), 'backups');
      return restoreFromBackup(
        {
          getDb: () => db,
          setDb: (nextDb) => {
            db = nextDb;
            runtimeContext.onDatabaseReplaced?.(nextDb);
          },
          dbPath: runtimeContext.dbPath ?? db.name,
          migrationsDir: runtimeContext.migrationsDir,
          vaultRootDir: vault.vaultRootDir,
          vaultKey: vault.vaultKey,
          vaultProtectionMode: vault.protectionMode ?? 'local_file_0600',
          backupDir,
          appVersion: runtimeContext.appVersion ?? '1.0.0',
        },
        {
          backupRecordId: parsed.backupRecordId,
          filePath: parsed.filePath,
          base64Archive: parsed.base64Archive,
          fileName: parsed.fileName,
          passphrase: parsed.passphrase,
          recoveryKey: parsed.recoveryKey,
          actor: { id: session.userId, username: session.username },
        }
      );
    }),

    [IPC_CHANNELS.BACKUPS_PICK_FILE]: wrap(async (env) => {
      const session = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session, 'backups:manage');
      if (!runtimeContext?.pickBackupPath) {
        return { canceled: true, filePath: null };
      }
      const mode = env.data?.mode === 'save' ? 'save' : 'open';
      const defaultFileName =
        typeof env.data?.defaultFileName === 'string' ? env.data.defaultFileName : undefined;
      return runtimeContext.pickBackupPath({ mode, defaultFileName });
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
