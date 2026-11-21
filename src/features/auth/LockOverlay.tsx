import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';

export function LockOverlay() {
  const { session, unlock, logout } = useAuth();
  const { t, dir } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!session) return null;

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await unlock(password);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-label={t.auth.lockedTitle}
      className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
    >
      <div className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t.auth.lockedTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {session.user.fullName} ({session.user.username})
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">{t.auth.lockedSubtitle}</p>

        {error && (
          <div className="mb-3 p-2.5 rounded-md bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-3">
          <input
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.auth.password}
            dir="ltr"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
          />

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => void logout()}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.auth.switchAccountAction}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {submitting ? t.common.loading : t.auth.unlockAction}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
