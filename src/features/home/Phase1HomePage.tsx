import { ArrowRight, Database, MapPin, Settings, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient } from '../../lib/apiClient.ts';
import { formatDigits } from '../../lib/formatters.ts';

export function Phase1HomePage() {
  const { session, runtimeMode, hasPermission } = useAuth();
  const { t, numerals } = useI18n();
  const [wilayaCount, setWilayaCount] = useState<number | null>(null);

  useEffect(() => {
    erpClient
      .listWilayas(true)
      .then((list) => setWilayaCount(list.length))
      .catch(() => setWilayaCount(null));
  }, []);

  if (!session) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t.home.title}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.home.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            <ShieldCheck className="w-4 h-4 text-blue-800 dark:text-blue-400" />
            <span>{t.home.activeSessionCard}</span>
          </div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {session.user.fullName}
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-2">
            <span>{t.home.roleLabel}: {session.user.roleCode}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">
              {formatDigits(session.permissions.length, numerals)} {t.home.permissionsLabel}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            <Database className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>{t.home.runtimeScopeCard}</span>
          </div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {runtimeMode === 'desktop' ? t.desktopBadge : t.previewBannerTitle}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {runtimeMode === 'desktop' ? t.home.isolationDesktop : t.home.isolationPreview}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            <MapPin className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>{t.home.wilayaRefCard}</span>
          </div>
          <div className="text-2xl font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
            {wilayaCount !== null ? formatDigits(wilayaCount, numerals) : '—'}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t.home.wilayasCountLabel}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t.home.nextPhaseCard}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            {t.home.nextPhaseDesc}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {hasPermission('users:manage') && (
            <Link
              to="/users"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{t.home.goToUsers}</span>
            </Link>
          )}
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 dark:hover:bg-blue-600"
          >
            <Settings className="w-4 h-4" />
            <span>{t.home.goToSettings}</span>
            <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </div>
  );
}
