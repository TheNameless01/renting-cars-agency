import { IPC_CHANNELS, type ElectronBridgeAPI, type IpcChannel, type IpcResult } from '../../electron/ipc/contracts.ts';
import { PREVIEW_ENDPOINTS } from '../../shared/api/previewContracts.ts';
import type {
  AuditLogEntry,
  AuthSession,
  PermissionCode,
  RoleCode,
} from '../../shared/types/domain.ts';

declare global {
  interface Window {
    electronAPI?: ElectronBridgeAPI;
  }
}

export interface AuthStatusResponse {
  needsBootstrap: boolean;
  runtimeMode: 'desktop' | 'preview';
}

export interface WilayaDto {
  code: string;
  nameFr: string;
  nameAr: string;
  isNewlyCreated2026: boolean;
  parentWilayaCode: string | null;
  decreeReference: string | null;
  effectiveYear: number;
  isActive: boolean;
  notes: string | null;
  updatedAt: string;
}

export interface UserWithPermissionsDto {
  id: number;
  username: string;
  fullName: string;
  roleId: number;
  roleCode: RoleCode;
  isActive: boolean;
  preferredLanguage: 'fr' | 'ar';
  preferredTheme: 'light' | 'dark';
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: PermissionCode[];
  permissionOverrides: Array<{ code: PermissionCode; granted: boolean }>;
}

export interface PermissionCatalogItem {
  id: number;
  code: PermissionCode;
  module: string;
  descriptionFr: string;
  descriptionAr: string;
}

/**
 * In-memory auth token only (never written to localStorage or sessionStorage).
 */
let memoryToken: string | null = null;

export function setInMemoryAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getInMemoryAuthToken(): string | null {
  return memoryToken;
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
}

async function callBackend<T>(
  ipcChannel: IpcChannel,
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH',
  httpUrl: string,
  payload?: unknown
): Promise<T> {
  if (typeof window !== 'undefined' && window.electronAPI) {
    const res: IpcResult<T> = await window.electronAPI.invoke(ipcChannel, {
      token: memoryToken,
      data: payload,
    });
    if (!res.ok) {
      const err = new Error(res.error?.message || 'Erreur IPC') as Error & { code?: string };
      err.code = res.error?.code;
      throw err;
    }
    return res.data as T;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  const response = await fetch(httpUrl, {
    method: httpMethod,
    headers,
    body: httpMethod !== 'GET' && payload !== undefined ? JSON.stringify(payload) : undefined,
  });

  const body = (await response.json()) as IpcResult<T>;
  if (!response.ok || !body.ok) {
    const err = new Error(body.error?.message || `HTTP ${response.status}`) as Error & { code?: string };
    err.code = body.error?.code;
    throw err;
  }
  return body.data as T;
}

export const erpClient = {
  getAuthStatus: () =>
    callBackend<AuthStatusResponse>(IPC_CHANNELS.AUTH_STATUS, 'GET', PREVIEW_ENDPOINTS.AUTH_STATUS),

  bootstrapAdmin: (payload: { username: string; fullName: string; password: string }) =>
    callBackend<AuthSession>(
      IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN,
      'POST',
      PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP,
      payload
    ),

  login: (payload: { username: string; password: string }) =>
    callBackend<AuthSession>(IPC_CHANNELS.AUTH_LOGIN, 'POST', PREVIEW_ENDPOINTS.AUTH_LOGIN, payload),

  me: () =>
    callBackend<AuthSession & { isLocked: boolean }>(
      IPC_CHANNELS.AUTH_ME,
      'GET',
      PREVIEW_ENDPOINTS.AUTH_ME
    ),

  lock: () =>
    callBackend<{ locked: boolean }>(IPC_CHANNELS.AUTH_LOCK, 'POST', PREVIEW_ENDPOINTS.AUTH_LOCK, {}),

  unlock: (password: string) =>
    callBackend<AuthSession>(IPC_CHANNELS.AUTH_UNLOCK, 'POST', PREVIEW_ENDPOINTS.AUTH_UNLOCK, {
      password,
    }),

  logout: () =>
    callBackend<{ loggedOut: boolean }>(
      IPC_CHANNELS.AUTH_LOGOUT,
      'POST',
      PREVIEW_ENDPOINTS.AUTH_LOGOUT,
      {}
    ),

  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    callBackend<{ changed: boolean }>(
      IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
      'POST',
      PREVIEW_ENDPOINTS.AUTH_CHANGE_PASSWORD,
      payload
    ),

  listUsers: () =>
    callBackend<UserWithPermissionsDto[]>(IPC_CHANNELS.USERS_LIST, 'GET', PREVIEW_ENDPOINTS.USERS),

  listPermissions: () =>
    callBackend<PermissionCatalogItem[]>(
      IPC_CHANNELS.USERS_PERMISSIONS,
      'GET',
      PREVIEW_ENDPOINTS.USERS_PERMISSIONS
    ),

  createUser: (payload: { username: string; fullName: string; password: string; roleCode: RoleCode }) =>
    callBackend<UserWithPermissionsDto>(
      IPC_CHANNELS.USERS_CREATE,
      'POST',
      PREVIEW_ENDPOINTS.USERS,
      payload
    ),

  updateUser: (payload: {
    userId: number;
    fullName?: string;
    roleCode?: RoleCode;
    isActive?: boolean;
    unlockAccount?: boolean;
    resetPassword?: string;
    permissionOverrides?: Array<{ code: PermissionCode; granted: boolean | null }>;
  }) =>
    callBackend<UserWithPermissionsDto>(
      IPC_CHANNELS.USERS_UPDATE,
      'PATCH',
      PREVIEW_ENDPOINTS.USERS,
      payload
    ),

  getAllSettings: () =>
    callBackend<Record<string, string>>(
      IPC_CHANNELS.SETTINGS_GET_ALL,
      'GET',
      PREVIEW_ENDPOINTS.SETTINGS
    ),

  updateSettingsBatch: (updates: Array<{ key: string; group: 'agency' | 'business' | 'documents' | 'app'; value: string }>) =>
    callBackend<Record<string, string>>(
      IPC_CHANNELS.SETTINGS_UPDATE_BATCH,
      'PUT',
      PREVIEW_ENDPOINTS.SETTINGS,
      { updates }
    ),

  listWilayas: (activeOnly = false) =>
    callBackend<WilayaDto[]>(
      IPC_CHANNELS.WILAYAS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.WILAYAS}?activeOnly=${activeOnly ? 'true' : 'false'}`,
      activeOnly ? { activeOnly: true } : undefined
    ),

  upsertWilaya: (payload: Omit<WilayaDto, 'updatedAt'>) =>
    callBackend<WilayaDto>(IPC_CHANNELS.WILAYAS_UPSERT, 'PUT', PREVIEW_ENDPOINTS.WILAYAS, payload),

  listAuditLogs: (limit = 100) =>
    callBackend<AuditLogEntry[]>(
      IPC_CHANNELS.AUDIT_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.AUDIT}?limit=${limit}`,
      { limit }
    ),
};
