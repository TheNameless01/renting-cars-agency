import { BookOpen, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type CustomerAccountDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';
import { CustomerLedgerModal } from './CustomerLedgerModal.tsx';

export function CustomerAccountsTab() {
  const { t, lang, numerals } = useI18n();
  const { showError } = useToast();

  const [accounts, setAccounts] = useState<CustomerAccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'WITH_BALANCE' | 'OVERDUE'>('ALL');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await erpClient.listCustomerAccounts({
        search: search.trim() || undefined,
        onlyWithBalance: filterMode === 'WITH_BALANCE',
        onlyOverdue: filterMode === 'OVERDUE',
      });
      setAccounts(rows);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [filterMode, search, showError, t.common.error]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const totalOutstanding = accounts.reduce((acc, a) => acc + a.outstandingBalanceMinor, 0);
  const totalOverdue = accounts.reduce((acc, a) => acc + a.overdueDebtMinor, 0);
  const totalHeldDeposits = accounts.reduce((acc, a) => acc + a.heldDepositsMinor, 0);

  return (
    <div className="space-y-4">
      {/* Portfolio Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.customers.outstanding}</div>
          <div className="text-xl font-bold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
            {formatCurrencyMinor(totalOutstanding, 'DZD', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.accounts.overdueDebt}</div>
          <div className="text-xl font-bold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
            {formatCurrencyMinor(totalOverdue, 'DZD', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.accounts.heldDepositsLiability}</div>
          <div className="text-xl font-bold font-mono-tabular text-slate-800 dark:text-slate-200 mt-1">
            {formatCurrencyMinor(totalHeldDeposits, 'DZD', lang, numerals)}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.customers.searchPlaceholder}
            className="w-full ps-8 pe-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(
            [
              ['ALL', t.finance.accounts.filterAll],
              ['WITH_BALANCE', t.finance.accounts.filterWithBalance],
              ['OVERDUE', t.finance.accounts.filterOverdue],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filterMode === mode
                  ? 'border-blue-900 bg-blue-900 text-white dark:border-blue-600 dark:bg-blue-700'
                  : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start">{t.nav.customers}</th>
                <th className="px-4 py-3 text-end">{t.customers.totalRentals}</th>
                <th className="px-4 py-3 text-end">{t.customers.totalCharged}</th>
                <th className="px-4 py-3 text-end">{t.customers.totalPaid}</th>
                <th className="px-4 py-3 text-end">{t.customers.outstanding}</th>
                <th className="px-4 py-3 text-end">{t.finance.accounts.overdueDebt}</th>
                <th className="px-4 py-3 text-end">{t.finance.accounts.heldDepositsLiability}</th>
                <th className="px-4 py-3 text-end">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {t.common.loading}
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {t.finance.accounts.empty}
                  </td>
                </tr>
              ) : (
                accounts.map((a) => (
                  <tr key={a.customerId}>
                    <td className="px-4 py-3">
                      <Link
                        to={`/customers/${a.customerId}`}
                        className="font-semibold text-slate-900 dark:text-slate-100 hover:underline"
                      >
                        {a.companyName ? `${a.companyName} · ${a.fullName}` : a.fullName}
                      </Link>
                      <div className="text-[11px] font-mono-tabular text-slate-500">
                        {formatDigits(a.phone, numerals)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular">
                      {formatDigits(a.totalRentals, numerals)}
                      {a.overdueContractsCount > 0 && (
                        <div className="text-[10px] text-rose-600 dark:text-rose-400 font-sans font-semibold">
                          {formatDigits(a.overdueContractsCount, numerals)} {t.finance.accounts.overdueContracts}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular">
                      {formatCurrencyMinor(a.totalChargedMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular text-emerald-700 dark:text-emerald-400">
                      {formatCurrencyMinor(a.netPaidMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular font-semibold text-amber-700 dark:text-amber-400">
                      {formatCurrencyMinor(a.outstandingBalanceMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular font-semibold text-rose-700 dark:text-rose-400">
                      {formatCurrencyMinor(a.overdueDebtMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular">
                      {formatCurrencyMinor(a.heldDepositsMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomerId(a.customerId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>{t.finance.accounts.openLedger}</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CustomerLedgerModal
        customerId={selectedCustomerId}
        onClose={() => setSelectedCustomerId(null)}
        onUpdated={loadAccounts}
      />
    </div>
  );
}
