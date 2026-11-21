import express from 'express';
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
import { getAllSettings, updateSettingsBatch } from './electron/database/services/settingsService.ts';
import { createUser, listAllPermissions, listUsers, updateUser } from './electron/database/services/userService.ts';
import { listWilayas, upsertWilaya } from './electron/database/services/wilayaService.ts';
import { AuthError, requireAuthenticatedSession, requirePermission } from './electron/security/rbac.ts';
import { SessionStore } from './electron/security/sessionStore.ts';
import { PREVIEW_ENDPOINTS } from './shared/api/previewContracts.ts';
import {
  BootstrapAdminSchema,
  ChangePasswordSchema,
  CreateUserSchema,
  LoginSchema,
  UnlockSessionSchema,
  UpdateSettingsBatchSchema,
  UpdateUserSchema,
  UpsertWilayaSchema,
} from './shared/schemas/index.ts';
import type { PermissionCode } from './shared/types/domain.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPreviewExpressApp(customDbPath?: string) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // SECURITY BOUNDARY: Strictly isolated temporary SQLite database in os.tmpdir() (or test temp path).
  const previewDbPath = customDbPath
    ? path.resolve(customDbPath)
    : resolveDatabasePath({ scope: 'browser_preview_temp' });
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

  // Reject any unknown /api/* path cleanly (never expose production DB or static FS)
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint API introuvable' } });
  });

  return { app, db, previewDbPath, previewSessionStore };
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
