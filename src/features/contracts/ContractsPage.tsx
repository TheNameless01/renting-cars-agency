import { FileText, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { Vehicle } from '../../../shared/types/domain.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type ContractListItemDto, type PricingRulesDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';

export function ContractsPage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [activeTab, setActiveTab] = useState<'contracts' | 'pricing'>('contracts');
  const [contracts, setContracts] = useState<ContractListItemDto[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRulesDto | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // New seasonal rate form
  const [seasonName, setSeasonName] = useState('');
  const [seasonCategory, setSeasonCategory] = useState('');
  const [seasonVehicleId, setSeasonVehicleId] = useState('');
  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [seasonDailyDzd, setSeasonDailyDzd] = useState('');
  const [seasonWeeklyDzd, setSeasonWeeklyDzd] = useState('');
  const [seasonMonthlyDzd, setSeasonMonthlyDzd] = useState('');
  const [confirmDeleteSeasonalId, setConfirmDeleteSeasonalId] = useState<number | null>(null);
  const [deletingSeasonal, setDeletingSeasonal] = useState(false);

  const canWrite = hasPermission('contracts:write');
  const canManageSettings = hasPermission('settings:manage');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cList, pRules, vList] = await Promise.all([
        erpClient.listContracts({ status: statusFilter, search: search || undefined }),
        erpClient.listPricingRules(),
        erpClient.listVehicles({ includeArchived: false }),
      ]);
      setContracts(cList);
      setPricingRules(pRules);
      setVehicles(vList);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, showError, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateSeasonal = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await erpClient.createSeasonalRate({
        name: seasonName.trim(),
        vehicleCategory: seasonCategory.trim() || null,
        vehicleId: seasonVehicleId ? Number(seasonVehicleId) : null,
        startDate: seasonStart,
        endDate: seasonEnd,
        dailyRateMinor: toMinorUnits(Number(seasonDailyDzd)),
        weeklyRateMinor: seasonWeeklyDzd ? toMinorUnits(Number(seasonWeeklyDzd)) : null,
        monthlyRateMinor: seasonMonthlyDzd ? toMinorUnits(Number(seasonMonthlyDzd)) : null,
      });
      showSuccess(seasonName.trim());
      setSeasonName('');
      setSeasonCategory('');
      setSeasonVehicleId('');
      setSeasonStart('');
      setSeasonEnd('');
      setSeasonDailyDzd('');
      setSeasonWeeklyDzd('');
      setSeasonMonthlyDzd('');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleDeleteSeasonal = async () => {
    if (confirmDeleteSeasonalId === null) return;
    setDeletingSeasonal(true);
    try {
      await erpClient.deleteSeasonalRate(confirmDeleteSeasonalId);
      showSuccess(t.common.delete);
      setConfirmDeleteSeasonalId(null);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setDeletingSeasonal(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t.contracts.title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.contracts.subtitle}</p>
        </div>
        {canWrite && (
          <Link
            to="/contracts/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{t.contracts.newContract}</span>
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('contracts')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 ${
            activeTab === 'contracts'
              ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300'
              : 'border-transparent text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.contracts.tabContracts}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pricing')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 ${
            activeTab === 'pricing'
              ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300'
              : 'border-transparent text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.contracts.tabPricingRules}
        </button>
      </div>

      {activeTab === 'contracts' ? (
        <>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.contracts.searchPlaceholder}
                className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="ALL">{t.contracts.filterAll}</option>
              <option value="DRAFT">{t.contracts.statuses.DRAFT}</option>
              <option value="CONFIRMED">{t.contracts.statuses.CONFIRMED}</option>
              <option value="ACTIVE">{t.contracts.statuses.ACTIVE}</option>
              <option value="EXTENDED">{t.contracts.statuses.EXTENDED}</option>
              <option value="COMPLETED">{t.contracts.statuses.COMPLETED}</option>
              <option value="CANCELLED">{t.contracts.statuses.CANCELLED}</option>
            </select>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.contracts.contractNumber}</th>
                    <th className="px-4 py-3 text-start">{t.nav.customers}</th>
                    <th className="px-4 py-3 text-start">{t.nav.vehicles}</th>
                    <th className="px-4 py-3 text-start">{t.contracts.expectedReturnDate}</th>
                    <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                    <th className="px-4 py-3 text-end">{t.contracts.totalContract}</th>
                    <th className="px-4 py-3 text-end">{t.contracts.remainingBalance}</th>
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
                  ) : contracts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                        <FileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
                        <div>—</div>
                      </td>
                    </tr>
                  ) : (
                    contracts.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-mono-tabular font-semibold text-xs">
                          {c.contractNumber}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{c.customerName}</div>
                          <div className="text-xs font-mono-tabular text-slate-500">{c.customerPhone}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">{c.vehicleLabel}</td>
                        <td className="px-4 py-3 font-mono-tabular text-xs">
                          <div>{formatDateTimeAlgiers(c.expectedReturnDate, lang, numerals)}</div>
                          {c.originalEndDate !== c.expectedReturnDate && (
                            <div className="text-[11px] text-amber-600 dark:text-amber-400">
                              init: {formatDateTimeAlgiers(c.originalEndDate, lang, numerals)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">
                          {t.contracts.statuses[c.status]}
                        </td>
                        <td className="px-4 py-3 text-end font-mono-tabular font-medium">
                          {formatCurrencyMinor(c.totalContractAmountMinor, c.currency, lang, numerals)}
                        </td>
                        <td className="px-4 py-3 text-end font-mono-tabular text-xs">
                          {formatCurrencyMinor(c.outstandingMinor, c.currency, lang, numerals)}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <Link
                            to={`/contracts/${c.id}`}
                            className="inline-flex items-center px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {t.common.view}
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                {t.contracts.pricingSection.seasonalTitle}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-start">{t.contracts.pricingSection.seasonName}</th>
                      <th className="px-4 py-3 text-start">{t.vehicles.category} / {t.nav.vehicles}</th>
                      <th className="px-4 py-3 text-start">{t.vehicles.blocks.startDate} → {t.vehicles.blocks.endDate}</th>
                      <th className="px-4 py-3 text-end">{t.vehicles.dailyRate}</th>
                      <th className="px-4 py-3 text-end">{t.users.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {!pricingRules || pricingRules.seasonalRates.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          {t.contracts.pricingSection.emptySeasonal}
                        </td>
                      </tr>
                    ) : (
                      pricingRules.seasonalRates.map((sr) => (
                        <tr key={sr.id}>
                          <td className="px-4 py-3 font-medium">{sr.name}</td>
                          <td className="px-4 py-3 text-xs">
                            {sr.vehicleLabel || sr.vehicleCategory || t.contracts.pricingSection.allCategories}
                          </td>
                          <td className="px-4 py-3 font-mono-tabular text-xs">
                            {formatDigits(sr.startDate, numerals)} → {formatDigits(sr.endDate, numerals)}
                          </td>
                          <td className="px-4 py-3 text-end font-mono-tabular font-medium">
                            {formatCurrencyMinor(sr.dailyRateMinor, 'DZD', lang, numerals)}
                          </td>
                          <td className="px-4 py-3 text-end">
                            {canManageSettings && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteSeasonalId(sr.id)}
                                className="p-1.5 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                title={t.common.delete}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                {t.contracts.pricingSection.customerRatesTitle}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-start">{t.nav.customers}</th>
                      <th className="px-4 py-3 text-start">{t.vehicles.category} / {t.nav.vehicles}</th>
                      <th className="px-4 py-3 text-end">{t.vehicles.dailyRate}</th>
                      <th className="px-4 py-3 text-end">{t.customers.customRates.defaultDiscount}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {!pricingRules || pricingRules.customerRates.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          {t.customers.customRates.empty}
                        </td>
                      </tr>
                    ) : (
                      pricingRules.customerRates.map((cr) => (
                        <tr key={cr.id}>
                          <td className="px-4 py-3 font-medium">
                            <Link to={`/customers/${cr.customerId}`} className="text-blue-700 dark:text-blue-400 hover:underline">
                              {cr.customerName}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {cr.vehicleLabel || cr.vehicleCategory || t.contracts.pricingSection.allCategories}
                          </td>
                          <td className="px-4 py-3 text-end font-mono-tabular">
                            {cr.dailyRateMinor != null ? formatCurrencyMinor(cr.dailyRateMinor, 'DZD', lang, numerals) : '—'}
                          </td>
                          <td className="px-4 py-3 text-end font-mono-tabular">
                            {formatDigits(cr.defaultDiscountPercent, numerals)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {canManageSettings && (
            <form
              onSubmit={handleCreateSeasonal}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 h-fit"
            >
              <h3 className="text-sm font-semibold">{t.contracts.pricingSection.addSeasonal}</h3>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.pricingSection.seasonName} *</label>
                <input
                  required
                  value={seasonName}
                  onChange={(e) => setSeasonName(e.target.value)}
                  placeholder="Haute Saison Été 2026"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.customRates.specificVehicle}</label>
                <select
                  value={seasonVehicleId}
                  onChange={(e) => setSeasonVehicleId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="">{t.contracts.pricingSection.allCategories}</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.brand} {v.model} ({v.matricule})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.customRates.vehicleCategory}</label>
                <input
                  value={seasonCategory}
                  onChange={(e) => setSeasonCategory(e.target.value)}
                  placeholder="Citadine, SUV / 4x4..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.startDate} *</label>
                  <input
                    type="date"
                    required
                    value={seasonStart}
                    onChange={(e) => setSeasonStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.endDate} *</label>
                  <input
                    type="date"
                    required
                    value={seasonEnd}
                    onChange={(e) => setSeasonEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.vehicles.dailyRate} *</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={seasonDailyDzd}
                  onChange={(e) => setSeasonDailyDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{t.vehicles.weeklyRate}</label>
                  <input
                    type="number"
                    min={0}
                    value={seasonWeeklyDzd}
                    onChange={(e) => setSeasonWeeklyDzd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{t.vehicles.monthlyRate}</label>
                  <input
                    type="number"
                    min={0}
                    value={seasonMonthlyDzd}
                    onChange={(e) => setSeasonMonthlyDzd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
              >
                {t.common.save}
              </button>
            </form>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteSeasonalId !== null}
        onClose={() => {
          if (!deletingSeasonal) setConfirmDeleteSeasonalId(null);
        }}
        onConfirm={handleDeleteSeasonal}
        tone="danger"
        loading={deletingSeasonal}
        title={t.dialogs.deleteSeasonalTitle}
        description={
          pricingRules?.seasonalRates.find((r) => r.id === confirmDeleteSeasonalId)?.name ?? ''
        }
        warningText={t.dialogs.deleteSeasonalDesc}
        confirmLabel={t.common.delete}
      />
    </div>
  );
}
