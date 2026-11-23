import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  GeneratedDocument,
  MaintenanceStatus,
  MaintenanceType,
  Vehicle,
} from '../../../shared/types/domain.ts';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type AppNotificationDto,
  type MaintenanceRecordListItemDto,
  type VehicleMaintenanceDueItemDto,
  type VehicleMaintenanceOverviewDto,
} from '../../lib/apiClient.ts';
import {
  formatCurrencyMinor,
  formatDateTimeAlgiers,
  formatDigits,
} from '../../lib/formatters.ts';
import { MaintenanceRecordModal } from './MaintenanceRecordModal.tsx';
import { MaintenanceScheduleModal } from './MaintenanceScheduleModal.tsx';
import { MaintenanceTypeModal } from './MaintenanceTypeModal.tsx';

type MaintenanceTab = 'interventions' | 'alerts' | 'types';

const STATUS_BADGE_MAP: Record<MaintenanceStatus, string> = {
  SCHEDULED:
    'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800',
  IN_PROGRESS:
    'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
  COMPLETED:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
  CANCELLED:
    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700',
};

const ALERT_STATE_BADGE_MAP: Record<VehicleMaintenanceDueItemDto['alertState'], string> = {
  OK: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  APPROACHING: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  DUE: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300',
  OVERDUE: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
};

