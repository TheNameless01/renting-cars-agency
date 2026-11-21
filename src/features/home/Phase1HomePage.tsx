import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Car,
  Database,
  FileText,
  MapPin,
  Settings,
  ShieldCheck,
  Users,
  Vault,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';

interface LiveOperationalSummary {
  wilayas: number;
  vehiclesTotal: number;
  vehiclesAvailable: number;
  customersTotal: number;
  contractsActive: number;
  reservationsOpen: number;
  cashBalanceMinor: number | null;
  cashSessionOpen: boolean;
  heldDepositsDzdMinor: number | null;
  monthCollectedNetMinor: number | null;
}

export function Phase1HomePage() {
  const { session, runtimeMode, hasPermission } = useAuth();
  const { t, lang, numerals } = useI18n();
  const [summary, setSummary] = useState<LiveOperationalSummary | null>(null);

  const canViewFinanceReport = hasPermission('finance:read') || hasPermission('reports:view');
  const canViewCash = hasPermission('finance:cash_register') || hasPermission('finance:read');

  useEffect(() => {
    const now = new Date();
    const dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const dateTo = now.toISOString().slice(0, 10);

    Promise.all([
      erpClient.listWilayas(true),
      erpClient.listVehicles({ includeArchived: false }),
      erpClient.listCustomers({ includeArchived: false }),
      erpClient.listContracts(),
      erpClient.listReservations(),
      canViewFinanceReport
        ? erpClient.getFinancialDashboardReports({ dateFrom, dateTo }).catch(() => null)
        : Promise.resolve(null),
      canViewCash
        ? erpClient.getCurrentCashSession().catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([wilayas, vehicles, customers, contracts, reservations, finReport, cashCurrent]) => {
        const cashBalanceMinor = cashCurrent?.session
          ? cashCurrent.session.expectedClosingMinor
          : finReport
            ? (finReport.summary.openCashSessionBalanceMinor ?? finReport.summary.lastClosedCashBalanceMinor)
            : cashCurrent
              ? cashCurrent.suggestedOpeningBalanceMinor
              : null;

        setSummary({
          wilayas: wilayas.length,
          vehiclesTotal: vehicles.length,
          vehiclesAvailable: vehicles.filter((v) => v.status === 'AVAILABLE').length,
          customersTotal: customers.length,
          contractsActive: contracts.filter((c) => c.status === 'ACTIVE' || c.status === 'EXTENDED').length,
          reservationsOpen: reservations.filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED').length,
          cashBalanceMinor,
          cashSessionOpen: Boolean(cashCurrent?.session || finReport?.summary.openCashSessionDate),
          heldDepositsDzdMinor: finReport ? finReport.summary.depositsCurrentlyHeldDzdMinor : null,
          monthCollectedNetMinor: finReport ? finReport.summary.collectedNetMinor : null,
        });
      })
      .catch(() => setSummary(null));
  }, [canViewCash, canViewFinanceReport]);

  if (!session) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t.home.title}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.home.subtitle}</p>
      </div>

      {/* Real Operational Counts from SQLite */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          to="/vehicles"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-400 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            <Car className="w-4 h-4 text-blue-800 dark:text-blue-400" />
            <span>{t.nav.vehicles}</span>
          </div>
          <div className="text-2xl font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
            {summary ? formatDigits(summary.vehiclesTotal, numerals) : '—'}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {summary
              ? `${formatDigits(summary.vehiclesAvailable, numerals)} ${t.vehicles.statuses.AVAILABLE}`
              : t.common.loading}
          </p>
        </Link>

        <Link
          to="/customers"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-400 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            <Users className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>{t.nav.customers}</span>
          </div>
          <div className="text-2xl font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
            {summary ? formatDigits(summary.customersTotal, numerals) : '—'}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t.customers.subtitle.slice(0, 48)}</p>
        </Link>

        <Link
          to="/planning"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-400 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            <CalendarDays className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>{t.planning.reservationsList}</span>
          </div>
          <div className="text-2xl font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
            {summary ? formatDigits(summary.reservationsOpen, numerals) : '—'}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {t.planning.reservationStatus.PENDING} / {t.planning.reservationStatus.CONFIRMED}
          </p>
        </Link>

        <Link
          to="/contracts"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-400 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            <FileText className="w-4 h-4 text-indigo-700 dark:text-indigo-400" />
            <span>{t.contracts.tabContracts}</span>
          </div>
          <div className="text-2xl font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
            {summary ? formatDigits(summary.contractsActive, numerals) : '—'}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {t.contracts.statuses.ACTIVE} / {t.contracts.statuses.EXTENDED}
          </p>
        </Link>
      </div>

      {/* Live Financial Quick Access (shown according to RBAC permissions) */}
      {(canViewCash || canViewFinanceReport) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {canViewCash && (
            <Link
              to="/finance"
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-400 dark:hover:border-blue-700 transition-colors"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                <Vault className="w-4 h-4 text-blue-800 dark:text-blue-400" />
                <span>{t.finance.reports.cashPosition}</span>
              </div>
              <div className="text-xl font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
                {summary && summary.cashBalanceMinor != null
                  ? formatCurrencyMinor(summary.cashBalanceMinor, 'DZD', lang, numerals)
                  : '—'}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {summary?.cashSessionOpen
                  ? t.finance.cash.activeSessionBadge
                  : t.finance.cash.noOpenSession}
              </p>
            </Link>
          )}

          {canViewFinanceReport && (
            <>
              <Link
                to="/finance"
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-400 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  <Wallet className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span>{t.finance.reports.depositsHeldLiability}</span>
                </div>
                <div className="text-xl font-semibold font-mono-tabular text-amber-700 dark:text-amber-400">
                  {summary && summary.heldDepositsDzdMinor != null
                    ? formatCurrencyMinor(summary.heldDepositsDzdMinor, 'DZD', lang, numerals)
                    : '—'}
                </div>
                <p className="text-xs text-slate-500 mt-1">{t.finance.tabs.deposits}</p>
              </Link>

              <Link
                to="/reports"
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-400 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  <BarChart3 className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>{t.finance.reports.netCollected}</span>
                </div>
                <div className="text-xl font-semibold font-mono-tabular text-emerald-700 dark:text-emerald-400">
                  {summary && summary.monthCollectedNetMinor != null
                    ? formatCurrencyMinor(summary.monthCollectedNetMinor, 'DZD', lang, numerals)
                    : '—'}
                </div>
                <p className="text-xs text-slate-500 mt-1">{t.finance.reports.presetThisMonth}</p>
              </Link>
            </>
          )}
        </div>
      )}

      {/* System & Security Cards */}
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
            {summary ? formatDigits(summary.wilayas, numerals) : '—'}
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
