import type Database from 'better-sqlite3';
import type { PermissionCode, RoleCode, User } from '../../../shared/types/domain.ts';
import { hashPassword } from '../../security/crypto.ts';
import { AuthError, resolveEffectivePermissions } from '../../security/rbac.ts';
import type { SessionStore } from '../../security/sessionStore.ts';
import { writeAuditLog } from './auditService.ts';
import { mapRawUser } from './authService.ts';

export interface UserWithPermissions extends User {
  permissions: PermissionCode[];
  permissionOverrides: Array<{ code: PermissionCode; granted: boolean }>;
}

export function listUsers(db: Database.Database): UserWithPermissions[] {
  const rows = db
    .prepare<[], any>(
      `SELECT u.*, r.code AS role_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id ASC`
    )
    .all();

  const overrideStmt = db.prepare<[number], { code: PermissionCode; granted: number }>(
    `SELECT p.code, up.granted
     FROM user_permissions up
     JOIN permissions p ON p.id = up.permission_id
     WHERE up.user_id = ?`
  );

  return rows.map((row) => {
    const user = mapRawUser(row);
    const permissions = resolveEffectivePermissions(db, user.id, user.roleId);
    const overrides = overrideStmt.all(user.id).map((o) => ({
      code: o.code,
      granted: o.granted === 1,
    }));
    return { ...user, permissions, permissionOverrides: overrides };
  });
}

export function listAllPermissions(db: Database.Database) {
  return db
    .prepare<[], { id: number; code: PermissionCode; module: string; description_fr: string; description_ar: string }>(
      'SELECT id, code, module, description_fr, description_ar FROM permissions ORDER BY module, id'
    )
    .all()
    .map((p) => ({
      id: p.id,
      code: p.code,
      module: p.module,
      descriptionFr: p.description_fr,
      descriptionAr: p.description_ar,
    }));
}

export function createUser(
  db: Database.Database,
  actor: { id: number; username: string },
  input: { username: string; fullName: string; password: string; roleCode: RoleCode }
): UserWithPermissions {
  const tx = db.transaction(() => {
    const exists = db
      .prepare<[string], { id: number }>('SELECT id FROM users WHERE username = ?')
      .get(input.username.trim());
    if (exists) {
      throw new AuthError('CONFLICT', `Le nom d'utilisateur "${input.username}" existe déjà`);
    }

    const role = db
      .prepare<[string], { id: number }>('SELECT id FROM roles WHERE code = ?')
      .get(input.roleCode);
    if (!role) {
      throw new AuthError('VALIDATION_ERROR', 'Rôle invalide');
    }

    const hash = hashPassword(input.password);
    const res = db
      .prepare(
        `INSERT INTO users (username, full_name, password_hash, role_id, is_active)
         VALUES (?, ?, ?, ?, 1)`
      )
      .run(input.username.trim(), input.fullName.trim(), hash, role.id);

    const newId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'USER_CREATED',
      entityType: 'users',
      entityId: newId,
      newValue: { username: input.username.trim(), fullName: input.fullName.trim(), roleCode: input.roleCode },
    });

    return newId;
  });

  const userId = tx();
  return listUsers(db).find((u) => u.id === userId)!;
}

export function updateUser(
  db: Database.Database,
  sessionStore: SessionStore,
  actor: { id: number; username: string },
  targetUserId: number,
  input: {
    fullName?: string;
    roleCode?: RoleCode;
    isActive?: boolean;
    unlockAccount?: boolean;
    resetPassword?: string;
    permissionOverrides?: Array<{ code: PermissionCode; granted: boolean | null }>;
  }
): UserWithPermissions {
  const tx = db.transaction(() => {
    const current = db
      .prepare<[number], any>(
        `SELECT u.*, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`
      )
      .get(targetUserId);

    if (!current) {
      throw new AuthError('NOT_FOUND', 'Utilisateur introuvable');
    }

    if (targetUserId === actor.id && input.isActive === false) {
      throw new AuthError('VALIDATION_ERROR', 'Vous ne pouvez pas désactiver votre propre compte');
    }
    if (targetUserId === actor.id && input.roleCode && input.roleCode !== 'ADMIN') {
      throw new AuthError('VALIDATION_ERROR', 'Vous ne pouvez pas rétrograder votre propre rôle ADMIN');
    }

    let roleId = current.role_id;
    if (input.roleCode) {
      const roleRow = db
        .prepare<[string], { id: number }>('SELECT id FROM roles WHERE code = ?')
        .get(input.roleCode);
      if (!roleRow) throw new AuthError('VALIDATION_ERROR', 'Rôle invalide');
      roleId = roleRow.id;
    }

    const nextActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : current.is_active;
    const nextFullName = input.fullName !== undefined ? input.fullName.trim() : current.full_name;
    const nextFailed = input.unlockAccount ? 0 : current.failed_login_attempts;
    const nextLockedUntil = input.unlockAccount ? null : current.locked_until;
    const nextHash = input.resetPassword ? hashPassword(input.resetPassword) : current.password_hash;

    db.prepare(
      `UPDATE users
       SET full_name = ?, role_id = ?, is_active = ?,
           failed_login_attempts = ?, locked_until = ?, password_hash = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextFullName, roleId, nextActive, nextFailed, nextLockedUntil, nextHash, targetUserId);

    if (input.permissionOverrides) {
      const delStmt = db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ?');
      const upsertStmt = db.prepare(
        `INSERT INTO user_permissions (user_id, permission_id, granted, granted_by_user_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, permission_id) DO UPDATE SET granted = excluded.granted, granted_by_user_id = excluded.granted_by_user_id`
      );
      const findPerm = db.prepare<[string], { id: number }>('SELECT id FROM permissions WHERE code = ?');

      for (const ov of input.permissionOverrides) {
        const perm = findPerm.get(ov.code);
        if (!perm) continue;
        if (ov.granted === null) {
          delStmt.run(targetUserId, perm.id);
        } else {
          upsertStmt.run(targetUserId, perm.id, ov.granted ? 1 : 0, actor.id);
        }
      }
    }

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'USER_UPDATED',
      entityType: 'users',
      entityId: targetUserId,
      previousValue: {
        fullName: current.full_name,
        roleCode: current.role_code,
        isActive: current.is_active === 1,
      },
      newValue: {
        fullName: nextFullName,
        roleCode: input.roleCode ?? current.role_code,
        isActive: nextActive === 1,
        passwordReset: Boolean(input.resetPassword),
        unlockAccount: Boolean(input.unlockAccount),
        permissionOverridesCount: input.permissionOverrides?.length ?? 0,
      },
    });
  });

  tx();
  const updated = listUsers(db).find((u) => u.id === targetUserId)!;
  sessionStore.updateUserSnapshot(targetUserId, updated, updated.permissions);
  return updated;
}