export function MaintenancePage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const canCreate = hasPermission('maintenance:create') || hasPermission('maintenance:write');
  const canUpdate =
    hasPermission('maintenance:update') ||
    hasPermission('maintenance:complete') ||
    hasPermission('maintenance:write');
  const canManageTypes = hasPermission('maintenance:manage_types');
  const canCustomizeSchedule =
    hasPermission('maintenance:manage_types') ||
    hasPermission('maintenance:update') ||
    hasPermission('maintenance:write');
  const canResolveAlert =
    hasPermission('maintenance:update') ||
    hasPermission('maintenance:complete') ||
    hasPermission('maintenance:write') ||
    hasPermission('vehicles:write');
  const canGenerateDoc = hasPermission('documents:generate');

  const [activeTab, setActiveTab] = useState<MaintenanceTab>('interventions');
  const [loading, setLoading] = useState(true);
  const [syncingAlerts, setSyncingAlerts] = useState(false);

  const [records, setRecords] = useState<MaintenanceRecordListItemDto[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [types, setTypes] = useState<MaintenanceType[]>([]);
  const [alerts, setAlerts] = useState<AppNotificationDto[]>([]);
  const [fleetOverviews, setFleetOverviews] = useState<
    Array<{ vehicle: Vehicle; overview: VehicleMaintenanceOverviewDto }>
  >([]);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | 'ALL'>('ALL');
  const [vehicleFilter, setVehicleFilter] = useState<string>('ALL');
  const [emergencyOnly, setEmergencyOnly] = useState(false);
  const [showOnlyDueMatrix, setShowOnlyDueMatrix] = useState(true);
  const [matrixVehicleFilter, setMatrixVehicleFilter] = useState<string>('ALL');

  // Modals
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [defaultModalVehicleId, setDefaultModalVehicleId] = useState<number | undefined>(undefined);
  const [defaultModalTypeId, setDefaultModalTypeId] = useState<number | undefined>(undefined);

  const [scheduleModalTarget, setScheduleModalTarget] = useState<{
    vehicleId: number;
    item: VehicleMaintenanceDueItemDto;
  } | null>(null);

  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<MaintenanceType | null>(null);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDocument | null>(null);
  const [generatedPdfBase64, setGeneratedPdfBase64] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [recList, vList, tList, alertList] = await Promise.all([
        erpClient.listMaintenance({
          vehicleId: vehicleFilter !== 'ALL' ? Number(vehicleFilter) : undefined,
          status: statusFilter,
          isEmergency: emergencyOnly || undefined,
          search: search.trim() || undefined,
        }),
        erpClient.listVehicles({ includeArchived: false }),
        erpClient.listMaintenanceTypes(true),
        erpClient.listOperationalAlerts({ includeResolved: false }),
      ]);
      setRecords(recList);
      setVehicles(vList);
      setTypes(tList);
      setAlerts(alertList);

      const overviewResults = await Promise.all(
        vList.map(async (v) => {
          try {
            const ov = await erpClient.getVehicleMaintenanceOverview(v.id);
            return { vehicle: v, overview: ov };
          } catch {
            return null;
          }
        })
      );
      setFleetOverviews(
        overviewResults.filter(
          (item): item is { vehicle: Vehicle; overview: VehicleMaintenanceOverviewDto } => item !== null
        )
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [emergencyOnly, search, showError, statusFilter, t.common.error, vehicleFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const kpis = useMemo(() => {
    let inProgress = 0;
    let scheduled = 0;
    let completed = 0;
    let emergency = 0;
    let totalCostMinor = 0;
    for (const r of records) {
      if (r.status === 'IN_PROGRESS') inProgress += 1;
      if (r.status === 'SCHEDULED') scheduled += 1;
      if (r.status === 'COMPLETED') completed += 1;
      if (r.isEmergency) emergency += 1;
      if (r.status !== 'CANCELLED') totalCostMinor += r.totalCostMinor;
    }
    return { inProgress, scheduled, completed, emergency, totalCostMinor };
  }, [records]);

  const criticalAlertsCount = useMemo(
    () => alerts.filter((a) => a.severity === 'CRITICAL').length,
    [alerts]
  );
  const warningAlertsCount = useMemo(
    () => alerts.filter((a) => a.severity === 'WARNING').length,
    [alerts]
  );

  const dueMatrixRows = useMemo(() => {
    const rows: Array<{ vehicle: Vehicle; item: VehicleMaintenanceDueItemDto }> = [];
    for (const entry of fleetOverviews) {
      if (matrixVehicleFilter !== 'ALL' && String(entry.vehicle.id) !== matrixVehicleFilter) continue;
      for (const item of entry.overview.dueSummary) {
        if (!item.isScheduleActive) continue;
        if (showOnlyDueMatrix && item.alertState === 'OK') continue;
        rows.push({ vehicle: entry.vehicle, item });
      }
    }
    const rank: Record<VehicleMaintenanceDueItemDto['alertState'], number> = {
      OVERDUE: 0,
      DUE: 1,
      APPROACHING: 2,
      OK: 3,
    };
    return rows.sort((a, b) => rank[a.item.alertState] - rank[b.item.alertState]);
  }, [fleetOverviews, matrixVehicleFilter, showOnlyDueMatrix]);

  const handleSyncAlerts = async () => {
    setSyncingAlerts(true);
    try {
      const synced = await erpClient.syncOperationalAlerts();
      setAlerts(synced);
      await loadData();
      showSuccess(t.alerts.refreshSync);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSyncingAlerts(false);
    }
  };

  const handleMarkAlertRead = async (alertId: number) => {
    try {
      await erpClient.markOperationalAlertRead(alertId);
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, isRead: true } : a)));
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleResolveAlert = async (alertId: number) => {
    try {
      await erpClient.resolveOperationalAlert(alertId);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      showSuccess(t.alerts.resolveAction);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleDownloadInvoice = async (recordId: number) => {
    try {
      const doc = await erpClient.readMaintenanceInvoice(recordId);
      const byteChars = atob(doc.base64Data);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i += 1) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: doc.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.originalFileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleGenerateMaintenancePdf = async (recordId: number) => {
    setGeneratingPdf(true);
    try {
      const res = await erpClient.generateDocument({
        documentKind: 'MAINTENANCE_REPORT',
        maintenanceRecordId: recordId,
        format: 'A4_PDF',
        language: lang,
        numeralSystem: numerals,
      });
      setGeneratedDoc(res.document);
      setGeneratedPdfBase64(res.pdfBase64);
      setDocPreviewOpen(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const openCreateModal = (vehicleId?: number, typeId?: number) => {
    setEditingRecordId(null);
    setDefaultModalVehicleId(vehicleId);
    setDefaultModalTypeId(typeId);
    setRecordModalOpen(true);
  };

  const openEditModal = (recordId: number) => {
    setEditingRecordId(recordId);
    setDefaultModalVehicleId(undefined);
    setDefaultModalTypeId(undefined);
    setRecordModalOpen(true);
  };

  const tabs: Array<{ key: MaintenanceTab; label: string; count?: number }> = [
    { key: 'interventions', label: t.maintenance.tabInterventions, count: records.length },
    { key: 'alerts', label: t.maintenance.tabAlertsAndSchedule, count: alerts.length },
    { key: 'types', label: t.maintenance.tabTypes, count: types.length },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t.maintenance.title}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.maintenance.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={syncingAlerts}
            onClick={() => void handleSyncAlerts()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingAlerts ? 'animate-spin' : ''}`} />
            <span>{t.alerts.refreshSync}</span>
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
            >
              <Plus className="w-4 h-4" />
              <span>{t.maintenance.newIntervention}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3.5 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono-tabular text-[11px]">
                {formatDigits(tab.count, numerals)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* TAB 1: INTERVENTIONS */}
      {activeTab === 'interventions' && (
        <div className="space-y-5">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t.maintenance.kpiInProgress}</div>
              <div className="text-xl font-bold font-mono-tabular mt-1 text-amber-700 dark:text-amber-400">
                {formatDigits(kpis.inProgress, numerals)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t.maintenance.kpiScheduled}</div>
              <div className="text-xl font-bold font-mono-tabular mt-1 text-blue-800 dark:text-blue-400">
                {formatDigits(kpis.scheduled, numerals)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t.maintenance.kpiCompleted}</div>
              <div className="text-xl font-bold font-mono-tabular mt-1 text-emerald-700 dark:text-emerald-400">
                {formatDigits(kpis.completed, numerals)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t.maintenance.kpiEmergency}</div>
              <div className="text-xl font-bold font-mono-tabular mt-1 text-rose-700 dark:text-rose-400">
                {formatDigits(kpis.emergency, numerals)}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t.maintenance.kpiTotalCost}</div>
              <div className="text-lg font-bold font-mono-tabular mt-1 text-slate-900 dark:text-slate-100">
                {formatCurrencyMinor(kpis.totalCostMinor, 'DZD', lang, numerals)}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.maintenance.searchPlaceholder}
                className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as MaintenanceStatus | 'ALL')}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="ALL">{t.maintenance.filterAllStatuses}</option>
              <option value="SCHEDULED">{t.maintenance.statuses.SCHEDULED}</option>
              <option value="IN_PROGRESS">{t.maintenance.statuses.IN_PROGRESS}</option>
              <option value="COMPLETED">{t.maintenance.statuses.COMPLETED}</option>
              <option value="CANCELLED">{t.maintenance.statuses.CANCELLED}</option>
            </select>

            <select
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="ALL">{t.nav.vehicles}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.brand} {v.model} ({v.matricule})
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-rose-700 dark:text-rose-400 cursor-pointer">
              <input
                type="checkbox"
                checked={emergencyOnly}
                onChange={(e) => setEmergencyOnly(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>{t.maintenance.filterEmergencyOnly}</span>
            </label>
          </div>

          {/* Records Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.maintenance.recordNumber}</th>
                    <th className="px-4 py-3 text-start">{t.nav.vehicles}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.maintenanceType}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.statusLabel}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.performedDate}</th>
                    <th className="px-4 py-3 text-end">{t.maintenance.odometerKm}</th>
                    <th className="px-4 py-3 text-end">{t.maintenance.totalCostDzd}</th>
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
                  ) : records.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                        <Wrench className="w-5 h-5 mx-auto mb-1 opacity-50" />
                        {t.maintenance.emptyRecords}
                      </td>
                    </tr>
                  ) : (
                    records.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                            {r.recordNumber}
                          </div>
                          {r.isEmergency && (
                            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 text-[10px] font-semibold">
                              <AlertTriangle className="w-3 h-3" />
                              {t.maintenance.emergencyBadge}
                            </span>
                          )}
                          {r.blockIsActive && (
                            <div className="inline-flex items-center gap-1 mt-1 ms-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-medium">
                              <Lock className="w-2.5 h-2.5" />
                              {t.maintenance.vehicleBlockedActive}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/vehicles/${r.vehicleId}`}
                            className="font-medium text-blue-800 dark:text-blue-400 hover:underline"
                          >
                            {r.vehicleLabel}
                          </Link>
                          <div className="font-mono-tabular text-[11px] text-slate-500">
                            {formatDigits(r.vehicleMatricule, numerals)}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {lang === 'ar' ? r.maintenanceTypeNameAr : r.maintenanceTypeNameFr}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">{r.workDescription}</div>
                          {r.supplierName && (
                            <div className="text-[11px] text-slate-400">{r.supplierName}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${STATUS_BADGE_MAP[r.status]}`}
                          >
                            {t.maintenance.statuses[r.status]}
                          </span>
                          {r.linkedExpenseNumber && (
                            <div className="text-[10px] font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
                              {r.linkedExpenseNumber}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular">
                          <div>{formatDigits(r.performedDate, numerals)}</div>
                          {r.scheduledStartDate && r.scheduledEndDate && (
                            <div className="text-[11px] text-slate-500">
                              {formatDateTimeAlgiers(r.scheduledStartDate, lang, numerals)} →{' '}
                              {formatDateTimeAlgiers(r.scheduledEndDate, lang, numerals)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-end font-mono-tabular">
                          <div>{formatDigits(r.odometerKm.toLocaleString(), numerals)} km</div>
                          {r.nextDueOdometerKm != null && (
                            <div className="text-[11px] text-slate-500">
                              → {formatDigits(r.nextDueOdometerKm.toLocaleString(), numerals)} km
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-end font-mono-tabular">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatCurrencyMinor(r.totalCostMinor, 'DZD', lang, numerals)}
                          </div>
                          {(r.laborCostMinor > 0 || r.partsCostMinor > 0) && (
                            <div className="text-[10px] text-slate-500">
                              {formatCurrencyMinor(r.laborCostMinor, 'DZD', lang, numerals)} +{' '}
                              {formatCurrencyMinor(r.partsCostMinor, 'DZD', lang, numerals)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            {canGenerateDoc && (
                              <button
                                type="button"
                                disabled={generatingPdf}
                                onClick={() => void handleGenerateMaintenancePdf(r.id)}
                                title={t.documents.triggers.maintenanceReportPdf}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                              >
                                <FileText className="w-3 h-3 text-blue-700 dark:text-blue-400" />
                                <span>{t.documents.triggers.maintenanceReportPdf}</span>
                              </button>
                            )}
                            {r.invoiceFilePath && (
                              <button
                                type="button"
                                onClick={() => void handleDownloadInvoice(r.id)}
                                title={r.invoiceOriginalName || t.maintenance.viewInvoice}
                                className="p-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canUpdate && (
                              <button
                                type="button"
                                onClick={() => openEditModal(r.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>
                                  {r.status === 'SCHEDULED' || r.status === 'IN_PROGRESS'
                                    ? t.maintenance.completeIntervention
                                    : t.dialogs.editAction}
                                </span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ALERTS & PREVENTIVE SCHEDULE MATRIX */}
      {activeTab === 'alerts' && (
        <div className="space-y-6">
          {/* Operational Alerts */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t.alerts.panelTitle}
                </h3>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 font-mono-tabular font-semibold">
                  {formatDigits(criticalAlertsCount, numerals)} {t.alerts.criticalCount}
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-mono-tabular font-semibold">
                  {formatDigits(warningAlertsCount, numerals)} {t.alerts.warningCount}
                </span>
              </div>
            </div>

            {alerts.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-emerald-600" />
                <p>{t.alerts.allClear}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {alerts.map((al) => {
                  const categoryLabel =
                    t.alerts.categories[al.category as keyof typeof t.alerts.categories] ??
                    al.category;
                  return (
                    <div
                      key={al.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span
                            className={`px-2 py-0.5 rounded font-semibold ${
                              al.severity === 'CRITICAL'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                : al.severity === 'WARNING'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                            }`}
                          >
                            {t.alerts.severities[al.severity]}
                          </span>
                          <span className="text-slate-500 font-medium">{categoryLabel}</span>
                          {!al.isRead && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-900 text-white dark:bg-blue-600 text-[10px]">
                              {t.alerts.unreadBadge}
                            </span>
                          )}
                          {al.dueDate && (
                            <span className="font-mono-tabular text-slate-400">
                              {formatDigits(al.dueDate, numerals)}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {lang === 'ar' ? al.titleAr : al.titleFr}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          {lang === 'ar' ? al.messageAr : al.messageFr}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {al.entityType === 'vehicle' && al.entityId && (
                          <Link
                            to={`/vehicles/${al.entityId}`}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {t.alerts.openVehicle}
                          </Link>
                        )}
                        {!al.isRead && (
                          <button
                            type="button"
                            onClick={() => void handleMarkAlertRead(al.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {t.alerts.markRead}
                          </button>
                        )}
                        {canResolveAlert && (
                          <button
                            type="button"
                            onClick={() => void handleResolveAlert(al.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-medium"
                          >
                            {t.alerts.resolveAction}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Fleet Preventive Due Matrix */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-800 dark:text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t.maintenance.scheduleTitle}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={matrixVehicleFilter}
                  onChange={(e) => setMatrixVehicleFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  <option value="ALL">{t.nav.vehicles}</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.brand} {v.model} ({v.matricule})
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showOnlyDueMatrix}
                    onChange={(e) => setShowOnlyDueMatrix(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>
                    {t.maintenance.alertStates.APPROACHING} / {t.maintenance.alertStates.DUE} /{' '}
                    {t.maintenance.alertStates.OVERDUE}
                  </span>
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.nav.vehicles}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.maintenanceType}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.lastDone}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.nextDue}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.remaining}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.statusLabel}</th>
                    <th className="px-4 py-3 text-end">{t.users.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {dueMatrixRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        {t.maintenance.emptyDueSummary}
                      </td>
                    </tr>
                  ) : (
                    dueMatrixRows.map(({ vehicle, item }) => (
                      <tr key={`${vehicle.id}-${item.maintenanceTypeId}`}>
                        <td className="px-4 py-3">
                          <Link
                            to={`/vehicles/${vehicle.id}`}
                            className="font-medium text-blue-800 dark:text-blue-400 hover:underline"
                          >
                            {vehicle.brand} {vehicle.model}
                          </Link>
                          <div className="font-mono-tabular text-[11px] text-slate-500">
                            {formatDigits(vehicle.matricule, numerals)} ·{' '}
                            {formatDigits(vehicle.currentOdometerKm.toLocaleString(), numerals)} km
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {lang === 'ar' ? item.nameAr : item.nameFr}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono-tabular">
                            {item.kmInterval != null
                              ? `${formatDigits(item.kmInterval.toLocaleString(), numerals)} km`
                              : '—'}{' '}
                            ·{' '}
                            {item.dayInterval != null
                              ? `${formatDigits(item.dayInterval, numerals)} ${t.common.days}`
                              : '—'}{' '}
                            <span className="ms-1 text-[10px]">
                              ({item.hasCustomSchedule ? t.maintenance.customScheduleBadge : t.maintenance.defaultScheduleBadge})
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-slate-600 dark:text-slate-400">
                          {item.lastPerformedDate ? (
                            <>
                              <div>{formatDigits(item.lastPerformedDate, numerals)}</div>
                              {item.lastOdometerKm != null && (
                                <div className="text-[11px]">
                                  {formatDigits(item.lastOdometerKm.toLocaleString(), numerals)} km
                                </div>
                              )}
                            </>
                          ) : (
                            t.maintenance.neverDone
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular">
                          <div>{item.nextDueDate ? formatDigits(item.nextDueDate, numerals) : '—'}</div>
                          {item.nextDueOdometerKm != null && (
                            <div className="text-[11px] text-slate-500">
                              {formatDigits(item.nextDueOdometerKm.toLocaleString(), numerals)} km
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular">
                          <div>
                            {item.remainingKm != null
                              ? `${formatDigits(item.remainingKm.toLocaleString(), numerals)} km`
                              : '—'}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {item.remainingDays != null
                              ? `${formatDigits(item.remainingDays, numerals)} ${t.common.days}`
                              : '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${ALERT_STATE_BADGE_MAP[item.alertState]}`}
                          >
                            {t.maintenance.alertStates[item.alertState]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            {canCustomizeSchedule && (
                              <button
                                type="button"
                                onClick={() =>
                                  setScheduleModalTarget({ vehicleId: vehicle.id, item })
                                }
                                title={t.maintenance.customizeSchedule}
                                className="p-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Settings2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canCreate && (
                              <button
                                type="button"
                                onClick={() =>
                                  openCreateModal(vehicle.id, item.maintenanceTypeId)
                                }
                                className="px-2.5 py-1 rounded bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-medium"
                              >
                                {t.maintenance.scheduleActionBtn}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MAINTENANCE TYPES & INTERVALS */}
      {activeTab === 'types' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {!canManageTypes ? (
              <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{t.maintenance.adminOnlyTypesNotice}</span>
              </div>
            ) : (
              <div />
            )}

            {canManageTypes && (
              <button
                type="button"
                onClick={() => {
                  setEditingType(null);
                  setTypeModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.maintenance.addTypeBtn}</span>
              </button>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.maintenance.typeCode}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.typeNameFr}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.typeNameAr}</th>
                    <th className="px-4 py-3 text-end">{t.maintenance.kmInterval}</th>
                    <th className="px-4 py-3 text-end">{t.maintenance.dayInterval}</th>
                    <th className="px-4 py-3 text-end">{t.maintenance.kmWarningThreshold}</th>
                    <th className="px-4 py-3 text-end">{t.maintenance.dayWarningThreshold}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.statusLabel}</th>
                    {canManageTypes && <th className="px-4 py-3 text-end">{t.users.actions}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {types.map((mt) => (
                    <tr key={mt.id} className={!mt.isActive ? 'opacity-60' : ''}>
                      <td className="px-4 py-3 font-mono-tabular font-semibold">{mt.code}</td>
                      <td className="px-4 py-3">{mt.nameFr}</td>
                      <td className="px-4 py-3">{mt.nameAr}</td>
                      <td className="px-4 py-3 text-end font-mono-tabular">
                        {mt.defaultKmInterval != null
                          ? `${formatDigits(mt.defaultKmInterval.toLocaleString(), numerals)} km`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-end font-mono-tabular">
                        {mt.defaultDayInterval != null
                          ? `${formatDigits(mt.defaultDayInterval, numerals)} ${t.common.days}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-end font-mono-tabular">
                        {formatDigits(mt.kmWarningThreshold.toLocaleString(), numerals)} km
                      </td>
                      <td className="px-4 py-3 text-end font-mono-tabular">
                        {formatDigits(mt.dayWarningThreshold, numerals)} {t.common.days}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                            mt.isActive
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {mt.isActive ? t.maintenance.typeActive : t.maintenance.inactiveScheduleBadge}
                        </span>
                      </td>
                      {canManageTypes && (
                        <td className="px-4 py-3 text-end">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingType(mt);
                              setTypeModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>{t.dialogs.editAction}</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Portaled Modals */}
      <MaintenanceRecordModal
        open={recordModalOpen}
        recordId={editingRecordId}
        defaultVehicleId={defaultModalVehicleId}
        defaultMaintenanceTypeId={defaultModalTypeId}
        onClose={() => setRecordModalOpen(false)}
        onSaved={() => void loadData()}
      />

      {scheduleModalTarget && (
        <MaintenanceScheduleModal
          open={Boolean(scheduleModalTarget)}
          vehicleId={scheduleModalTarget.vehicleId}
          item={scheduleModalTarget.item}
          onClose={() => setScheduleModalTarget(null)}
          onSaved={() => void loadData()}
        />
      )}

      <MaintenanceTypeModal
        open={typeModalOpen}
        editingType={editingType}
        onClose={() => setTypeModalOpen(false)}
        onSaved={() => void loadData()}
      />

      <DocumentPreviewModal
        open={docPreviewOpen}
        onClose={() => setDocPreviewOpen(false)}
        initialDocument={generatedDoc}
        initialPdfBase64={generatedPdfBase64}
      />
    </div>
  );
}
