import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarOff,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Lock,
  Pencil,
  Plus,
  Settings2,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import { getDiagramZoneLabel } from '../../../shared/constants/inspections.ts';
import type {
  GeneratedDocument,
  MaintenanceStatus,
  VehicleDocType,
  VehicleDocument,
  VehicleFuelType,
  VehicleStatus,
  VehicleTransmission,
} from '../../../shared/types/domain.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type InspectionListItemDto,
  type VehicleDamageListItemDto,
  type VehicleFinanceSummaryDto,
  type VehicleMaintenanceDueItemDto,
  type VehicleMaintenanceOverviewDto,
  type VehicleProfileDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';
import { ExpensesTab } from '../finance/ExpensesTab.tsx';
import { DamageResolutionModal } from '../inspections/DamageResolutionModal.tsx';
import { MaintenanceRecordModal } from '../maintenance/MaintenanceRecordModal.tsx';
import { MaintenanceScheduleModal } from '../maintenance/MaintenanceScheduleModal.tsx';

type VehicleTab =
  | 'general'
  | 'documents'
  | 'rentals'
  | 'blocks'
  | 'maintenance'
  | 'expenses'
  | 'photos'
  | 'profitability';

const VEHICLE_CATEGORIES = ['Citadine', 'Berline', 'SUV / 4x4', 'Utilitaire', 'Compacte', 'Monospace'];

