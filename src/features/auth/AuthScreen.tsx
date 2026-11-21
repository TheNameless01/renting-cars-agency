import { Languages, LockKeyhole, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { useTheme } from '../../hooks/useTheme.tsx';

export function AuthScreen() {
  const { needsBootstrap, runtimeMode, bootstrapAdmin, login } = useAuth();
  const { t, lang, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (needsBootstrap) {
      if (password !== confirmPassword) {
        setError(t.auth.passwordMismatch);
        return;
      }
      if (password.length < 8) {
        setError(t.auth.minPasswordHint);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (needsBootstrap) {
        await bootstrapAdmin({ username, fullName, password });
      } else {
        await login({ username, password });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="h-16 px-6 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="font-bold text-sm tracking-tight">{t.appName}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{lang === 'fr' ? t.topbar.switchToArabic : t.topbar.switchToFrench}</span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            <span>{theme === 'light' ? t.topbar.darkTheme : t.topbar.lightTheme}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-900 dark:bg-blue-700 text-white flex items-center justify-center shrink-0">
              {needsBootstrap ? <ShieldCheck className="w-5 h-5" /> : <LockKeyhole className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-snug">
                {needsBootstrap ? t.auth.bootstrapTitle : t.auth.loginTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {runtimeMode === 'preview' ? t.previewBannerTitle : t.desktopBadge}
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
            {needsBootstrap ? t.auth.bootstrapSubtitle : t.auth.loginSubtitle}
          </p>

          {runtimeMode === 'preview' && (
            <div className="mb-5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
              {t.previewBannerDesc}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-5 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t.auth.username}
              </label>
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                dir="ltr"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                placeholder="admin"
              />
            </div>

            {needsBootstrap && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.auth.fullName}
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t.auth.password}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
              {needsBootstrap && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {t.auth.minPasswordHint}
                </p>
              )}
            </div>

            {needsBootstrap && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.auth.confirmPassword}
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  dir="ltr"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting
                ? t.common.loading
                : needsBootstrap
                  ? t.auth.createAdminAction
                  : t.auth.signInAction}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
