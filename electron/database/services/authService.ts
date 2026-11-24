import type Database from 'better-sqlite3';
import type { AppLanguage, AppTheme, AuthSession, RoleCode, User } from '../../../shared/types/domain.ts';
import { hashPassword, verifyPassword } from '../../security/crypto.ts';
import { AuthError, resolveEffectivePermissions } from '../../security/rbac.ts';
import type { SessionStore } from '../../security/sessionStore.ts';
import { writeAuditLog } from './auditService.ts';

interface RawUserRow {
  id: number;
  username: string;
  full_name: string;
  password_hash: string;
  role_id: number;
  role_code: RoleCode;
  is_active: number;
  preferred_language: AppLanguage;
  preferred_theme: AppTheme;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapRawUser(row: RawUserRow): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    roleId: row.role_id,
    roleCode: row.role_code,
    isActive: row.is_active === 1,
    preferredLanguage: row.preferred_language,
    preferredTheme: row.preferred_theme,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export function getAuthStatus(db: Database.Database, runtimeMode: 'desktop' | 'preview') {
  const row = db.prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM users').get();
  return {
    needsBootstrap: (row?.cnt ?? 0) === 0,
    runtimeMode,
  };
}

export function bootstrapFirstAdmin(
  db: Database.Database,
  sessionStore: SessionStore,
  runtimeMode: 'desktop' | 'preview',
  input: { username: string; fullName: string; password: string }
): AuthSession {
  const tx = db.transaction(() => {
    const existing = db.prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM users').get();
    if ((existing?.cnt ?? 0) > 0) {
      throw new AuthError('CONFLICT', 'Le compte administrateur initial existe déjà');
    }

    const adminRole = db
      .prepare<[], { id: number }>("SELECT id FROM roles WHERE code = 'ADMIN'")
      .get();
    if (!adminRole) {
      throw new Error('Missing ADMIN role seed');
    }

    const passwordHash = hashPassword(input.password);
    const insertRes = db
      .prepare(
        `INSERT INTO users (username, full_name, password_hash, role_id, is_active, preferred_language, preferred_theme)
         VALUES (?, ?, ?, ?, 1, 'fr', 'light')`
      )
      .run(input.username.trim(), input.fullName.trim(), passwordHash, adminRole.id);

    const userId = Number(insertRes.lastInsertRowid);
    const createdRow = db
      .prepare<[number], RawUserRow>(
        `SELECT u.*, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`
      )
      .get(userId)!;

    writeAuditLog(db, {
      userId,
      usernameSnapshot: createdRow.username,
      operation: 'BOOTSTRAP_ADMIN',
      entityType: 'users',
      entityId: userId,
      newValue: { username: createdRow.username, roleCode: 'ADMIN', runtimeMode },
    });

    return createdRow;
  });

  const userRow = tx();
  const user = mapRawUser(userRow);
  const permissions = resolveEffectivePermissions(db, user.id, user.roleId);
  const session = sessionStore.create(user, permissions);

  return {
    token: session.token,
    user,
    permissions,
    expiresAt: session.expiresAt,
    runtimeMode,
  };
}

export function loginUser(
  db: Database.Database,
  sessionStore: SessionStore,
  runtimeMode: 'desktop' | 'preview',
  username: string,
  password: string
): AuthSession {
  const row = db
    .prepare<[string], RawUserRow>(
      `SELECT u.*, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.username = ?`
    )
    .get(username.trim());

  if (!row) {
    throw new AuthError('UNAUTHORIZED', 'Identifiants invalides');
  }

  if (row.is_active !== 1) {
    writeAuditLog(db, {
      userId: row.id,
      usernameSnapshot: row.username,
      operation: 'LOGIN_BLOCKED_INACTIVE',
      entityType: 'users',
      entityId: row.id,
    });
    throw new AuthError('FORBIDDEN', 'Ce compte utilisateur est désactivé');
  }

  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
    throw new AuthError(
      'LOCKED',
      `Compte temporairement bloqué suite à plusieurs tentatives échouées jusqu'à ${row.locked_until}`
    );
  }

  const valid = verifyPassword(password, row.password_hash);
  if (!valid) {
    const nextAttempts = row.failed_login_attempts + 1;
    const lockedUntil =
      nextAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS).toISOString() : null;

    db.prepare(
      `UPDATE users
       SET failed_login_attempts = ?, locked_until = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextAttempts, lockedUntil, row.id);

    writeAuditLog(db, {
      userId: row.id,
      usernameSnapshot: row.username,
      operation: 'LOGIN_FAILED',
      entityType: 'users',
      entityId: row.id,
      newValue: { failedAttempts: nextAttempts, lockedUntil },
    });

    throw new AuthError(
      lockedUntil ? 'LOCKED' : 'UNAUTHORIZED',
      lockedUntil ? 'Trop de tentatives échouées. Compte bloqué 15 minutes.' : 'Identifiants invalides'
    );
  }

  db.prepare(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL,
         last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(row.id);

  const refreshed = db
    .prepare<[number], RawUserRow>(
      `SELECT u.*, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
    )
    .get(row.id)!;

