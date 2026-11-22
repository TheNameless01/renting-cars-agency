import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileDown,
  Lock,
  Plus,
  Search,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import {
  VEHICLE_DIAGRAM_ZONES,
  getDiagramZoneLabel,
} from '../../../shared/constants/inspections.ts';
import type {
  DamageSeverity,
  DamageStatus,
  DamageType,
  InspectionStage,
  InspectionStatus,
  Vehicle,
} from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type ContractListItemDto,
  type InspectionListItemDto,
  type VehicleDamageListItemDto,
} from '../../lib/apiClient.ts';
import {
  formatCurrencyMinor,
  formatDateTimeAlgiers,
  formatDigits,
} from '../../lib/formatters.ts';
import { exportInspectionPdf } from '../../lib/pdfExport.ts';
import { DamageResolutionModal } from './DamageResolutionModal.tsx';
import { InspectionWorkflowModal } from './InspectionWorkflowModal.tsx';
import { VehicleDamageDiagram } from './VehicleDamageDiagram.tsx';

type InspectionsTab = 'inspections' | 'damages';

export function InspectionsPage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const canCreate = hasPermission('inspections:create') || hasPermission('inspections:write');
  const canManageDamage = hasPermission('inspections:manage_damage');

  const [activeTab, setActiveTab] = useState<InspectionsTab>('inspections');
  const [loading, setLoading] = useState(true);

  const [inspections, setInspections] = useState<InspectionListItemDto[]>([]);
  const [damages, setDamages] = useState<VehicleDamageListItemDto[]>([]);
  const [contracts, setContracts] = useState<ContractListItemDto[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  // Inspection filters
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<InspectionStage | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<InspectionStatus | 'ALL'>('ALL');
  const [onlyNewDamages, setOnlyNewDamages] = useState(false);

  // Damage filters
  const [damageVehicleId, setDamageVehicleId] = useState<string>('');
  const [damageStatus, setDamageStatus] = useState<DamageStatus | 'ALL'>('ALL');
  const [onlyNewlyDiscovered, setOnlyNewlyDiscovered] = useState(false);

  // New inspection picker modal
  const [showNewPicker, setShowNewPicker] = useState(false);
  const [pickerContractId, setPickerContractId] = useState<string>('');
  const [pickerStage, setPickerStage] = useState<InspectionStage>('DEPARTURE');

  // Active workflow modal
  const [workflowState, setWorkflowState] = useState<{
    open: boolean;
    contractId: number | null;
    stage: InspectionStage;
    inspectionId: number | null;
  }>({ open: false, contractId: null, stage: 'DEPARTURE', inspectionId: null });

  // Standalone Report Damage modal
  const [showReportDamage, setShowReportDamage] = useState(false);
  const [savingDamage, setSavingDamage] = useState(false);
  const [dmgVehicleId, setDmgVehicleId] = useState<string>('');
  const [dmgContractId, setDmgContractId] = useState<string>('');
  const [dmgZone, setDmgZone] = useState<string>('FRONT_BUMPER');
  const [dmgPoint, setDmgPoint] = useState<{ x: number; y: number } | null>({ x: 50, y: 12 });
  const [dmgType, setDmgType] = useState<DamageType>('SCRATCH');
  const [dmgSeverity, setDmgSeverity] = useState<DamageSeverity>('MINOR');
  const [dmgDescription, setDmgDescription] = useState('');
  const [dmgEstimatedDzd, setDmgEstimatedDzd] = useState('');
  const [dmgPreExisting, setDmgPreExisting] = useState(false);
  const [dmgNewlyDiscovered, setDmgNewlyDiscovered] = useState(false);

  // Damage resolution modal
  const [selectedDamage, setSelectedDamage] = useState<VehicleDamageListItemDto | null>(null);
  const [exportingPdfId, setExportingPdfId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [inspRows, dmgRows, contractRows, vehicleRows] = await Promise.all([
        erpClient.listInspections({
          stage: stageFilter,
          status: statusFilter,
          onlyWithNewDamages: onlyNewDamages,
          search: search.trim() || undefined,
        }),
        erpClient.listVehicleDamages({
          vehicleId: damageVehicleId ? Number(damageVehicleId) : undefined,
          status: damageStatus,
          onlyNewlyDiscovered,
        }),
        erpClient.listContracts(),
        erpClient.listVehicles(),
      ]);
      setInspections(inspRows);
      setDamages(dmgRows);
      setContracts(contractRows);
      setVehicles(vehicleRows);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [
    damageStatus,
    damageVehicleId,
    onlyNewDamages,
    onlyNewlyDiscovered,
    search,
    showError,
    stageFilter,
    statusFilter,
    t.common.error,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const kpis = useMemo(() => {
    const total = inspections.length;
    const finalized = inspections.filter((i) => i.status === 'FINALIZED').length;
    const newDamages = damages.filter((d) => d.isNewlyDiscovered).length;
    const openDamages = damages.filter(
      (d) => d.status !== 'REPAIRED' && d.status !== 'REJECTED'
    ).length;
    return { total, finalized, newDamages, openDamages };
  }, [inspections, damages]);

  const eligibleContracts = useMemo(
    () => contracts.filter((c) => c.status !== 'CANCELLED'),
    [contracts]
  );

  const openNewInspectionPicker = () => {
    const first = eligibleContracts[0];
    setPickerContractId(first ? String(first.id) : '');
    setPickerStage('DEPARTURE');
    setShowNewPicker(true);
  };

  const handleLaunchWorkflowFromPicker = (e: FormEvent) => {
    e.preventDefault();
    if (!pickerContractId) return;
    setShowNewPicker(false);
    setWorkflowState({
      open: true,
      contractId: Number(pickerContractId),
      stage: pickerStage,
      inspectionId: null,
    });
  };

  const openReportDamageModal = () => {
    const firstVeh = vehicles[0];
    setDmgVehicleId(firstVeh ? String(firstVeh.id) : '');
    setDmgContractId('');
    setDmgZone('FRONT_BUMPER');
    setDmgPoint({ x: 50, y: 12 });
    setDmgType('SCRATCH');
    setDmgSeverity('MINOR');
    setDmgDescription('');
    setDmgEstimatedDzd('');
    setDmgPreExisting(false);
    setDmgNewlyDiscovered(false);
    setShowReportDamage(true);
  };

  const handleCreateStandaloneDamage = async (e: FormEvent) => {
    e.preventDefault();
    if (!dmgVehicleId || !dmgDescription.trim()) return;
    setSavingDamage(true);
    try {
      await erpClient.addVehicleDamage({
        vehicleId: Number(dmgVehicleId),
        contractId: dmgContractId ? Number(dmgContractId) : null,
        zoneCode: dmgZone,
        diagramX: dmgPoint?.x ?? null,
        diagramY: dmgPoint?.y ?? null,
        damageType: dmgType,
        severity: dmgSeverity,
        description: dmgDescription.trim(),
        isPreExisting: dmgPreExisting,
        isNewlyDiscovered: dmgNewlyDiscovered,
        estimatedRepairCostMinor: dmgEstimatedDzd ? toMinorUnits(Number(dmgEstimatedDzd)) : null,
      });
      showSuccess(t.common.save);
      setShowReportDamage(false);
      setActiveTab('damages');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSavingDamage(false);
    }
  };

  const handleExportPdf = async (inspectionId: number) => {
    setExportingPdfId(inspectionId);
    try {
      const payload = await erpClient.getInspectionPdfPayload(inspectionId);
      await exportInspectionPdf(payload, lang, numerals);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setExportingPdfId(null);
    }
  };

  const damageBadgeClass = (status: DamageStatus) => {
    switch (status) {
      case 'REPAIRED':
        return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'REJECTED':
        return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
      case 'UNDER_REPAIR':
        return 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'CONFIRMED':
        return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
      default:
        return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t.inspections.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t.inspections.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {(canCreate || canManageDamage) && (
            <button
              type="button"
              onClick={openReportDamageModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-950/70 whitespace-nowrap"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{t.inspections.reportDamage}</span>
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={openNewInspectionPicker}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.inspections.newInspection}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 flex items-center justify-between">
            <span>{t.inspections.tabInspections}</span>
            <ClipboardCheck className="w-4 h-4 text-blue-700 dark:text-blue-400" />
          </div>
          <div className="text-2xl font-semibold font-mono-tabular mt-1">
            {formatDigits(kpis.total, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 flex items-center justify-between">
            <span>{t.inspections.statusFinalized}</span>
            <Lock className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-semibold font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
            {formatDigits(kpis.finalized, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 flex items-center justify-between">
            <span>{t.inspections.isNewlyDiscovered}</span>
            <ShieldAlert className="w-4 h-4 text-rose-700 dark:text-rose-400" />
          </div>
          <div className="text-2xl font-semibold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
            {formatDigits(kpis.newDamages, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 flex items-center justify-between">
            <span>{t.inspections.tabDamages}</span>
            <Wrench className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-2xl font-semibold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
            {formatDigits(kpis.openDamages, numerals)}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto">
        {(['inspections', 'damages'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {tab === 'inspections'
              ? `${t.inspections.tabInspections} (${formatDigits(inspections.length, numerals)})`
              : `${t.inspections.tabDamages} (${formatDigits(damages.length, numerals)})`}
          </button>
        ))}
      </div>

      {/* Tab 1: Inspections List */}
      {activeTab === 'inspections' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.inspections.searchPlaceholder}
                className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
            </div>

            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as InspectionStage | 'ALL')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="ALL">{t.inspections.filterAllStages}</option>
              <option value="DEPARTURE">{t.inspections.stageDeparture}</option>
              <option value="RETURN">{t.inspections.stageReturn}</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as InspectionStatus | 'ALL')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="ALL">{t.inspections.filterAllStatuses}</option>
              <option value="DRAFT">{t.inspections.statusDraft}</option>
              <option value="FINALIZED">{t.inspections.statusFinalized}</option>
            </select>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyNewDamages}
                onChange={(e) => setOnlyNewDamages(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>{t.inspections.filterOnlyNewDamages}</span>
            </label>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start"># / {t.inspections.stageSelect}</th>
                    <th className="px-4 py-3 text-start">{t.contracts.contractNumber}</th>
                    <th className="px-4 py-3 text-start">{t.nav.vehicles} / {t.nav.customers}</th>
                    <th className="px-4 py-3 text-start">{t.inspections.odometerKm}</th>
                    <th className="px-4 py-3 text-center">{t.inspections.tabDamages}</th>
                    <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                    <th className="px-4 py-3 text-end">{t.users.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-xs">
                        {t.common.loading}
                      </td>
                    </tr>
                  ) : inspections.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-500 text-xs">
                        {t.inspections.emptyInspections}
                      </td>
                    </tr>
                  ) : (
                    inspections.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 text-xs">
                          <div className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                            {row.inspectionNumber}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                                row.stage === 'DEPARTURE'
                                  ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300'
                                  : 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                              }`}
                            >
                              {row.stage === 'DEPARTURE'
                                ? t.inspections.stageDeparture
                                : t.inspections.stageReturn}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono-tabular">
                              {formatDateTimeAlgiers(row.inspectedAt, lang, numerals)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <Link
                            to={`/contracts/${row.contractId}`}
                            className="font-mono-tabular font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                          >
                            {row.contractNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {row.vehicleLabel} ·{' '}
                            <span className="font-mono-tabular text-slate-500">
                              {formatDigits(row.vehicleMatricule, numerals)}
                            </span>
                          </div>
                          <div className="text-slate-500 mt-0.5">{row.customerName}</div>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono-tabular">
                          <div>{formatDigits(row.odometerKm.toLocaleString(), numerals)} km</div>
                          <div className="text-slate-500">
                            {formatDigits(row.fuelLevelPercent, numerals)}%
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-xs font-mono-tabular">
                          <div className="inline-flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                              <Camera className="w-3.5 h-3.5" />
                              {formatDigits(row.photoCount, numerals)}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                row.newDamageCount > 0
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : row.damageCount > 0
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-500'
                              }`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {formatDigits(row.damageCount, numerals)}
                              {row.newDamageCount > 0 && (
                                <span className="text-[10px]">
                                  (+{formatDigits(row.newDamageCount, numerals)})
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {row.status === 'FINALIZED' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              {t.inspections.statusFinalized}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-medium">
                              {t.inspections.statusDraft}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-end text-xs">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setWorkflowState({
                                  open: true,
                                  contractId: row.contractId,
                                  stage: row.stage,
                                  inspectionId: row.id,
                                })
                              }
                              className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                            >
                              {row.status === 'FINALIZED' ? t.common.view : t.dialogs.editAction}
                            </button>
                            <button
                              type="button"
                              disabled={exportingPdfId === row.id}
                              onClick={() => void handleExportPdf(row.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium disabled:opacity-50"
                            >
                              <FileDown className="w-3 h-3" />
                              <span>PDF</span>
                            </button>
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

      {/* Tab 2: Damages Tracking */}
      {activeTab === 'damages' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <select
              value={damageVehicleId}
              onChange={(e) => setDamageVehicleId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="">{t.vehicles.title}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.brand} {v.model} ({v.matricule})
                </option>
              ))}
            </select>

            <select
              value={damageStatus}
              onChange={(e) => setDamageStatus(e.target.value as DamageStatus | 'ALL')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="ALL">{t.inspections.filterAllStatuses}</option>
              {(['REPORTED', 'UNDER_REVIEW', 'CONFIRMED', 'UNDER_REPAIR', 'REPAIRED', 'REJECTED'] as const).map(
                (st) => (
                  <option key={st} value={st}>
                    {t.inspections.damageStatuses[st]}
                  </option>
                )
              )}
            </select>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyNewlyDiscovered}
                onChange={(e) => setOnlyNewlyDiscovered(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>{t.inspections.isNewlyDiscovered}</span>
            </label>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">Code</th>
                    <th className="px-4 py-3 text-start">{t.nav.vehicles}</th>
                    <th className="px-4 py-3 text-start">{t.inspections.selectedZone}</th>
                    <th className="px-4 py-3 text-start">{t.inspections.damageDescription}</th>
                    <th className="px-4 py-3 text-end">{t.inspections.estimatedRepairCost}</th>
                    <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                    <th className="px-4 py-3 text-end">{t.users.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-xs">
                        {t.common.loading}
                      </td>
                    </tr>
                  ) : damages.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-500 text-xs">
                        {t.inspections.emptyDamages}
                      </td>
                    </tr>
                  ) : (
                    damages.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 text-xs font-mono-tabular">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {d.damageCode}
                          </div>
                          {d.contractNumber && d.contractId && (
                            <Link
                              to={`/contracts/${d.contractId}`}
                              className="text-[11px] text-blue-700 dark:text-blue-400 hover:underline"
                            >
                              {d.contractNumber}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <Link
                            to={`/vehicles/${d.vehicleId}`}
                            className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
                          >
                            {d.vehicleLabel}
                          </Link>
                          <div className="font-mono-tabular text-[11px] text-slate-500">
                            {formatDigits(d.vehicleMatricule, numerals)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="font-medium">{getDiagramZoneLabel(d.zoneCode, lang)}</div>
                          <div className="text-[11px] text-slate-500">
                            {t.inspections.damageTypes[d.damageType]} ·{' '}
                            {t.inspections.damageSeverities[d.severity]}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs max-w-xs">
                          <div className="text-slate-800 dark:text-slate-200 line-clamp-2">
                            {d.description}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {d.isNewlyDiscovered && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-semibold">
                                {t.inspections.isNewlyDiscovered}
                              </span>
                            )}
                            {d.isPreExisting && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-semibold">
                                {t.inspections.isPreExisting}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-end text-xs font-mono-tabular font-medium">
                          {d.estimatedRepairCostMinor != null
                            ? formatCurrencyMinor(d.estimatedRepairCostMinor, 'DZD', lang, numerals)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span
                            className={`inline-block px-2 py-0.5 rounded border text-[11px] font-medium ${damageBadgeClass(
                              d.status
                            )}`}
                          >
                            {t.inspections.damageStatuses[d.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-end text-xs">
                          <button
                            type="button"
                            onClick={() => setSelectedDamage(d)}
                            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                          >
                            {canManageDamage ? t.dialogs.editAction : t.common.view}
                          </button>
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

      {/* New Inspection Contract/Stage Picker Modal */}
      <ModalDialog
        open={showNewPicker}
        onClose={() => setShowNewPicker(false)}
        title={t.inspections.newInspection}
        size="md"
        onSubmit={handleLaunchWorkflowFromPicker}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowNewPicker(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={!pickerContractId}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {t.inspections.newInspection}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">
            {t.inspections.contractSelect} *
          </label>
          <select
            required
            data-autofocus
            value={pickerContractId}
            onChange={(e) => setPickerContractId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            {eligibleContracts.length === 0 ? (
              <option value="">—</option>
            ) : (
              eligibleContracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contractNumber} · {c.customerName} ({c.vehicleLabel}) [{t.contracts.statuses[c.status]}]
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            {t.inspections.stageSelect} *
          </label>
          <select
            value={pickerStage}
            onChange={(e) => setPickerStage(e.target.value as InspectionStage)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            <option value="DEPARTURE">{t.inspections.stageDeparture}</option>
            <option value="RETURN">{t.inspections.stageReturn}</option>
          </select>
        </div>
      </ModalDialog>

      {/* Standalone Report Damage Modal */}
      <ModalDialog
        open={showReportDamage}
        onClose={() => {
          if (!savingDamage) setShowReportDamage(false);
        }}
        title={t.inspections.reportDamage}
        size="lg"
        disableClose={savingDamage}
        onSubmit={handleCreateStandaloneDamage}
        footer={
          <>
            <button
              type="button"
              disabled={savingDamage}
              onClick={() => setShowReportDamage(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={savingDamage || !dmgVehicleId || dmgDescription.trim().length < 3}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {savingDamage ? t.common.loading : t.inspections.addDamageBtn}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          <div className="md:col-span-5 flex flex-col items-center">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
              {t.inspections.diagramHint}
            </div>
            <VehicleDamageDiagram
              lang={lang}
              selectedZone={dmgZone}
              selectedPoint={dmgPoint}
              pins={[]}
              onSelectZone={(zoneCode, x, y) => {
                setDmgZone(zoneCode);
                setDmgPoint({ x, y });
              }}
            />
          </div>

          <div className="md:col-span-7 space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">{t.nav.vehicles} *</label>
              <select
                required
                data-autofocus
                value={dmgVehicleId}
                onChange={(e) => setDmgVehicleId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} · {v.matricule}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                {t.inspections.contractSelect}
              </label>
              <select
                value={dmgContractId}
                onChange={(e) => setDmgContractId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              >
                <option value="">—</option>
                {contracts
                  .filter((c) => !dmgVehicleId || c.vehicleId === Number(dmgVehicleId))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contractNumber} · {c.customerName}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.selectedZone} *
                </label>
                <select
                  value={dmgZone}
                  onChange={(e) => {
                    const zone = VEHICLE_DIAGRAM_ZONES.find((z) => z.code === e.target.value);
                    setDmgZone(e.target.value);
                    if (zone) setDmgPoint({ x: zone.defaultX, y: zone.defaultY });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  {VEHICLE_DIAGRAM_ZONES.map((z) => (
                    <option key={z.code} value={z.code}>
                      {lang === 'ar' ? z.labelAr : z.labelFr}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.damageType} *
                </label>
                <select
                  value={dmgType}
                  onChange={(e) => setDmgType(e.target.value as DamageType)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  {(['SCRATCH', 'DENT', 'CRACK', 'BROKEN', 'MISSING_ACCESSORY', 'OTHER'] as const).map(
                    (dt) => (
                      <option key={dt} value={dt}>
                        {t.inspections.damageTypes[dt]}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.damageSeverity} *
                </label>
                <select
                  value={dmgSeverity}
                  onChange={(e) => setDmgSeverity(e.target.value as DamageSeverity)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  {(['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'] as const).map((sv) => (
                    <option key={sv} value={sv}>
                      {t.inspections.damageSeverities[sv]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.estimatedRepairCost}
                </label>
                <input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={dmgEstimatedDzd}
                  onChange={(e) => setDmgEstimatedDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                {t.inspections.damageDescription} *
              </label>
              <textarea
                rows={3}
                required
                minLength={3}
                value={dmgDescription}
                onChange={(e) => setDmgDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dmgPreExisting}
                  onChange={(e) => setDmgPreExisting(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>{t.inspections.isPreExisting}</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dmgNewlyDiscovered}
                  onChange={(e) => setDmgNewlyDiscovered(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>{t.inspections.isNewlyDiscovered}</span>
              </label>
            </div>
          </div>
        </div>
      </ModalDialog>

      {/* Inspection Workflow Modal */}
      <InspectionWorkflowModal
        open={workflowState.open}
        contractId={workflowState.contractId}
        stage={workflowState.stage}
        inspectionId={workflowState.inspectionId}
        onClose={() => setWorkflowState((s) => ({ ...s, open: false }))}
        onSaved={() => void loadData()}
      />

      {/* Damage Resolution Modal */}
      <DamageResolutionModal
        open={Boolean(selectedDamage)}
        damage={selectedDamage}
        onClose={() => setSelectedDamage(null)}
        onUpdated={() => void loadData()}
      />
    </div>
  );
}
