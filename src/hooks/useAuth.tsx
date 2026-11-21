import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthSession, PermissionCode } from '../../shared/types/domain.ts';
import { erpClient, setInMemoryAuthToken } from '../lib/apiClient.ts';

interface AuthContextValue {
  loading: boolean;
  needsBootstrap: boolean;
  runtimeMode: 'desktop' | 'preview';
  session: AuthSession | null;
  isLocked: boolean;
  refreshStatus: () => Promise<void>;
  bootstrapAdmin: (input: { username: string; fullName: string; password: string }) => Promise<void>;
  login: (input: { username: string; password: string }) => Promise<void>;
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (code: PermissionCode) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<'desktop' | 'preview'>('preview');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await erpClient.getAuthStatus();
      setNeedsBootstrap(status.needsBootstrap);
      setRuntimeMode(status.runtimeMode);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const bootstrapAdmin = useCallback(
    async (input: { username: string; fullName: string; password: string }) => {
      const nextSession = await erpClient.bootstrapAdmin(input);
      setInMemoryAuthToken(nextSession.token);
      setSession(nextSession);
      setNeedsBootstrap(false);
      setIsLocked(false);
    },
    []
  );

  const login = useCallback(async (input: { username: string; password: string }) => {
    const nextSession = await erpClient.login(input);
    setInMemoryAuthToken(nextSession.token);
    setSession(nextSession);
    setNeedsBootstrap(false);
    setIsLocked(false);
  }, []);

  const lock = useCallback(async () => {
    if (!session) return;
    await erpClient.lock();
    setIsLocked(true);
  }, [session]);

  const unlock = useCallback(async (password: string) => {
    const refreshed = await erpClient.unlock(password);
    setInMemoryAuthToken(refreshed.token);
    setSession(refreshed);
    setIsLocked(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await erpClient.logout();
    } finally {
      setInMemoryAuthToken(null);
      setSession(null);
      setIsLocked(false);
      await refreshStatus();
    }
  }, [refreshStatus]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' && session && !isLocked) {
        e.preventDefault();
        void lock();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, isLocked, lock]);

  const hasPermission = useCallback(
    (code: PermissionCode) => {
      if (!session) return false;
      return session.permissions.includes(code);
    },
    [session]
  );

  return (
    <AuthContext.Provider
      value={{
        loading,
        needsBootstrap,
        runtimeMode,
        session,
        isLocked,
        refreshStatus,
        bootstrapAdmin,
        login,
        lock,
        unlock,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
