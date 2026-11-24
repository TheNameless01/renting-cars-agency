import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthSession, PermissionCode } from '../../shared/types/domain.ts';
import { erpClient, setInMemoryAuthToken, setOnSessionLockedHandler } from '../lib/apiClient.ts';

interface AuthContextValue {
  loading: boolean;
  needsBootstrap: boolean;
  runtimeMode: 'desktop' | 'preview';
  session: AuthSession | null;
  isLocked: boolean;
  autoLockMinutes: number;
  setAutoLockMinutes: (minutes: number) => void;
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
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(15);
  const lastActivityRef = useRef<number>(Date.now());

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

  useEffect(() => {
    setOnSessionLockedHandler(() => {
      setIsLocked(true);
    });
    return () => setOnSessionLockedHandler(null);
  }, []);

  const loadAutoLockSetting = useCallback(async () => {
    try {
      const settings = await erpClient.getAllSettings();
      const raw = Number(settings['app.auto_lock_minutes'] ?? '15');
      if (Number.isFinite(raw) && raw >= 0) {
        setAutoLockMinutes(raw);
      }
    } catch {
      // Keep default 15 minutes
    }
  }, []);

  const bootstrapAdmin = useCallback(
    async (input: { username: string; fullName: string; password: string }) => {
      const nextSession = await erpClient.bootstrapAdmin(input);
      setInMemoryAuthToken(nextSession.token);
      setSession(nextSession);
      setNeedsBootstrap(false);
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      void loadAutoLockSetting();
    },
    [loadAutoLockSetting]
  );

  const login = useCallback(
    async (input: { username: string; password: string }) => {
      const nextSession = await erpClient.login(input);
      setInMemoryAuthToken(nextSession.token);
      setSession(nextSession);
      setNeedsBootstrap(false);
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      void loadAutoLockSetting();
    },
    [loadAutoLockSetting]
  );

  const lock = useCallback(async () => {
    if (!session) return;
    try {
      await erpClient.lock();
    } catch {
      // Even if session was already auto-locked on backend, show lock overlay cleanly
    }
    setIsLocked(true);
  }, [session]);

  const unlock = useCallback(
    async (password: string) => {
      try {
        const refreshed = await erpClient.unlock(password);
        setInMemoryAuthToken(refreshed.token);
        setSession(refreshed);
        setIsLocked(false);
        lastActivityRef.current = Date.now();
      } catch (err) {
        const code = (err as Error & { code?: string }).code;
        if (code === 'LOCKED') {
          // Account temporarily locked after repeated failures -> return cleanly to login screen
          setInMemoryAuthToken(null);
          setSession(null);
          setIsLocked(false);
        }
        throw err;
      }
    },
    []
  );

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

  // Client-side inactivity auto-lock watchdog synced with backend `app.auto_lock_minutes`
  useEffect(() => {
    if (!session || isLocked || autoLockMinutes <= 0) return;
    lastActivityRef.current = Date.now();

    let lastRecorded = 0;
    const recordActivity = () => {
      const now = Date.now();
      if (now - lastRecorded > 4000) {
        lastActivityRef.current = now;
        lastRecorded = now;
      }
    };

    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
    ];
    for (const ev of events) {
      window.addEventListener(ev, recordActivity, { passive: true });
    }

    const interval = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= autoLockMinutes * 60_000) {
        void lock();
      }
    }, 15_000);

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, recordActivity);
      }
      window.clearInterval(interval);
    };
  }, [session, isLocked, autoLockMinutes, lock]);

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
        autoLockMinutes,
        setAutoLockMinutes,
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
