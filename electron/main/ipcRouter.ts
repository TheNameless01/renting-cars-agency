import type Database from 'better-sqlite3';
import { ZodError } from 'zod';
import {
  BootstrapAdminSchema,
  ChangePasswordSchema,
  CreateUserSchema,
  LoginSchema,
  UnlockSessionSchema,
  UpdateSettingsBatchSchema,
  UpdateUserSchema,
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
import { getAllSettings, updateSettingsBatch } from '../database/services/settingsService.ts';
import { createUser, listAllPermissions, listUsers, updateUser } from '../database/services/userService.ts';
import { listWilayas, upsertWilaya } from '../database/services/wilayaService.ts';
import { AuthError, requireAuthenticatedSession, requirePermission } from '../security/rbac.ts';
import type { SessionStore } from '../security/sessionStore.ts';
import { IPC_CHANNELS, type IpcChannel, type IpcResult } from '../ipc/contracts.ts';

export interface IpcEnvelope<T = unknown> {
  token?: string | null;
  data?: T;
}

export type IpcHandlerFn = (payload?: unknown) => Promise<IpcResult<unknown>>;

/**
 * Creates the desktop IPC handler map backed by SQLite + Zod + RBAC.
 * Testable independently from Electron GUI runtime.
 */
export function createIpcHandlers(
  db: Database.Database,
  sessionStore: SessionStore
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
