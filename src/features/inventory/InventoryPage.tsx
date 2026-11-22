import {
  AlertTriangle,
  Archive,
  ArrowDownUp,
  Building2,
  Edit3,
  History,
  Package,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { InventoryMovementType, Supplier, Vehicle } from '../../../shared/types/domain.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type InventoryMovementListItemDto,
  type InventoryOverviewDto,
  type InventoryPartDetailDto,
  type InventoryPartListItemDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';
import { InventoryMovementModal } from './InventoryMovementModal.tsx';
import { InventoryPartModal } from './InventoryPartModal.tsx';
import { SupplierModal } from './SupplierModal.tsx';

type InventoryTab = 'catalog' | 'movements' | 'suppliers';

export function InventoryPage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const canManageParts = hasPermission('inventory:manage_parts') || hasPermission('inventory:write');
  const canRecordMovements = hasPermission('inventory:record_movements') || hasPermission('inventory:write');
  const canAdjustStock = hasPermission('inventory:adjust_stock');
  const canManageSuppliers =
    hasPermission('inventory:manage_suppliers') ||
    hasPermission('finance:manage_expenses') ||
    hasPermission('inventory:write');

  const [activeTab, setActiveTab] = useState<InventoryTab>('catalog');
  const [loading, setLoading] = useState(true);

  const [overview, setOverview] = useState<InventoryOverviewDto | null>(null);
  const [parts, setParts] = useState<InventoryPartListItemDto[]>([]);
  const [movements, setMovements] = useState<InventoryMovementListItemDto[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  // Catalog filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [stockState, setStockState] = useState<'ALL' | 'LOW' | 'OUT' | 'IN_STOCK'>('ALL');
  const [includeArchived, setIncludeArchived] = useState(false);

  // Movement filters
  const [movTypeFilter, setMovTypeFilter] = useState<InventoryMovementType | 'ALL'>('ALL');
  const [movSearch, setMovSearch] = useState('');

  // Modals
  const [showPartModal, setShowPartModal] = useState(false);
  const [editingPart, setEditingPart] = useState<InventoryPartListItemDto | null>(null);

  const [movementModalMode, setMovementModalMode] = useState<'MOVEMENT' | 'ADJUST' | null>(null);
  const [movementDefaultPartId, setMovementDefaultPartId] = useState<number | null>(null);

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [partDetail, setPartDetail] = useState<InventoryPartDetailDto | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<InventoryPartListItemDto | null>(null);
  const [archiving, setArchiving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, partRows, movRows, supRows, vehRows] = await Promise.all([
        erpClient.getInventoryOverview(),
        erpClient.listInventoryParts({
          category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
          stockState,
          includeArchived,
          search: search.trim() || undefined,
        }),
        erpClient.listInventoryMovements({
          movementType: movTypeFilter,
          search: movSearch.trim() || undefined,
          limit: 200,
        }),
        erpClient.listSuppliers(includeArchived).catch(() => []),
        erpClient.listVehicles({ includeArchived: false }).catch(() => []),
      ]);
      setOverview(ov);
      setParts(partRows);
      setMovements(movRows);
      setSuppliers(supRows);
      setVehicles(vehRows);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, includeArchived, movSearch, movTypeFilter, search, showError, stockState, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openPartHistory = async (partId: number) => {
    try {
      const det = await erpClient.getInventoryPartDetail(partId);
      setPartDetail(det);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await erpClient.archiveInventoryPart(archiveTarget.id, !archiveTarget.isArchived);
      showSuccess(t.common.save);
      setArchiveTarget(null);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setArchiving(false);
    }
  };

  const stockBadge = (status: InventoryPartListItemDto['stockStatus']) => {
    if (status === 'OUT_OF_STOCK') {
      return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-900';
    }
    if (status === 'LOW_STOCK') {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-900';
    }
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900';
  };

  const categories = overview?.categories ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-900 dark:text-blue-400" />
            <span>{t.inventory.title}</span>
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.inventory.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canRecordMovements && (
            <button
              type="button"
              onClick={() => {
                setMovementDefaultPartId(null);
                setMovementModalMode('MOVEMENT');
              }}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5"
            >
              <ArrowDownUp className="w-4 h-4" />
              <span>{t.inventory.recordMovement}</span>
            </button>
          )}
          {canAdjustStock && (
            <button
              type="button"
              onClick={() => {
                setMovementDefaultPartId(null);
                setMovementModalMode('ADJUST');
              }}
              className="px-3.5 py-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 hover:bg-amber-100 text-xs font-medium flex items-center gap-1.5"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>{t.inventory.adjustStock}</span>
            </button>
          )}
          {canManageSuppliers && (
            <button
              type="button"
              onClick={() => {
                setEditingSupplier(null);
                setShowSupplierModal(true);
              }}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5"
            >
              <Building2 className="w-4 h-4" />
              <span>{t.inventory.newSupplier}</span>
            </button>
          )}
          {canManageParts && (
            <button
              type="button"
              onClick={() => {
                setEditingPart(null);
                setShowPartModal(true);
              }}
              className="px-3.5 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{t.inventory.newPart}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-xs text-slate-500">{t.inventory.kpiSkuCount}</div>
            <div className="text-xl font-bold font-mono-tabular mt-1">
              {formatDigits(overview.totalSkuCount, numerals)}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-xs text-slate-500">{t.inventory.kpiUnits}</div>
            <div className="text-xl font-bold font-mono-tabular mt-1">
              {formatDigits(overview.totalUnitsInStock, numerals)}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-xs text-slate-500">{t.inventory.kpiValuation}</div>
            <div className="text-lg font-bold font-mono-tabular text-blue-900 dark:text-blue-400 mt-1">
              {formatCurrencyMinor(overview.totalValuationMinor, 'DZD', lang, numerals)}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20">
            <div className="text-xs text-amber-800 dark:text-amber-300">{t.inventory.kpiLowStock}</div>
            <div className="text-xl font-bold font-mono-tabular text-amber-700 dark:text-amber-300 mt-1">
              {formatDigits(overview.lowStockCount, numerals)}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20">
            <div className="text-xs text-red-800 dark:text-red-300">{t.inventory.kpiOutOfStock}</div>
            <div className="text-xl font-bold font-mono-tabular text-red-700 dark:text-red-300 mt-1">
              {formatDigits(overview.outOfStockCount, numerals)}
            </div>
          </div>
        </div>
      )}

      {/* Low Stock Alert Strip */}
      {overview && overview.stockAlerts.length > 0 && (
        <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/25 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span className="font-semibold">
              {lang === 'ar' ? overview.stockAlerts[0].titleAr : overview.stockAlerts[0].titleFr}
            </span>
            {overview.stockAlerts.length > 1 && (
              <span className="font-mono-tabular opacity-80">
                (+{formatDigits(overview.stockAlerts.length - 1, numerals)})
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveTab('catalog');
              setStockState(overview.outOfStockCount > 0 ? 'OUT' : 'LOW');
            }}
            className="text-xs font-medium text-amber-900 dark:text-amber-200 underline"
          >
            {t.inventory.stockStateLow}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {(
          [
            ['catalog', t.inventory.tabCatalog],
            ['movements', t.inventory.tabMovements],
            ['suppliers', t.inventory.tabSuppliers],
          ] as Array<[InventoryTab, string]>
        ).map(([tabKey, label]) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setActiveTab(tabKey)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tabKey
                ? 'border-blue-900 text-blue-900 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: CATALOG */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.inventory.searchPlaceholder}
                className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              <option value="ALL">{t.inventory.allCategories}</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <select
              value={stockState}
              onChange={(e) => setStockState(e.target.value as any)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              <option value="ALL">{t.inventory.allStockStates}</option>
              <option value="IN_STOCK">{t.inventory.stockStateInStock}</option>
              <option value="LOW">{t.inventory.stockStateLow}</option>
              <option value="OUT">{t.inventory.stockStateOut}</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>{t.inventory.showArchived}</span>
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-slate-500">{t.common.loading}</div>
            ) : parts.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">{t.inventory.emptyParts}</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.partCode}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.partName}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.category}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.quantityAvailable}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.minimumStock}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.unitPriceDzd}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.stockValue}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.defaultSupplier}</th>
                    <th className="text-end px-3 py-2.5 font-semibold">{t.dialogs.editAction}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {parts.map((p) => (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 ${p.isArchived ? 'opacity-60' : ''}`}
                    >
                      <td className="px-3 py-2.5 font-mono-tabular font-semibold">{p.partCode}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{p.partName}</div>
                        {(p.compatibleModels || p.storageLocation) && (
                          <div className="text-[11px] text-slate-500">
                            {[p.compatibleModels, p.storageLocation].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">{p.category}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono-tabular font-semibold ${stockBadge(p.stockStatus)}`}>
                          {formatDigits(p.quantityAvailable, numerals)} {p.unitLabel} ·{' '}
                          {t.inventory.stockStatuses[p.stockStatus]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular">{formatDigits(p.minimumStock, numerals)}</td>
                      <td className="px-3 py-2.5 font-mono-tabular">
                        {formatCurrencyMinor(p.unitPurchasePriceMinor, 'DZD', lang, numerals)}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular font-semibold">
                        {formatCurrencyMinor(p.stockValueMinor, 'DZD', lang, numerals)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{p.supplierName || '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openPartHistory(p.id)}
                            title={t.inventory.partDetailTitle}
                            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {canRecordMovements && !p.isArchived && (
                            <button
                              type="button"
                              onClick={() => {
                                setMovementDefaultPartId(p.id);
                                setMovementModalMode('MOVEMENT');
                              }}
                              title={t.inventory.recordMovement}
                              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <ArrowDownUp className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canManageParts && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPart(p);
                                  setShowPartModal(true);
                                }}
                                title={t.inventory.editPart}
                                className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setArchiveTarget(p)}
                                title={p.isArchived ? t.inventory.restorePartBtn : t.inventory.archivePartBtn}
                                className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                {p.isArchived ? (
                                  <RotateCcw className="w-3.5 h-3.5" />
                                ) : (
                                  <Archive className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MOVEMENTS */}
      {activeTab === 'movements' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                value={movSearch}
                onChange={(e) => setMovSearch(e.target.value)}
                placeholder={t.inventory.searchPlaceholder}
                className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <select
              value={movTypeFilter}
              onChange={(e) => setMovTypeFilter(e.target.value as any)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              {(
                [
                  'ALL',
                  'PURCHASE',
                  'ENTRY',
                  'MAINTENANCE_USE',
                  'WITHDRAWAL',
                  'RETURN',
                  'INITIAL_STOCK',
                  'ADJUSTMENT',
                ] as const
              ).map((mt) => (
                <option key={mt} value={mt}>
                  {t.inventory.movementTypes[mt]}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            {movements.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">{t.inventory.emptyMovements}</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.movementDate}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.partCode}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.maintenance.statusLabel}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.movementDelta}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.unitPriceDzd}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.movementRef}</th>
                    <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.movementNotes}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 font-mono-tabular whitespace-nowrap">{m.movementDate}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-mono-tabular font-semibold">{m.partCode}</div>
                        <div className="text-[11px] text-slate-500">{m.partName}</div>
                      </td>
                      <td className="px-3 py-2.5">{t.inventory.movementTypes[m.movementType]}</td>
                      <td className="px-3 py-2.5 font-mono-tabular font-bold">
                        <span className={m.quantityDelta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                          {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta} {m.unitLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular">
                        {formatCurrencyMinor(m.unitCostMinor, 'DZD', lang, numerals)}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular text-slate-600 dark:text-slate-400">
                        {[m.referenceCode, m.maintenanceRecordNumber, m.expenseNumber, m.vehicleLabel]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                        <div>{m.notes || m.overrideReason || '—'}</div>
                        <div className="text-[10px] opacity-75">@{m.recordedByUsername}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SUPPLIERS */}
      {activeTab === 'suppliers' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
          {suppliers.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">{t.inventory.emptySuppliers}</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.supplierName}</th>
                  <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.supplierSpecialty}</th>
                  <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.supplierPhone}</th>
                  <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.supplierWilaya}</th>
                  <th className="text-start px-3 py-2.5 font-semibold">{t.inventory.supplierNif}</th>
                  <th className="text-end px-3 py-2.5 font-semibold">{t.dialogs.editAction}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {suppliers.map((s) => (
                  <tr key={s.id} className={s.isArchived ? 'opacity-60' : ''}>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{s.name}</div>
                      {s.address && <div className="text-[11px] text-slate-500">{s.address}</div>}
                    </td>
                    <td className="px-3 py-2.5">{s.specialty || '—'}</td>
                    <td className="px-3 py-2.5 font-mono-tabular">
                      <div>{s.phone || '—'}</div>
                      {s.email && <div className="text-[11px] text-slate-500">{s.email}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular">{s.wilayaCode || '—'}</td>
                    <td className="px-3 py-2.5 font-mono-tabular">{s.nifNumber || '—'}</td>
                    <td className="px-3 py-2.5 text-end">
                      {canManageSuppliers && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSupplier(s);
                            setShowSupplierModal(true);
                          }}
                          className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Part Create/Edit Modal */}
      <InventoryPartModal
        open={showPartModal}
        onClose={() => setShowPartModal(false)}
        onSaved={() => void loadData()}
        part={editingPart}
        suppliers={suppliers.filter((s) => !s.isArchived)}
        existingCategories={categories}
      />

      {/* Stock Movement / Admin Adjustment Modal */}
      <InventoryMovementModal
        open={movementModalMode !== null}
        onClose={() => setMovementModalMode(null)}
        onSaved={() => void loadData()}
        mode={movementModalMode ?? 'MOVEMENT'}
        parts={parts}
        suppliers={suppliers.filter((s) => !s.isArchived)}
        vehicles={vehicles}
        defaultPartId={movementDefaultPartId}
      />

      {/* Supplier Create/Edit Modal */}
      <SupplierModal
        open={showSupplierModal}
        onClose={() => setShowSupplierModal(false)}
        onSaved={() => void loadData()}
        supplier={editingSupplier}
      />

      {/* Part History Detail Modal */}
      <ModalDialog
        open={Boolean(partDetail)}
        onClose={() => setPartDetail(null)}
        title={t.inventory.partDetailTitle}
        subtitle={partDetail ? `${partDetail.part.partCode} · ${partDetail.part.partName}` : undefined}
        size="lg"
      >
        {partDetail && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">{t.inventory.quantityAvailable}</div>
                <div className="font-mono-tabular font-bold text-sm mt-1">
                  {formatDigits(partDetail.part.quantityAvailable, numerals)} {partDetail.part.unitLabel}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">{t.inventory.minimumStock}</div>
                <div className="font-mono-tabular font-bold text-sm mt-1">
                  {formatDigits(partDetail.part.minimumStock, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">{t.inventory.unitPriceDzd}</div>
                <div className="font-mono-tabular font-bold text-sm mt-1">
                  {formatCurrencyMinor(partDetail.part.unitPurchasePriceMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">{t.inventory.stockValue}</div>
                <div className="font-mono-tabular font-bold text-sm mt-1">
                  {formatCurrencyMinor(partDetail.part.stockValueMinor, 'DZD', lang, numerals)}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-x-auto">
              {partDetail.movements.length === 0 ? (
                <div className="p-4 text-center text-slate-500">{t.inventory.emptyMovements}</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="text-start px-3 py-2">{t.inventory.movementDate}</th>
                      <th className="text-start px-3 py-2">{t.maintenance.statusLabel}</th>
                      <th className="text-start px-3 py-2">{t.inventory.movementDelta}</th>
                      <th className="text-start px-3 py-2">{t.inventory.movementRef}</th>
                      <th className="text-start px-3 py-2">{t.inventory.movementNotes}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {partDetail.movements.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-2 font-mono-tabular">{m.movementDate}</td>
                        <td className="px-3 py-2">{t.inventory.movementTypes[m.movementType]}</td>
                        <td className="px-3 py-2 font-mono-tabular font-semibold">
                          <span className={m.quantityDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                            {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono-tabular">
                          {[m.referenceCode, m.maintenanceRecordNumber, m.expenseNumber].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="px-3 py-2">{m.notes || m.overrideReason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </ModalDialog>

      {/* Archive Part Confirmation */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => {
          if (!archiving) setArchiveTarget(null);
        }}
        onConfirm={() => void handleConfirmArchive()}
        loading={archiving}
        title={archiveTarget?.isArchived ? t.inventory.restorePartBtn : t.inventory.archivePartBtn}
        description={
          archiveTarget ? `${archiveTarget.partCode} · ${archiveTarget.partName}` : ''
        }
        tone={archiveTarget?.isArchived ? 'info' : 'danger'}
      />
    </div>
  );
}