  writeAuditLog(db, {
    userId: refreshed.id,
    usernameSnapshot: refreshed.username,
    operation: 'LOGIN_SUCCESS',
    entityType: 'users',
    entityId: refreshed.id,
    newValue: { runtimeMode },
  });

  const user = mapRawUser(refreshed);
  const permissions = resolveEffectivePermissions(db, user.id, user.roleId);
  const session = sessionStore.create(user, permissions);

  return {
    token: session.token,
    user,
    permissions,
    expiresAt: session.expiresAt,
    runtimeMode,
  };
}

export function lockSession(db: Database.Database, sessionStore: SessionStore, token: string): void {
  const session = sessionStore.get(token);
  if (!session) {
    throw new AuthError('UNAUTHORIZED', 'Session invalide');
  }
  sessionStore.lock(token);
  writeAuditLog(db, {
    userId: session.userId,
    usernameSnapshot: session.username,
    operation: 'SESSION_LOCKED',
    entityType: 'users',
    entityId: session.userId,
  });
}

export function unlockSession(
  db: Database.Database,
  sessionStore: SessionStore,
  token: string,
  password: string
): AuthSession {
  const session = sessionStore.get(token);
  if (!session) {
    throw new AuthError('UNAUTHORIZED', 'Session expirée — reconnexion requise');
  }

  const row = db
    .prepare<[number], RawUserRow>(
      `SELECT u.*, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.is_active = 1`
    )
    .get(session.userId);

  if (!row) {
    sessionStore.revoke(token);
    throw new AuthError('UNAUTHORIZED', 'Compte utilisateur inactif ou introuvable');
  }

  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
    sessionStore.revoke(token);
    throw new AuthError(
      'LOCKED',
      `Compte temporairement bloqué suite à plusieurs tentatives échouées jusqu'à ${row.locked_until}`
    );
  }

  if (!verifyPassword(password, row.password_hash)) {
    const nextAttempts = row.failed_login_attempts + 1;
    const lockedUntil =
      nextAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS).toISOString() : null;

    db.prepare(
      `UPDATE users
       SET failed_login_attempts = ?, locked_until = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextAttempts, lockedUntil, row.id);

    writeAuditLog(db, {
      userId: row.id,
      usernameSnapshot: row.username,
      operation: 'UNLOCK_FAILED',
      entityType: 'users',
      entityId: row.id,
      newValue: { failedAttempts: nextAttempts, lockedUntil },
    });

    if (lockedUntil) {
      sessionStore.revoke(token);
      throw new AuthError(
        'LOCKED',
        'Trop de tentatives échouées lors du déverrouillage. Session fermée et compte bloqué 15 minutes.'
      );
    }

    throw new AuthError('UNAUTHORIZED', 'Mot de passe incorrect pour le déverrouillage');
  }

  db.prepare(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(row.id);

  const refreshed = db
    .prepare<[number], RawUserRow>(
      `SELECT u.*, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
    )
    .get(row.id)!;

  const user = mapRawUser(refreshed);
  const permissions = resolveEffectivePermissions(db, user.id, user.roleId);
  sessionStore.unlock(token, user, permissions);

  writeAuditLog(db, {
    userId: user.id,
    usernameSnapshot: user.username,
    operation: 'SESSION_UNLOCKED',
    entityType: 'users',
    entityId: user.id,
  });

  return {
    token: session.token,
    user,
    permissions,
    expiresAt: session.expiresAt,
    runtimeMode: session.runtimeMode,
  };
}

export function logoutUser(db: Database.Database, sessionStore: SessionStore, token: string): void {
  const session = sessionStore.get(token);
  if (session) {
    writeAuditLog(db, {
      userId: session.userId,
      usernameSnapshot: session.username,
      operation: 'LOGOUT',
      entityType: 'users',
      entityId: session.userId,
    });
    sessionStore.revoke(token);
  }
}

export function changeOwnPassword(
  db: Database.Database,
  userId: number,
  currentPassword: string,
  newPassword: string
): void {
  const row = db
    .prepare<[number], RawUserRow>(
      `SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    )
    .get(userId);
  if (!row) {
    throw new AuthError('NOT_FOUND', 'Utilisateur introuvable');
  }
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw new AuthError('UNAUTHORIZED', 'Mot de passe actuel incorrect');
  }

  const newHash = hashPassword(newPassword);
  db.prepare(
    `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  ).run(newHash, userId);

  writeAuditLog(db, {
    userId: row.id,
    usernameSnapshot: row.username,
    operation: 'PASSWORD_CHANGED',
    entityType: 'users',
    entityId: row.id,
  });
}
