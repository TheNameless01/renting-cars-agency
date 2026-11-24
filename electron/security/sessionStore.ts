import type { PermissionCode, RoleCode, User } from '../../shared/types/domain.ts';
import { generateSessionToken } from './crypto.ts';

export interface ActiveSessionRecord {
  token: string;
  userId: number;
  username: string;
  roleCode: RoleCode;
  user: User;
  permissions: PermissionCode[];
  isLocked: boolean;
  runtimeMode: 'desktop' | 'preview';
  createdAtMs: number;
  lastActivityMs: number;
  expiresAt: string;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Isolated in-memory session registry.
 * Desktop main process and browser preview server MUST instantiate separate SessionStore instances.
 */
export class SessionStore {
  private readonly sessions = new Map<string, ActiveSessionRecord>();
  private readonly runtimeMode: 'desktop' | 'preview';

  constructor(runtimeMode: 'desktop' | 'preview') {
    this.runtimeMode = runtimeMode;
  }

  create(user: User, permissions: PermissionCode[]): ActiveSessionRecord {
    const token = generateSessionToken();
    const now = Date.now();
    const record: ActiveSessionRecord = {
      token,
      userId: user.id,
      username: user.username,
      roleCode: user.roleCode,
      user,
      permissions,
      isLocked: false,
      runtimeMode: this.runtimeMode,
      createdAtMs: now,
      lastActivityMs: now,
      expiresAt: new Date(now + DEFAULT_TTL_MS).toISOString(),
    };
    this.sessions.set(token, record);
    return record;
  }

  get(token: string | undefined | null): ActiveSessionRecord | null {
    if (!token) return null;
    const record = this.sessions.get(token);
    if (!record) return null;
    if (Date.now() > Date.parse(record.expiresAt)) {
      this.sessions.delete(token);
      return null;
    }
    return record;
  }

  touch(token: string): void {
    const record = this.sessions.get(token);
    if (record && !record.isLocked) {
      record.lastActivityMs = Date.now();
    }
  }

  lock(token: string): boolean {
    const record = this.sessions.get(token);
    if (!record) return false;
    record.isLocked = true;
    return true;
  }

  checkIdleAndAutoLock(token: string, idleMinutes: number): { lockedNow: boolean; record: ActiveSessionRecord | null } {
    const record = this.get(token);
    if (!record) {
      return { lockedNow: false, record: null };
    }
    if (!record.isLocked && idleMinutes > 0 && Date.now() - record.lastActivityMs > idleMinutes * 60_000) {
      record.isLocked = true;
      return { lockedNow: true, record };
    }
    return { lockedNow: false, record };
  }

  unlock(token: string, updatedUser?: User, updatedPermissions?: PermissionCode[]): boolean {
    const record = this.sessions.get(token);
    if (!record) return false;
    record.isLocked = false;
    record.lastActivityMs = Date.now();
    if (updatedUser) record.user = updatedUser;
    if (updatedPermissions) record.permissions = updatedPermissions;
    return true;
  }

  updateUserSnapshot(userId: number, user: User, permissions: PermissionCode[]): void {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        session.user = user;
        session.roleCode = user.roleCode;
        session.permissions = permissions;
        if (!user.isActive) {
          this.sessions.delete(session.token);
        }
      }
    }
  }

  revoke(token: string): boolean {
    return this.sessions.delete(token);
  }

  revokeAllForUser(userId: number): void {
    for (const [token, record] of this.sessions.entries()) {
      if (record.userId === userId) {
        this.sessions.delete(token);
      }
    }
  }
}
