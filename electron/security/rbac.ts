import type Database from 'better-sqlite3';
import type { PermissionCode } from '../../shared/types/domain.ts';
import type { ActiveSessionRecord, SessionStore } from './sessionStore.ts';

export class AuthError extends Error {
  readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'LOCKED' | 'CONFLICT' | 'VALIDATION_ERROR' | 'NOT_FOUND';
  readonly httpStatus: number;

  constructor(
    code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'LOCKED' | 'CONFLICT' | 'VALIDATION_ERROR' | 'NOT_FOUND',
    message: string
  ) {
    super(message);
    this.code = code;
    this.httpStatus =
      code === 'UNAUTHORIZED'
        ? 401
        : code === 'LOCKED'
          ? 423
          : code === 'FORBIDDEN'
            ? 403
            : code === 'CONFLICT'
              ? 409
              : code === 'NOT_FOUND'
                ? 404
                : 400;
  }
}

/**
 * Computes effective backend permissions from role_permissions + user_permissions overrides.
 */
export function resolveEffectivePermissions(db: Database.Database, userId: number, roleId: number): PermissionCode[] {
  const rolePerms = db
    .prepare<[number], { code: PermissionCode }>(
      `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`
    )
    .all(roleId);

  const effective = new Set<PermissionCode>(rolePerms.map((r) => r.code));

  const overrides = db
    .prepare<[number], { code: PermissionCode; granted: number }>(
      `SELECT p.code, up.granted
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = ?`
    )
    .all(userId);

  for (const ov of overrides) {
    if (ov.granted === 1) {
      effective.add(ov.code);
    } else {
      effective.delete(ov.code);
    }
  }

  return Array.from(effective).sort();
}

/**
 * Backend authentication guard. Rejects missing, expired, or locked sessions.
 */
export function requireAuthenticatedSession(
  db: Database.Database,
  sessionStore: SessionStore,
  token: string | null | undefined,
  allowLocked = false
): ActiveSessionRecord {
  const session = sessionStore.get(token);
  if (!session) {
    throw new AuthError('UNAUTHORIZED', 'Session invalide ou expirée');
  }

  const userRow = db
    .prepare<[number], { is_active: number }>('SELECT is_active FROM users WHERE id = ?')
    .get(session.userId);

  if (!userRow || userRow.is_active !== 1) {
    sessionStore.revoke(session.token);
    throw new AuthError('UNAUTHORIZED', 'Compte utilisateur désactivé');
  }

  if (session.isLocked && !allowLocked) {
    throw new AuthError('LOCKED', 'Session verrouillée — déverrouillage requis');
  }

  sessionStore.touch(session.token);
  return session;
}

/**
 * Backend RBAC authorization guard. Always verifies permissions from SQLite, never trusting client claims.
 */
export function requirePermission(
  db: Database.Database,
  session: ActiveSessionRecord,
  requiredPermission: PermissionCode
): void {
  const row = db
    .prepare<[number], { role_id: number; role_code: string }>(
      `SELECT u.role_id, r.code AS role_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.is_active = 1`
    )
    .get(session.userId);

  if (!row) {
    throw new AuthError('UNAUTHORIZED', 'Utilisateur introuvable ou inactif');
  }

  const livePermissions = resolveEffectivePermissions(db, session.userId, row.role_id);
  if (!livePermissions.includes(requiredPermission)) {
    throw new AuthError('FORBIDDEN', `Permission requise: ${requiredPermission}`);
  }
}
