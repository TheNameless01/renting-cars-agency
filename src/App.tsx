import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { AppLanguage, AppTheme, NumeralSystem } from '../shared/types/domain.ts';
import { ToastProvider } from './components/Toast.tsx';
import { AuthScreen } from './features/auth/AuthScreen.tsx';
import { LockOverlay } from './features/auth/LockOverlay.tsx';
import { Phase1HomePage } from './features/home/Phase1HomePage.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { UsersPage } from './features/users/UsersPage.tsx';
import { AuthProvider, useAuth } from './hooks/useAuth.tsx';
import { I18nProvider, useI18n } from './hooks/useI18n.tsx';
import { ThemeProvider, useTheme } from './hooks/useTheme.tsx';
import { ErpLayout } from './layouts/ErpLayout.tsx';
import { erpClient } from './lib/apiClient.ts';

function AppContent() {
  const { loading, session, isLocked } = useAuth();
  const { t, setLang, setNumerals } = useI18n();
  const { setTheme } = useTheme();

  useEffect(() => {
    if (!session) return;
    erpClient
      .getAllSettings()
      .then((s) => {
        if (s['app.default_language'] === 'fr' || s['app.default_language'] === 'ar') {
          setLang(s['app.default_language'] as AppLanguage);
        }
        if (s['app.default_theme'] === 'light' || s['app.default_theme'] === 'dark') {
          setTheme(s['app.default_theme'] as AppTheme);
        }
        if (s['app.numeral_system'] === 'latin' || s['app.numeral_system'] === 'arabic') {
          setNumerals(s['app.numeral_system'] as NumeralSystem);
        }
      })
      .catch(() => {
        // Non-blocking fallback to current local preference
      });
  }, [session, setLang, setTheme, setNumerals]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-600 dark:text-slate-400">
        {t.common.loading}
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <>
      <ErpLayout>
        <Routes>
          <Route path="/" element={<Phase1HomePage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErpLayout>
      {isLocked && <LockOverlay />}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
