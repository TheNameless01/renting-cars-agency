import { Download, FileSpreadsheet, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PaymentMethod } from '../../../shared/types/domain.ts';
import { useToast } from '../../components/Toast.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type FinancialDashboardReportDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';
import { downloadCsvFile, exportFinancialReportPdf } from '../../lib/pdfExport.ts';

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return {
    dateFrom: `${y}-${m}-01`,
    dateTo: `${y}-${m}-${d}`,
  };
}

export function FinanceDashboardTab() {
  const { t, lang, numerals } = useI18n();
  const { showError, showSuccess } = useToast();

  const initial = getMonthRange();
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [seriesMode, setSeriesMode] = useState<'monthly' | 'daily'>('monthly');

  const [report, setReport] = useState<FinancialDashboardReportDto | null>(null);
  const [agencySettings, setAgencySettings] = useState<{
    name?: string;
    nif?: string;
    rc?: string;
    phone?: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [exportingCsv, setExportingCsv] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const [rep, settings] = await Promise.all([
        erpClient.getFinancialDashboardReports({ dateFrom, dateTo }),
        erpClient.getAllSettings().catch(() => ({}) as Record<string, string>),
      ]);
      setReport(rep);
      setAgencySettings({
        name: settings['agency.name'] || settings['agency.commercial_name'],
        nif: settings['agency.nif'],
        rc: settings['agency.rc'],
        phone: settings['agency.phone'],
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, showError, t.common.error]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const applyPreset = (preset: 'month' | '30days' | 'ytd') => {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    if (preset === 'month') {
      const r = getMonthRange();
      setDateFrom(r.dateFrom);
      setDateTo(r.dateTo);
    } else if (preset === '30days') {
      const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setDateFrom(from);
      setDateTo(to);
    } else {
      setDateFrom(`${now.getFullYear()}-01-01`);
      setDateTo(to);
    }
  };

  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      const res = await erpClient.exportFinancialCsv({ dateFrom, dateTo, lang });
      downloadCsvFile(res.fileName, res.csvContent);
      showSuccess(res.fileName);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setExportingCsv(false);
    }
  };

  const handleExportPdf = () => {
    if (!report) return;
    exportFinancialReportPdf(report, agencySettings, lang, numerals);
  };

  if (loading && !report) {
    return <div className="py-12 text-center text-sm text-slate-500">{t.common.loading}</div>;
  }

  if (!report) {
    return null;
  }

  const s = report.summary;
  const cashPositionMinor = s.openCashSessionBalanceMinor ?? s.lastClosedCashBalanceMinor;
  const seriesRows = seriesMode === 'monthly' ? report.monthlyRevenue : report.dailyRevenue;

  return (
    <div className="space-y-6">
      {/* Period Selector & Export Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => applyPreset('month')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.finance.reports.presetThisMonth}
          </button>
          <button
            type="button"
            onClick={() => applyPreset('30days')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.finance.reports.presetLast30Days}
          </button>
          <button
            type="button"
            onClick={() => applyPreset('ytd')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.finance.reports.presetYearToDate}
          </button>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">{t.finance.reports.dateFrom}</span>
            <input
              type="date"
              dir="ltr"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
            />
            <span className="text-slate-500">{t.finance.reports.dateTo}</span>
            <input
              type="date"
              dir="ltr"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={exportingCsv}
            onClick={() => void handleExportCsv()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{t.finance.reports.exportCsv}</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t.finance.reports.exportPdf}</span>
          </button>
        </div>
      </div>

      {/* 8 KPI Cards (Flat, clean grid, deposits explicitly marked Liability) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.reports.rentalRevenue}</div>
          <div className="text-xl font-bold font-mono-tabular text-blue-900 dark:text-blue-300 mt-1">
            {formatCurrencyMinor(s.rentalRevenueMinor, 'DZD', lang, numerals)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {formatDigits(s.contractCount, numerals)} {t.contracts.tabContracts.toLowerCase()}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.reports.netCollected}</div>
          <div className="text-xl font-bold font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
            {formatCurrencyMinor(s.collectedNetMinor, 'DZD', lang, numerals)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
            +{formatCurrencyMinor(s.paymentInflowsMinor, 'DZD', lang, numerals)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.reports.totalExpenses}</div>
          <div className="text-xl font-bold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
            {formatCurrencyMinor(s.expensesMinor, 'DZD', lang, numerals)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
            {formatCurrencyMinor(s.vehicleExpensesMinor, 'DZD', lang, numerals)} /{' '}
            {formatCurrencyMinor(s.agencyExpensesMinor, 'DZD', lang, numerals)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.reports.netOperatingResult}</div>
          <div
            className={`text-xl font-bold font-mono-tabular mt-1 ${
              s.netOperatingIncomeMinor >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-700 dark:text-rose-400'
            }`}
          >
            {formatCurrencyMinor(s.netOperatingIncomeMinor, 'DZD', lang, numerals)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.reports.portfolioOutstanding}</div>
          <div className="text-xl font-bold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
            {formatCurrencyMinor(s.portfolioOutstandingMinor, 'DZD', lang, numerals)}
          </div>
          <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 font-mono-tabular">
            {t.finance.accounts.overdueDebt}: {formatCurrencyMinor(s.portfolioOverdueMinor, 'DZD', lang, numerals)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.reports.depositsHeldLiability}</div>
          <div className="text-xl font-bold font-mono-tabular mt-1">
            {formatCurrencyMinor(s.depositsCurrentlyHeldDzdMinor, 'DZD', lang, numerals)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
            {s.depositsCurrentlyHeldEurMinor > 0
              ? formatCurrencyMinor(s.depositsCurrentlyHeldEurMinor, 'EUR', lang, numerals)
              : `${formatDigits(s.depositsHeldCount, numerals)} ${t.finance.depositStatuses.HELD}`}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.reports.refundsPeriod}</div>
          <div className="text-xl font-bold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
            {formatCurrencyMinor(s.totalRefundsMinor, 'DZD', lang, numerals)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
            {t.finance.tabs.deposits}: {formatCurrencyMinor(s.periodDepositsRefundedMinor, 'DZD', lang, numerals)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.reports.cashPosition}</div>
          <div className="text-xl font-bold font-mono-tabular mt-1">
            {formatCurrencyMinor(cashPositionMinor, 'DZD', lang, numerals)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {s.openCashSessionDate
              ? `${t.finance.cash.activeSessionBadge} (${formatDigits(s.openCashSessionDate, numerals)})`
              : t.finance.cash.noOpenSession}
          </div>
        </div>
      </div>

      {/* Breakdowns: Collected By Method & Expenses By Category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
            {t.finance.reports.collectedByMethodTitle}
          </div>
          <div className="p-4 space-y-2.5 text-xs">
            {(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER'] as PaymentMethod[]).map((method) => {
              const amount = report.collectedByMethod[method] ?? 0;
              const pct = s.collectedNetMinor > 0 ? Math.max(0, Math.min(100, (amount / s.collectedNetMinor) * 100)) : 0;
              return (
                <div key={method} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.finance.methods[method]}</span>
                    <span className="font-mono-tabular font-semibold">
                      {formatCurrencyMinor(amount, 'DZD', lang, numerals)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-blue-900 dark:bg-blue-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
            {t.finance.reports.expensesByCategoryTitle}
          </div>
          <div className="p-4 space-y-2.5 text-xs">
            {report.expensesByCategory.length === 0 ? (
              <div className="py-6 text-center text-slate-500">{t.finance.expenses.emptyExpenses}</div>
            ) : (
              report.expensesByCategory.map((item) => {
                const pct = s.expensesMinor > 0 ? Math.min(100, (item.totalMinor / s.expensesMinor) * 100) : 0;
                return (
                  <div key={item.category} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{t.finance.expenseCategories[item.category]}</span>
                      <span className="font-mono-tabular font-semibold text-rose-700 dark:text-rose-400">
                        {formatCurrencyMinor(item.totalMinor, 'DZD', lang, numerals)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-rose-600 dark:bg-rose-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Daily / Monthly Revenue Evolution */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">{t.finance.reports.dailyMonthlyTitle}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSeriesMode('monthly')}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                seriesMode === 'monthly'
                  ? 'bg-blue-900 text-white dark:bg-blue-700'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {t.finance.reports.viewMonthly}
            </button>
            <button
              type="button"
              onClick={() => setSeriesMode('daily')}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                seriesMode === 'daily'
                  ? 'bg-blue-900 text-white dark:bg-blue-700'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {t.finance.reports.viewDaily}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-start">{t.settings.audit.timestamp}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.rentalRevenue}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.netCollected}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.totalExpenses}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {seriesRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    —
                  </td>
                </tr>
              ) : (
                seriesRows.map((row) => {
                  const label = 'month' in row ? row.month : row.date;
                  return (
                    <tr key={label}>
                      <td className="px-4 py-2.5 font-mono-tabular font-medium">
                        {formatDigits(label, numerals)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono-tabular font-semibold">
                        {formatCurrencyMinor(row.totalRevenueMinor, 'DZD', lang, numerals)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono-tabular text-emerald-700 dark:text-emerald-400">
                        {formatCurrencyMinor(row.collectedMinor, 'DZD', lang, numerals)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono-tabular text-rose-700 dark:text-rose-400">
                        {formatCurrencyMinor(row.expensesMinor, 'DZD', lang, numerals)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vehicle Rental Profitability & ROI */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs font-semibold">
          <TrendingUp className="w-4 h-4 text-blue-700 dark:text-blue-400" />
          <span>{t.finance.reports.vehicleProfitabilityTitle}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-start">{t.nav.vehicles}</th>
                <th className="px-4 py-2.5 text-end">{t.contracts.tabContracts}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.rentedDays}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.vehicleRevenue}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.netCollected}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.vehicleExpenses}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.netProfit}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.reports.roi}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {report.vehicleProfitability.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {t.vehicles.empty}
                  </td>
                </tr>
              ) : (
                report.vehicleProfitability.map((vp) => (
                  <tr key={vp.vehicleId}>
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/vehicles/${vp.vehicleId}`}
                        className="font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        {vp.brand} {vp.model}
                      </Link>
                      <div className="text-[11px] font-mono-tabular text-slate-500">
                        {formatDigits(vp.matricule, numerals)} · {vp.category}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular">
                      {formatDigits(vp.contractCount, numerals)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular">
                      {formatDigits(vp.rentedDays, numerals)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular font-medium">
                      {formatCurrencyMinor(vp.rentalRevenueMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular text-emerald-700 dark:text-emerald-400">
                      {formatCurrencyMinor(vp.collectedMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular text-rose-700 dark:text-rose-400">
                      {formatCurrencyMinor(vp.expensesMinor, 'DZD', lang, numerals)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-end font-mono-tabular font-bold ${
                        vp.netProfitMinor >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {formatCurrencyMinor(vp.netProfitMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular">
                      {vp.roiPercent != null ? `${formatDigits(vp.roiPercent.toFixed(1), numerals)}%` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