function getDocExpiryState(expirationDate: string, reminderDays: number): 'expired' | 'soon' | 'valid' {
  const today = new Date().toISOString().slice(0, 10);
  if (expirationDate < today) return 'expired';
  const warnDate = new Date(Date.now() + reminderDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (expirationDate <= warnDate) return 'soon';
  return 'valid';
}

export function VehicleProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [profile, setProfile] = useState<VehicleProfileDto | null>(null);
  const [financeSummary, setFinanceSummary] = useState<VehicleFinanceSummaryDto | null>(null);
  const [vehicleDamages, setVehicleDamages] = useState<VehicleDamageListItemDto[]>([]);
  const [vehicleInspections, setVehicleInspections] = useState<InspectionListItemDto[]>([]);
  const [vehiclePhotos, setVehiclePhotos] = useState<
    Array<{
      id: number;
      inspectionId: number;
      inspectionNumber: string;
      stage: string;
      inspectedAt: string;
      caption: string | null;
      originalFileName: string | null;
      dataUrl: string;
    }>
  >([]);
  const [selectedDamage, setSelectedDamage] = useState<VehicleDamageListItemDto | null>(null);
  const [maintenanceOverview, setMaintenanceOverview] = useState<VehicleMaintenanceOverviewDto | null>(
    null
  );
  const [maintModalOpen, setMaintModalOpen] = useState(false);
  const [editingMaintId, setEditingMaintId] = useState<number | null>(null);
  const [defaultMaintTypeId, setDefaultMaintTypeId] = useState<number | undefined>(undefined);
  const [scheduleModalItem, setScheduleModalItem] = useState<VehicleMaintenanceDueItemDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<VehicleTab>('general');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDocument | null>(null);
  const [generatedPdfBase64, setGeneratedPdfBase64] = useState<string | null>(null);
  // ...
  const canViewVehicleFinance =
    hasPermission('finance:read') ||
    hasPermission('finance:manage_expenses') ||
    hasPermission('reports:view');
  const canViewInspections =
    hasPermission('inspections:view') ||
    hasPermission('inspections:create') ||
    hasPermission('inspections:write') ||
    hasPermission('vehicles:read');
  const canViewMaintenance =
    hasPermission('maintenance:view') ||
    hasPermission('maintenance:create') ||
    hasPermission('maintenance:update') ||
    hasPermission('maintenance:complete') ||
    hasPermission('maintenance:write') ||
    hasPermission('vehicles:read');
  const canCreateMaintenance =
    hasPermission('maintenance:create') || hasPermission('maintenance:write');
  const canUpdateMaintenance =
    hasPermission('maintenance:update') ||
    hasPermission('maintenance:complete') ||
    hasPermission('maintenance:write');
  const canCustomizeMaintSchedule =
    hasPermission('maintenance:manage_types') ||
    hasPermission('maintenance:update') ||
    hasPermission('maintenance:write');
  const canGenerateDoc = hasPermission('documents:generate');

  // Edit vehicle modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editInternalCode, setEditInternalCode] = useState('');
  const [editMatricule, setEditMatricule] = useState('');
  const [editVin, setEditVin] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editCategory, setEditCategory] = useState('Citadine');
  const [editFuelType, setEditFuelType] = useState<VehicleFuelType>('ESSENCE');
  const [editTransmission, setEditTransmission] = useState<VehicleTransmission>('MANUAL');
  const [editSeats, setEditSeats] = useState('5');
  const [editOdometer, setEditOdometer] = useState('0');
  const [editAcquisitionDate, setEditAcquisitionDate] = useState('');
  const [editAcquisitionCostDzd, setEditAcquisitionCostDzd] = useState('');
  const [editDailyDzd, setEditDailyDzd] = useState('0');
  const [editWeeklyDzd, setEditWeeklyDzd] = useState('');
  const [editMonthlyDzd, setEditMonthlyDzd] = useState('');
  const [editStatus, setEditStatus] = useState<VehicleStatus>('AVAILABLE');
  const [editNotes, setEditNotes] = useState('');

  // Document modal (add or edit)
  const [showDocModal, setShowDocModal] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [editingDocId, setEditingDocId] = useState<number | undefined>(undefined);
  const [docType, setDocType] = useState<VehicleDocType>('ASSURANCE');
  const [docNumber, setDocNumber] = useState('');
  const [docIssueDate, setDocIssueDate] = useState('');
  const [docExpirationDate, setDocExpirationDate] = useState('');
  const [docReminderDays, setDocReminderDays] = useState('30');
  const [docNotes, setDocNotes] = useState('');

  // Block modal
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [savingBlock, setSavingBlock] = useState(false);
  const [blockType, setBlockType] = useState<'MAINTENANCE' | 'ADMIN_HOLD' | 'OTHER'>('MAINTENANCE');
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockReason, setBlockReason] = useState('');

  // Confirmations
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmReleaseBlockId, setConfirmReleaseBlockId] = useState<number | null>(null);
  const [releasingBlock, setReleasingBlock] = useState(false);

  const canWrite = hasPermission('vehicles:write');

  const syncEditFields = useCallback((data: VehicleProfileDto) => {
    const v = data.vehicle;
    setEditInternalCode(v.internalCode);
    setEditMatricule(v.matricule);
    setEditVin(v.vin ?? '');
    setEditBrand(v.brand);
    setEditModel(v.model);
    setEditYear(String(v.year));
    setEditColor(v.color);
    setEditCategory(v.category);
    setEditFuelType(v.fuelType);
    setEditTransmission(v.transmission);
    setEditSeats(String(v.seats));
    setEditOdometer(String(v.currentOdometerKm));
    setEditAcquisitionDate(v.acquisitionDate ?? '');
    setEditAcquisitionCostDzd(
      v.acquisitionCostMinor != null ? String(fromMinorUnits(v.acquisitionCostMinor)) : ''
    );
    setEditDailyDzd(String(fromMinorUnits(v.defaultDailyRateMinor)));
    setEditWeeklyDzd(v.defaultWeeklyRateMinor != null ? String(fromMinorUnits(v.defaultWeeklyRateMinor)) : '');
    setEditMonthlyDzd(v.defaultMonthlyRateMinor != null ? String(fromMinorUnits(v.defaultMonthlyRateMinor)) : '');
    setEditStatus(v.status);
    setEditNotes(v.notes ?? '');
  }, []);

  const loadProfile = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await erpClient.getVehicleProfile(Number(id));
      setProfile(data);
      syncEditFields(data);
      if (canViewVehicleFinance) {
        try {
          const fin = await erpClient.getVehicleFinanceSummary(Number(id));
          setFinanceSummary(fin);
        } catch {
          setFinanceSummary(null);
        }
      } else {
        setFinanceSummary(null);
      }
      if (canViewInspections) {
        try {
          const [dmgRows, inspRows] = await Promise.all([
            erpClient.listVehicleDamages({ vehicleId: Number(id) }),
            erpClient.listInspections({ vehicleId: Number(id) }),
          ]);
          setVehicleDamages(dmgRows);
          setVehicleInspections(inspRows);

          const inspectionsWithPhotos = inspRows.filter((i) => i.photoCount > 0).slice(0, 8);
          const photoCards: Array<{
            id: number;
            inspectionId: number;
            inspectionNumber: string;
            stage: string;
            inspectedAt: string;
            caption: string | null;
            originalFileName: string | null;
            dataUrl: string;
          }> = [];
          for (const insp of inspectionsWithPhotos) {
            const det = await erpClient.getInspectionDetail(insp.id);
            for (const ph of det.photos) {
              try {
                const raw = await erpClient.readInspectionPhoto(ph.id);
                photoCards.push({
                  id: ph.id,
                  inspectionId: insp.id,
                  inspectionNumber: insp.inspectionNumber,
                  stage: insp.stage,
                  inspectedAt: insp.inspectedAt,
                  caption: ph.caption,
                  originalFileName: ph.originalFileName,
                  dataUrl: `data:${raw.mimeType};base64,${raw.base64Data}`,
                });
              } catch {
                // Skip unreadable encrypted photo
              }
            }
          }
          setVehiclePhotos(photoCards);
        } catch {
          setVehicleDamages([]);
          setVehicleInspections([]);
          setVehiclePhotos([]);
        }
      }
      if (canViewMaintenance) {
        try {
          const ov = await erpClient.getVehicleMaintenanceOverview(Number(id));
          setMaintenanceOverview(ov);
        } catch {
          setMaintenanceOverview(null);
        }
      } else {
        setMaintenanceOverview(null);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [
    canViewInspections,
    canViewMaintenance,
    canViewVehicleFinance,
    id,
    showError,
    syncEditFields,
    t.common.error,
  ]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const openEditModal = () => {
    if (!profile) return;
    syncEditFields(profile);
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingEdit(true);
    try {
      await erpClient.updateVehicle({
        id: profile.vehicle.id,
        internalCode: editInternalCode.trim(),
        matricule: editMatricule.trim(),
        vin: editVin.trim() || null,
        brand: editBrand.trim(),
        model: editModel.trim(),
        year: Number(editYear),
        color: editColor.trim(),
        category: editCategory.trim(),
        fuelType: editFuelType,
        transmission: editTransmission,
        seats: Number(editSeats),
        currentOdometerKm: Number(editOdometer),
        acquisitionDate: editAcquisitionDate || null,
        acquisitionCostMinor: editAcquisitionCostDzd ? toMinorUnits(Number(editAcquisitionCostDzd)) : null,
        defaultDailyRateMinor: toMinorUnits(Number(editDailyDzd)),
        defaultWeeklyRateMinor: editWeeklyDzd ? toMinorUnits(Number(editWeeklyDzd)) : null,
        defaultMonthlyRateMinor: editMonthlyDzd ? toMinorUnits(Number(editMonthlyDzd)) : null,
        status: editStatus,
        notes: editNotes.trim() || null,
      });
      showSuccess(t.common.save);
      setShowEditModal(false);
      await loadProfile();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleArchive = async () => {
    if (!profile) return;
    setArchiving(true);
    try {
      await erpClient.archiveVehicle(profile.vehicle.id);
      showSuccess(t.vehicles.archiveVehicle);
      setConfirmArchive(false);
      navigate('/vehicles');
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setArchiving(false);
    }
  };

  const openAddDocModal = () => {
    setEditingDocId(undefined);
    setDocType('ASSURANCE');
    setDocNumber('');
    setDocIssueDate('');
    setDocExpirationDate('');
    setDocReminderDays('30');
    setDocNotes('');
    setShowDocModal(true);
  };

  const openEditDocModal = (doc: VehicleDocument) => {
    setEditingDocId(doc.id);
    setDocType(doc.docType);
    setDocNumber(doc.documentNumber ?? '');
    setDocIssueDate(doc.issueDate ?? '');
    setDocExpirationDate(doc.expirationDate);
    setDocReminderDays(String(doc.reminderDays));
    setDocNotes(doc.notes ?? '');
    setShowDocModal(true);
  };

  const handleSaveDoc = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingDoc(true);
    try {
      await erpClient.upsertVehicleDoc({
        id: editingDocId,
        vehicleId: profile.vehicle.id,
        docType,
        documentNumber: docNumber.trim() || null,
        issueDate: docIssueDate || null,
        expirationDate: docExpirationDate,
        reminderDays: Number(docReminderDays),
        notes: docNotes.trim() || null,
      });
      showSuccess(t.common.save);
      setShowDocModal(false);
      await loadProfile();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSavingDoc(false);
    }
  };

  const openAddBlockModal = () => {
    setBlockType('MAINTENANCE');
    setBlockStart('');
    setBlockEnd('');
    setBlockReason('');
    setShowBlockModal(true);
  };

  const handleCreateBlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const startVal = blockStart.length === 10 ? `${blockStart}T08:00` : blockStart;
    const endVal = blockEnd.length === 10 ? `${blockEnd}T18:00` : blockEnd;
    if (startVal && endVal && endVal <= startVal) {
      showError(t.dialogs.invalidDateRange);
      return;
    }
    setSavingBlock(true);
    try {
      await erpClient.createVehicleBlock({
        vehicleId: profile.vehicle.id,
        blockType,
        startDate: startVal,
        endDate: endVal,
        reason: blockReason.trim(),
      });
      showSuccess(t.common.save);
      setShowBlockModal(false);
      await loadProfile();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSavingBlock(false);
    }
  };

  const handleReleaseBlock = async () => {
    if (confirmReleaseBlockId == null) return;
    setReleasingBlock(true);
    try {
      await erpClient.releaseVehicleBlock(confirmReleaseBlockId);
      showSuccess(t.vehicles.blocks.released);
      setConfirmReleaseBlockId(null);
      await loadProfile();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setReleasingBlock(false);
    }
  };

  const handleDownloadMaintInvoice = async (recordId: number) => {
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

  const handleGenerateVehicleHistoryPdf = async () => {
    if (!profile) return;
    setGeneratingPdf(true);
    try {
      const res = await erpClient.generateDocument({
        documentKind: 'VEHICLE_HISTORY',
        vehicleId: profile.vehicle.id,
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

  if (loading || !profile) {
    return (
      <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
        {t.common.loading}
      </div>
    );
  }

  const { vehicle, documents, blockedPeriods, rentalHistory } = profile;

  const tabs: Array<{ key: VehicleTab; label: string }> = [
    { key: 'general', label: t.vehicles.tabs.general },
    { key: 'documents', label: t.vehicles.tabs.documents },
    { key: 'rentals', label: t.vehicles.tabs.rentals },
    { key: 'blocks', label: t.vehicles.tabs.blocks },
    { key: 'maintenance', label: t.vehicles.tabs.maintenance },
    { key: 'expenses', label: t.vehicles.tabs.expenses },
    { key: 'photos', label: t.vehicles.tabs.photos },
    { key: 'profitability', label: t.vehicles.tabs.profitability },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/vehicles"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          </Link>
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {vehicle.brand} {vehicle.model} ·{' '}
              <span className="font-mono-tabular">{formatDigits(vehicle.matricule, numerals)}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {vehicle.internalCode} · {vehicle.category} · {formatDigits(vehicle.year, numerals)} ·{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {t.vehicles.statuses[vehicle.status]}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canGenerateDoc && (
            <button
              type="button"
              disabled={generatingPdf}
              onClick={() => void handleGenerateVehicleHistoryPdf()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
              <span>{t.documents.triggers.vehicleHistoryPdf}</span>
            </button>
          )}
          {canWrite && !vehicle.isArchived && (
            <>
              <button
                type="button"
                onClick={openEditModal}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{t.vehicles.editVehicle}</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-950/30 whitespace-nowrap"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>{t.vehicles.archiveVehicle}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 8 Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap shrink-0 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'general' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 text-sm">
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.internalCode}</div>
              <div className="font-mono-tabular font-medium mt-0.5">{vehicle.internalCode}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.matricule}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {formatDigits(vehicle.matricule, numerals)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.vin}</div>
              <div className="font-mono-tabular font-medium mt-0.5">{vehicle.vin || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {t.vehicles.fuelType} / {t.vehicles.transmission}
              </div>
              <div className="font-medium mt-0.5">
                {t.vehicles.fuelTypes[vehicle.fuelType]} · {t.vehicles.transmissions[vehicle.transmission]} ·{' '}
                {formatDigits(vehicle.seats, numerals)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.color}</div>
              <div className="font-medium mt-0.5">{vehicle.color}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.odometer}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {formatDigits(vehicle.currentOdometerKm.toLocaleString(), numerals)} km
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.dailyRate}</div>
              <div className="font-mono-tabular font-semibold mt-0.5">
                {formatCurrencyMinor(vehicle.defaultDailyRateMinor, 'DZD', lang, numerals)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.weeklyRate}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {vehicle.defaultWeeklyRateMinor != null
                  ? formatCurrencyMinor(vehicle.defaultWeeklyRateMinor, 'DZD', lang, numerals)
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.monthlyRate}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {vehicle.defaultMonthlyRateMinor != null
                  ? formatCurrencyMinor(vehicle.defaultMonthlyRateMinor, 'DZD', lang, numerals)
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.acquisitionDate}</div>
              <div className="font-mono-tabular font-medium mt-0.5">{vehicle.acquisitionDate || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.vehicles.acquisitionCost}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {vehicle.acquisitionCostMinor != null
                  ? formatCurrencyMinor(vehicle.acquisitionCostMinor, 'DZD', lang, numerals)
                  : '—'}
              </div>
            </div>
            <div className="sm:col-span-2 md:col-span-3">
              <div className="text-xs text-slate-500">{t.vehicles.notes}</div>
              <div className="mt-0.5 text-slate-700 dark:text-slate-300">{vehicle.notes || '—'}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="space-y-4">
          {canWrite && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={openAddDocModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 dark:hover:bg-blue-600"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.dialogs.addVehicleDoc}</span>
              </button>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.vehicles.docs.docType}</th>
                    <th className="px-4 py-3 text-start">{t.vehicles.docs.docNumber}</th>
                    <th className="px-4 py-3 text-start">{t.vehicles.docs.issueDate}</th>
                    <th className="px-4 py-3 text-start">{t.vehicles.docs.expirationDate}</th>
                    <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                    {canWrite && <th className="px-4 py-3 text-end">{t.users.actions}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {documents.length === 0 ? (
                    <tr>
                      <td colSpan={canWrite ? 6 : 5} className="px-4 py-8 text-center text-slate-500">
                        <FileText className="w-5 h-5 mx-auto mb-1 opacity-50" />
                        {t.vehicles.docs.empty}
                      </td>
                    </tr>
                  ) : (
                    documents.map((doc) => {
                      const state = getDocExpiryState(doc.expirationDate, doc.reminderDays);
                      return (
                        <tr key={doc.id}>
                          <td className="px-4 py-3 font-medium">
                            <div>{t.vehicles.docs.types[doc.docType]}</div>
                            {doc.notes && (
                              <div className="text-xs text-slate-500 dark:text-slate-400">{doc.notes}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono-tabular text-xs">{doc.documentNumber || '—'}</td>
                          <td className="px-4 py-3 font-mono-tabular text-xs">{doc.issueDate || '—'}</td>
                          <td className="px-4 py-3 font-mono-tabular text-xs">{doc.expirationDate}</td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            {state === 'expired' ? (
                              <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {t.vehicles.docs.expired}
                              </span>
                            ) : state === 'soon' ? (
                              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {t.vehicles.docs.expiringSoon}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {t.vehicles.docs.valid}
                              </span>
                            )}
                          </td>
                          {canWrite && (
                            <td className="px-4 py-3 text-end">
                              <button
                                type="button"
                                onClick={() => openEditDocModal(doc)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>{t.dialogs.editAction}</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'rentals' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-start">{t.contracts.contractNumber}</th>
                  <th className="px-4 py-3 text-start">{t.nav.customers}</th>
                  <th className="px-4 py-3 text-start">{t.planning.viewWeek}</th>
                  <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                  <th className="px-4 py-3 text-end">{t.contracts.totalContract}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rentalHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      —
                    </td>
                  </tr>
                ) : (
                  rentalHistory.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-mono-tabular font-medium">
                        <Link to={`/contracts/${r.id}`} className="text-blue-700 dark:text-blue-400 hover:underline">
                          {r.contractNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{r.customerName}</td>
                      <td className="px-4 py-3 font-mono-tabular text-xs">
                        {formatDateTimeAlgiers(r.startDate, lang, numerals)} →{' '}
                        {formatDateTimeAlgiers(r.actualReturnDate ?? r.expectedReturnDate, lang, numerals)}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">{t.contracts.statuses[r.status]}</td>
                      <td className="px-4 py-3 text-end font-mono-tabular font-medium">
                        {formatCurrencyMinor(r.totalContractAmountMinor, r.currency, lang, numerals)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'blocks' && (
        <div className="space-y-4">
          {canWrite && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={openAddBlockModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 dark:hover:bg-blue-600"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.vehicles.blocks.addBlock}</span>
              </button>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.vehicles.blocks.blockType}</th>
                    <th className="px-4 py-3 text-start">
                      {t.vehicles.blocks.startDate} → {t.vehicles.blocks.endDate}
                    </th>
                    <th className="px-4 py-3 text-start">{t.vehicles.blocks.reason}</th>
                    <th className="px-4 py-3 text-end">{t.users.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {blockedPeriods.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        <CalendarOff className="w-5 h-5 mx-auto mb-1 opacity-50" />
                        {t.vehicles.blocks.empty}
                      </td>
                    </tr>
                  ) : (
                    blockedPeriods.map((b) => (
                      <tr key={b.id} className={!b.isActive ? 'opacity-50' : ''}>
                        <td className="px-4 py-3 text-xs font-semibold">
                          {t.vehicles.blocks.types[b.blockType]} ·{' '}
                          {b.isActive ? t.vehicles.blocks.active : t.vehicles.blocks.released}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-xs">
                          {formatDateTimeAlgiers(b.startDate, lang, numerals)} →{' '}
                          {formatDateTimeAlgiers(b.endDate, lang, numerals)}
                        </td>
                        <td className="px-4 py-3 text-xs">{b.reason}</td>
                        <td className="px-4 py-3 text-end">
                          {b.isActive && canWrite && (
                            <button
                              type="button"
                              onClick={() => setConfirmReleaseBlockId(b.id)}
                              className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {t.vehicles.blocks.release}
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
        </div>
      )}

      {activeTab === 'expenses' && (
        canViewVehicleFinance ? (
          <ExpensesTab defaultVehicleId={vehicle.id} />
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center">
            <Lock className="w-6 h-6 mx-auto mb-2 text-slate-400" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t.finance.reports.noExpensePermissionNotice}
            </p>
          </div>
        )
      )}

      {activeTab === 'profitability' && (
        !canViewVehicleFinance ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center">
            <Lock className="w-6 h-6 mx-auto mb-2 text-slate-400" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t.finance.reports.noExpensePermissionNotice}
            </p>
          </div>
        ) : financeSummary ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-500">{t.finance.reports.vehicleRevenue}</div>
                <div className="font-mono-tabular text-lg font-bold mt-1 text-slate-900 dark:text-slate-100">
                  {formatCurrencyMinor(financeSummary.profitability.rentalRevenueMinor, 'DZD', lang, numerals)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
                  {formatDigits(financeSummary.profitability.contractCount, numerals)} ·{' '}
                  {formatDigits(financeSummary.profitability.rentedDays, numerals)} {t.common.days}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-500">{t.finance.reports.netCollected}</div>
                <div className="font-mono-tabular text-lg font-bold mt-1 text-emerald-700 dark:text-emerald-400">
                  {formatCurrencyMinor(financeSummary.profitability.collectedMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-500">{t.finance.reports.vehicleExpenses}</div>
                <div className="font-mono-tabular text-lg font-bold mt-1 text-rose-700 dark:text-rose-400">
                  {formatCurrencyMinor(financeSummary.profitability.expensesMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-500">{t.finance.reports.netProfit}</div>
                <div
                  className={`font-mono-tabular text-lg font-bold mt-1 ${
                    financeSummary.profitability.netProfitMinor >= 0
                      ? 'text-blue-900 dark:text-blue-300'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {formatCurrencyMinor(financeSummary.profitability.netProfitMinor, 'DZD', lang, numerals)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
                  {t.finance.reports.roi}:{' '}
                  {financeSummary.profitability.roiPercent != null
                    ? `${formatDigits(financeSummary.profitability.roiPercent.toFixed(1), numerals)}%`
                    : '—'}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t.finance.reports.finesSummary}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 font-mono-tabular">
                  {formatCurrencyMinor(financeSummary.totalFinesMinor, 'DZD', lang, numerals)} ·{' '}
                  {t.finance.deposits.unpaidStatus}:{' '}
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    {formatCurrencyMinor(financeSummary.unpaidFinesMinor, 'DZD', lang, numerals)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('expenses')}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {t.vehicles.tabs.expenses} ({formatDigits(financeSummary.expenses.length, numerals)})
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-sm text-slate-500">
            {t.common.loading}
          </div>
        )
      )}

      {activeTab === 'photos' && (
        <div className="space-y-6">
          {/* Damage History */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                {t.inspections.tabDamages} ({formatDigits(vehicleDamages.length, numerals)})
              </span>
              <Link
                to="/inspections"
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
              >
                {t.inspections.title}
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-start">Code</th>
                    <th className="px-4 py-2.5 text-start">{t.inspections.selectedZone}</th>
                    <th className="px-4 py-2.5 text-start">{t.inspections.damageDescription}</th>
                    <th className="px-4 py-2.5 text-start">{t.vehicles.statusLabel}</th>
                    <th className="px-4 py-2.5 text-end">{t.users.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {vehicleDamages.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        {t.inspections.emptyDamages}
                      </td>
                    </tr>
                  ) : (
                    vehicleDamages.map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-2.5 font-mono-tabular font-semibold">
                          <div>{d.damageCode}</div>
                          {d.contractNumber && d.contractId && (
                            <Link
                              to={`/contracts/${d.contractId}`}
                              className="text-[11px] font-normal text-blue-700 dark:text-blue-400 hover:underline"
                            >
                              {d.contractNumber}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div>{getDiagramZoneLabel(d.zoneCode, lang)}</div>
                          <div className="text-[11px] text-slate-500">
                            {t.inspections.damageTypes[d.damageType]} ·{' '}
                            {t.inspections.damageSeverities[d.severity]}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 max-w-sm">
                          <div>{d.description}</div>
                          <div className="text-[11px] text-slate-500 font-mono-tabular">
                            {formatDateTimeAlgiers(d.reportedAt, lang, numerals)}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">{t.inspections.damageStatuses[d.status]}</td>
                        <td className="px-4 py-2.5 text-end">
                          <button
                            type="button"
                            onClick={() => setSelectedDamage(d)}
                            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {t.common.view}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Inspection Photos Gallery */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                {t.inspections.photosTitle} ({formatDigits(vehiclePhotos.length, numerals)})
              </h3>
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <ClipboardCheck className="w-3.5 h-3.5" />
                {formatDigits(vehicleInspections.length, numerals)} {t.inspections.tabInspections}
              </span>
            </div>
            {vehiclePhotos.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">—</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {vehiclePhotos.map((ph) => (
                  <div
                    key={ph.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50 dark:bg-slate-950"
                  >
                    <img
                      src={ph.dataUrl}
                      alt={ph.caption || ph.originalFileName || ph.inspectionNumber}
                      className="w-full h-36 object-cover"
                    />
                    <div className="p-2.5 text-[11px] space-y-0.5">
                      <div className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
                        {ph.inspectionNumber} ·{' '}
                        {ph.stage === 'DEPARTURE'
                          ? t.inspections.stageDeparture
                          : t.inspections.stageReturn}
                      </div>
                      <div className="truncate text-slate-600 dark:text-slate-400">
                        {ph.caption || ph.originalFileName || '—'}
                      </div>
                      <div className="font-mono-tabular text-slate-400">
                        {formatDateTimeAlgiers(ph.inspectedAt, lang, numerals)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'maintenance' && (
        <div className="space-y-6">
          {/* Active Vehicle Operational Alerts */}
          {maintenanceOverview && maintenanceOverview.alerts.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span>
                    {t.alerts.panelTitle} ({formatDigits(maintenanceOverview.alerts.length, numerals)})
                  </span>
                </div>
                {canCreateMaintenance && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMaintId(null);
                      setDefaultMaintTypeId(undefined);
                      setMaintModalOpen(true);
                    }}
                    className="px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white text-[11px] font-medium"
                  >
                    {t.maintenance.scheduleActionBtn}
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {maintenanceOverview.alerts.map((al) => (
                  <div
                    key={al.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white/80 dark:bg-slate-900/80 px-3 py-2 rounded-lg border border-amber-200/70 dark:border-amber-900/60"
                  >
                    <div>
                      <span
                        className={`inline-block me-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          al.severity === 'CRITICAL'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {t.alerts.severities[al.severity]}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {lang === 'ar' ? al.titleAr : al.titleFr}
                      </span>
                      <span className="text-slate-600 dark:text-slate-400 ms-2">
                        {lang === 'ar' ? al.messageAr : al.messageFr}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Header Action */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-blue-800 dark:text-blue-400" />
              <span>{t.maintenance.scheduleTitle}</span>
            </h3>
            {canCreateMaintenance && !vehicle.isArchived && (
              <button
                type="button"
                onClick={() => {
                  setEditingMaintId(null);
                  setDefaultMaintTypeId(undefined);
                  setMaintModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 dark:hover:bg-blue-600"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.maintenance.newIntervention}</span>
              </button>
            )}
          </div>

          {/* Preventive Maintenance Schedule Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.maintenance.maintenanceType}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.lastDone}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.nextDue}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.remaining}</th>
                    <th className="px-4 py-3 text-start">{t.maintenance.statusLabel}</th>
                    <th className="px-4 py-3 text-end">{t.users.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {!maintenanceOverview || maintenanceOverview.dueSummary.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        {t.maintenance.emptyDueSummary}
                      </td>
                    </tr>
                  ) : (
                    maintenanceOverview.dueSummary.map((item) => (
                      <tr key={item.maintenanceTypeId} className={!item.isScheduleActive ? 'opacity-55' : ''}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
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
                            <span className="ms-1">
                              (
                              {!item.isScheduleActive
                                ? t.maintenance.inactiveScheduleBadge
                                : item.hasCustomSchedule
                                  ? t.maintenance.customScheduleBadge
                                  : t.maintenance.defaultScheduleBadge}
                              )
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-tabular">
                          {item.lastPerformedDate ? (
                            <>
                              <div>{formatDigits(item.lastPerformedDate, numerals)}</div>
                              {item.lastOdometerKm != null && (
                                <div className="text-[11px] text-slate-500">
                                  {formatDigits(item.lastOdometerKm.toLocaleString(), numerals)} km
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">{t.maintenance.neverDone}</span>
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
                            className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                              item.alertState === 'OVERDUE'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                : item.alertState === 'DUE'
                                  ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300'
                                  : item.alertState === 'APPROACHING'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                            }`}
                          >
                            {t.maintenance.alertStates[item.alertState]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            {canCustomizeMaintSchedule && (
                              <button
                                type="button"
                                onClick={() => setScheduleModalItem(item)}
                                title={t.maintenance.customizeSchedule}
                                className="p-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Settings2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canCreateMaintenance && !vehicle.isArchived && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMaintId(null);
                                  setDefaultMaintTypeId(item.maintenanceTypeId);
                                  setMaintModalOpen(true);
                                }}
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

          {/* Maintenance History Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t.maintenance.tabInterventions} (
                {formatDigits(maintenanceOverview?.records.length ?? 0, numerals)})
              </span>
              <Link
                to="/maintenance"
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
              >
                {t.maintenance.title}
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-start">{t.maintenance.recordNumber}</th>
                    <th className="px-4 py-2.5 text-start">{t.maintenance.maintenanceType}</th>
                    <th className="px-4 py-2.5 text-start">{t.maintenance.statusLabel}</th>
                    <th className="px-4 py-2.5 text-start">{t.maintenance.performedDate}</th>
                    <th className="px-4 py-2.5 text-end">{t.maintenance.odometerKm}</th>
                    <th className="px-4 py-2.5 text-end">{t.maintenance.totalCostDzd}</th>
                    <th className="px-4 py-2.5 text-end">{t.users.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {!maintenanceOverview || maintenanceOverview.records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                        {t.maintenance.emptyRecords}
                      </td>
                    </tr>
                  ) : (
                    maintenanceOverview.records.map((rec) => (
                      <tr key={rec.id}>
                        <td className="px-4 py-2.5 font-mono-tabular font-semibold">
                          <div>{rec.recordNumber}</div>
                          {rec.isEmergency && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 text-[10px]">
                              {t.maintenance.emergencyBadge}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 max-w-xs">
                          <div className="font-medium">
                            {lang === 'ar' ? rec.maintenanceTypeNameAr : rec.maintenanceTypeNameFr}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">{rec.workDescription}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-medium">
                            {t.maintenance.statuses[rec.status as MaintenanceStatus]}
                          </span>
                          {rec.linkedExpenseNumber && (
                            <div className="text-[10px] font-mono-tabular text-emerald-700 dark:text-emerald-400">
                              {rec.linkedExpenseNumber}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono-tabular">
                          {formatDigits(rec.performedDate, numerals)}
                        </td>
                        <td className="px-4 py-2.5 text-end font-mono-tabular">
                          {formatDigits(rec.odometerKm.toLocaleString(), numerals)} km
                        </td>
                        <td className="px-4 py-2.5 text-end font-mono-tabular font-semibold">
                          {formatCurrencyMinor(rec.totalCostMinor, 'DZD', lang, numerals)}
                        </td>
                        <td className="px-4 py-2.5 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            {rec.invoiceFilePath && (
                              <button
                                type="button"
                                onClick={() => void handleDownloadMaintInvoice(rec.id)}
                                title={rec.invoiceOriginalName || t.maintenance.viewInvoice}
                                className="p-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canUpdateMaintenance && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMaintId(rec.id);
                                  setDefaultMaintTypeId(undefined);
                                  setMaintModalOpen(true);
                                }}
                                className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                {t.dialogs.editAction}
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

      {/* Edit Vehicle Modal (Full fields) */}
      <ModalDialog
        open={showEditModal}
        onClose={() => {
          if (!savingEdit) setShowEditModal(false);
        }}
        title={t.vehicles.editVehicle}
        subtitle={`${vehicle.brand} ${vehicle.model} · ${vehicle.matricule}`}
        size="lg"
        disableClose={savingEdit}
        onSubmit={handleSaveEdit}
        footer={
          <>
            <button
              type="button"
              disabled={savingEdit}
              onClick={() => setShowEditModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={savingEdit}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {savingEdit ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.internalCode} *</label>
            <input
              required
              data-autofocus
              dir="ltr"
              value={editInternalCode}
              onChange={(e) => setEditInternalCode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.matricule} *</label>
            <input
              required
              dir="ltr"
              value={editMatricule}
              onChange={(e) => setEditMatricule(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.vin}</label>
            <input
              dir="ltr"
              value={editVin}
              onChange={(e) => setEditVin(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.brand} *</label>
            <input
              required
              value={editBrand}
              onChange={(e) => setEditBrand(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.model} *</label>
            <input
              required
              value={editModel}
              onChange={(e) => setEditModel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.year} *</label>
            <input
              type="number"
              required
              min={1980}
              max={2035}
              dir="ltr"
              value={editYear}
              onChange={(e) => setEditYear(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.color} *</label>
            <input
              required
              value={editColor}
              onChange={(e) => setEditColor(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.category} *</label>
            <select
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {VEHICLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.fuelType}</label>
            <select
              value={editFuelType}
              onChange={(e) => setEditFuelType(e.target.value as VehicleFuelType)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="ESSENCE">{t.vehicles.fuelTypes.ESSENCE}</option>
              <option value="DIESEL">{t.vehicles.fuelTypes.DIESEL}</option>
              <option value="GPL">{t.vehicles.fuelTypes.GPL}</option>
              <option value="OTHER">{t.vehicles.fuelTypes.OTHER}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.transmission}</label>
            <select
              value={editTransmission}
              onChange={(e) => setEditTransmission(e.target.value as VehicleTransmission)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="MANUAL">{t.vehicles.transmissions.MANUAL}</option>
              <option value="AUTOMATIC">{t.vehicles.transmissions.AUTOMATIC}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.seats}</label>
            <input
              type="number"
              min={2}
              max={9}
              dir="ltr"
              value={editSeats}
              onChange={(e) => setEditSeats(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.odometer} *</label>
            <input
              type="number"
              min={0}
              required
              dir="ltr"
              value={editOdometer}
              onChange={(e) => setEditOdometer(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.statusLabel}</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as VehicleStatus)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="AVAILABLE">{t.vehicles.statuses.AVAILABLE}</option>
              <option value="RESERVED">{t.vehicles.statuses.RESERVED}</option>
              <option value="MAINTENANCE">{t.vehicles.statuses.MAINTENANCE}</option>
              <option value="RENTED">{t.vehicles.statuses.RENTED}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.dailyRate} *</label>
            <input
              type="number"
              min={0}
              required
              dir="ltr"
              value={editDailyDzd}
              onChange={(e) => setEditDailyDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.weeklyRate}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={editWeeklyDzd}
              onChange={(e) => setEditWeeklyDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.monthlyRate}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={editMonthlyDzd}
              onChange={(e) => setEditMonthlyDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.acquisitionDate}</label>
            <input
              type="date"
              dir="ltr"
              value={editAcquisitionDate}
              onChange={(e) => setEditAcquisitionDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.acquisitionCost}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={editAcquisitionCostDzd}
              onChange={(e) => setEditAcquisitionCostDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.vehicles.notes}</label>
          <textarea
            rows={2}
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Add / Edit Vehicle Document Modal */}
      <ModalDialog
        open={showDocModal}
        onClose={() => {
          if (!savingDoc) setShowDocModal(false);
        }}
        title={editingDocId ? t.dialogs.editVehicleDoc : t.dialogs.addVehicleDoc}
        subtitle={`${vehicle.brand} ${vehicle.model} · ${vehicle.matricule}`}
        size="md"
        disableClose={savingDoc}
        onSubmit={handleSaveDoc}
        footer={
          <>
            <button
              type="button"
              disabled={savingDoc}
              onClick={() => setShowDocModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={savingDoc}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {savingDoc ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.docs.docType}</label>
            <select
              data-autofocus
              value={docType}
              onChange={(e) => setDocType(e.target.value as VehicleDocType)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="CARTE_GRISE">{t.vehicles.docs.types.CARTE_GRISE}</option>
              <option value="ASSURANCE">{t.vehicles.docs.types.ASSURANCE}</option>
              <option value="VIGNETTE">{t.vehicles.docs.types.VIGNETTE}</option>
              <option value="CONTROLE_TECHNIQUE">{t.vehicles.docs.types.CONTROLE_TECHNIQUE}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.docs.docNumber}</label>
            <input
              dir="ltr"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.docs.issueDate}</label>
            <input
              type="date"
              dir="ltr"
              value={docIssueDate}
              onChange={(e) => setDocIssueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.docs.expirationDate} *</label>
            <input
              type="date"
              required
              dir="ltr"
              value={docExpirationDate}
              onChange={(e) => setDocExpirationDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.docs.reminderDays}</label>
            <input
              type="number"
              min={0}
              max={365}
              dir="ltr"
              value={docReminderDays}
              onChange={(e) => setDocReminderDays(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.vehicles.notes}</label>
          <textarea
            rows={2}
            value={docNotes}
            onChange={(e) => setDocNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Create Blocked Period Modal */}
      <ModalDialog
        open={showBlockModal}
        onClose={() => {
          if (!savingBlock) setShowBlockModal(false);
        }}
        title={t.vehicles.blocks.addBlock}
        subtitle={`${vehicle.brand} ${vehicle.model} · ${vehicle.matricule}`}
        size="md"
        disableClose={savingBlock}
        onSubmit={handleCreateBlock}
        footer={
          <>
            <button
              type="button"
              disabled={savingBlock}
              onClick={() => setShowBlockModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={savingBlock}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {savingBlock ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.blockType}</label>
          <select
            data-autofocus
            value={blockType}
            onChange={(e) => setBlockType(e.target.value as 'MAINTENANCE' | 'ADMIN_HOLD' | 'OTHER')}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            <option value="MAINTENANCE">{t.vehicles.blocks.types.MAINTENANCE}</option>
            <option value="ADMIN_HOLD">{t.vehicles.blocks.types.ADMIN_HOLD}</option>
            <option value="OTHER">{t.vehicles.blocks.types.OTHER}</option>
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.startDate} *</label>
            <input
              type="datetime-local"
              required
              dir="ltr"
              value={blockStart}
              onChange={(e) => setBlockStart(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.endDate} *</label>
            <input
              type="datetime-local"
              required
              dir="ltr"
              value={blockEnd}
              onChange={(e) => setBlockEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.reason} *</label>
          <textarea
            rows={2}
            required
            minLength={3}
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Archive Vehicle Confirmation */}
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={handleArchive}
        tone="danger"
        loading={archiving}
        title={t.dialogs.archiveVehicleTitle}
        description={t.dialogs.archiveVehicleDesc}
        warningText={t.dialogs.archiveVehicleWarn}
        confirmLabel={t.vehicles.archiveVehicle}
      />

      {/* Release Blocked Period Confirmation */}
      <ConfirmDialog
        open={confirmReleaseBlockId != null}
        onClose={() => setConfirmReleaseBlockId(null)}
        onConfirm={handleReleaseBlock}
        tone="warning"
        loading={releasingBlock}
        title={t.dialogs.releaseBlockTitle}
        description={t.dialogs.releaseBlockDesc}
        confirmLabel={t.vehicles.blocks.release}
      />

      <DamageResolutionModal
        open={Boolean(selectedDamage)}
        damage={selectedDamage}
        onClose={() => setSelectedDamage(null)}
        onUpdated={() => void loadProfile()}
      />

      <MaintenanceRecordModal
        open={maintModalOpen}
        recordId={editingMaintId}
        defaultVehicleId={vehicle.id}
        defaultMaintenanceTypeId={defaultMaintTypeId}
        onClose={() => setMaintModalOpen(false)}
        onSaved={() => void loadProfile()}
      />

      {scheduleModalItem && (
        <MaintenanceScheduleModal
          open={Boolean(scheduleModalItem)}
          vehicleId={vehicle.id}
          item={scheduleModalItem}
          onClose={() => setScheduleModalItem(null)}
          onSaved={() => void loadProfile()}
        />
      )}

      <DocumentPreviewModal
        open={docPreviewOpen}
        onClose={() => setDocPreviewOpen(false)}
        initialDocument={generatedDoc}
        initialPdfBase64={generatedPdfBase64}
      />
    </div>
  );
}
