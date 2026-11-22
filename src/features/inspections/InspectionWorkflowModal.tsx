import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileDown,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import {
  DEFAULT_INSPECTION_CHECKLIST,
  VEHICLE_DIAGRAM_ZONES,
  getDiagramZoneLabel,
  type VehicleDiagramZoneCode,
} from '../../../shared/constants/inspections.ts';
import type {
  DamageSeverity,
  DamageType,
  InspectionItemCondition,
  InspectionStage,
} from '../../../shared/types/domain.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type ContractInspectionsDto,
  type InspectionDetailDto,
} from '../../lib/apiClient.ts';
import { formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';
import { exportDamageComparisonPdf, exportInspectionPdf } from '../../lib/pdfExport.ts';
import { SignaturePad } from './SignaturePad.tsx';
import { VehicleDamageDiagram, type DiagramPin } from './VehicleDamageDiagram.tsx';

interface InspectionWorkflowModalProps {
  open: boolean;
  contractId: number | null;
  stage: InspectionStage;
  inspectionId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}

interface DraftChecklistItem {
  itemKey: string;
  category: string;
  labelFr: string;
  labelAr: string;
  condition: InspectionItemCondition;
  notes: string;
  sortOrder: number;
}

interface DraftDamage {
  zoneCode: string;
  diagramX: number;
  diagramY: number;
  damageType: DamageType;
  severity: DamageSeverity;
  description: string;
  isPreExisting: boolean;
  isNewlyDiscovered: boolean;
  estimatedRepairCostDzd: string;
}

function toLocalDateTimeInput(input?: string | null): string {
  const d = input ? new Date(input) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function InspectionWorkflowModal({
  open,
  contractId,
  stage,
  inspectionId,
  onClose,
  onSaved,
}: InspectionWorkflowModalProps) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const canCreate = hasPermission('inspections:create') || hasPermission('inspections:write');
  const canUpdate = hasPermission('inspections:update') || hasPermission('inspections:write');
  const canFinalize = hasPermission('inspections:finalize') || hasPermission('inspections:write');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<InspectionDetailDto | null>(null);
  const [contractCtx, setContractCtx] = useState<ContractInspectionsDto | null>(null);
  const [contractMeta, setContractMeta] = useState<{
    contractNumber: string;
    vehicleId: number;
    vehicleLabel: string;
    vehicleMatricule: string;
    customerName: string;
    departureOdometerKm: number;
    expectedReturnDate: string;
  } | null>(null);

  // Form state
  const [odometerKm, setOdometerKm] = useState('0');
  const [fuelLevelPercent, setFuelLevelPercent] = useState(75);
  const [inspectedAt, setInspectedAt] = useState(() => toLocalDateTimeInput());
  const [exteriorNotes, setExteriorNotes] = useState('');
  const [interiorNotes, setInteriorNotes] = useState('');
  const [customerAcknowledged, setCustomerAcknowledged] = useState(false);
  const [customerAckNotes, setCustomerAckNotes] = useState('');
  const [agencySig, setAgencySig] = useState<string | null>(null);
  const [customerSig, setCustomerSig] = useState<string | null>(null);
  const [items, setItems] = useState<DraftChecklistItem[]>([]);
  const [pendingDamages, setPendingDamages] = useState<DraftDamage[]>([]);

  // Damage builder
  const [dmgZone, setDmgZone] = useState<VehicleDiagramZoneCode>('FRONT_BUMPER');
  const [dmgPoint, setDmgPoint] = useState<{ x: number; y: number }>({ x: 50, y: 8 });
  const [dmgType, setDmgType] = useState<DamageType>('SCRATCH');
  const [dmgSeverity, setDmgSeverity] = useState<DamageSeverity>('MINOR');
  const [dmgDesc, setDmgDesc] = useState('');
  const [dmgEstimatedDzd, setDmgEstimatedDzd] = useState('');
  const [dmgPreExisting, setDmgPreExisting] = useState(stage === 'DEPARTURE');

  // Photos (decrypted data URL cache)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});
  const [photoCaption, setPhotoCaption] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [deletePhotoId, setDeletePhotoId] = useState<number | null>(null);

  // Confirm finalize
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loadContext = useCallback(async () => {
    if (!open) return;
    if (!inspectionId && !contractId) return;
    setLoading(true);
    try {
      let loadedDetail: InspectionDetailDto | null = null;
      let targetContractId = contractId;

      if (inspectionId) {
        loadedDetail = await erpClient.getInspectionDetail(inspectionId);
        targetContractId = loadedDetail.contract.id;
      }

      if (targetContractId) {
        const [ctx, cDetail] = await Promise.all([
          erpClient.getContractInspections(targetContractId),
          erpClient.getContractDetail(targetContractId),
        ]);
        setContractCtx(ctx);
        setContractMeta({
          contractNumber: cDetail.contract.contractNumber,
          vehicleId: cDetail.contract.vehicleId,
          vehicleLabel: cDetail.contract.vehicleLabel,
          vehicleMatricule: loadedDetail?.vehicle.matricule ?? '',
          customerName: cDetail.contract.customerName,
          departureOdometerKm: cDetail.contract.departureOdometerKm,
          expectedReturnDate: cDetail.contract.expectedReturnDate,
        });

        if (!loadedDetail) {
          loadedDetail = stage === 'DEPARTURE' ? ctx.departure : ctx.returnInspection;
        }
      }

      if (loadedDetail) {
        setDetail(loadedDetail);
        setOdometerKm(String(loadedDetail.inspection.odometerKm));
        setFuelLevelPercent(loadedDetail.inspection.fuelLevelPercent);
        setInspectedAt(toLocalDateTimeInput(loadedDetail.inspection.inspectedAt));
        setExteriorNotes(loadedDetail.inspection.exteriorNotes ?? '');
        setInteriorNotes(loadedDetail.inspection.interiorNotes ?? '');
        setCustomerAcknowledged(loadedDetail.inspection.customerAcknowledged);
        setCustomerAckNotes(loadedDetail.inspection.customerAcknowledgmentNotes ?? '');
        setAgencySig(loadedDetail.inspection.agencySignatureData);
        setCustomerSig(loadedDetail.inspection.customerSignatureData);
        setItems(
          loadedDetail.items.map((it) => ({
            itemKey: it.itemKey,
            category: it.category,
            labelFr: it.labelFr,
            labelAr: it.labelAr,
            condition: it.condition,
            notes: it.notes ?? '',
            sortOrder: it.sortOrder,
          }))
        );
        setPendingDamages([]);
        // Load photo previews
        const map: Record<number, string> = {};
        for (const p of loadedDetail.photos) {
          try {
            const dec = await erpClient.readInspectionPhoto(p.id);
            map[p.id] = `data:${dec.mimeType};base64,${dec.base64Data}`;
          } catch {
            // Skip unreadable
          }
        }
        setPhotoUrls(map);
      } else {
        setDetail(null);
        setPhotoUrls({});
        setPendingDamages([]);
        setExteriorNotes('');
        setInteriorNotes('');
        setCustomerAcknowledged(false);
        setCustomerAckNotes('');
        setAgencySig(null);
        setCustomerSig(null);
        setInspectedAt(toLocalDateTimeInput());
        setDmgPreExisting(stage === 'DEPARTURE');
        setItems(
          DEFAULT_INSPECTION_CHECKLIST.map((tpl) => ({
            itemKey: tpl.itemKey,
            category: tpl.category,
            labelFr: tpl.labelFr,
            labelAr: tpl.labelAr,
            condition: 'GOOD',
            notes: '',
            sortOrder: tpl.sortOrder,
          }))
        );
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [contractId, inspectionId, open, showError, stage, t.common.error]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  // Seed initial odometer / fuel for a brand-new inspection
  useEffect(() => {
    if (!open || detail || !contractMeta) return;
    const dep = contractCtx?.departure?.inspection;
    if (stage === 'RETURN' && dep) {
      setOdometerKm(String(dep.odometerKm));
      setFuelLevelPercent(dep.fuelLevelPercent);
    } else {
      setOdometerKm(String(contractMeta.departureOdometerKm));
      setFuelLevelPercent(75);
    }
  }, [contractCtx, contractMeta, detail, open, stage]);

  const effectiveStage = detail?.inspection.stage ?? stage;
  const isFinalized = detail?.inspection.status === 'FINALIZED';
  const readOnly = isFinalized || (detail ? !canUpdate : !canCreate);

  const depInspection = contractCtx?.departure ?? null;
  const depItemMap = new Map<string, InspectionItemCondition>();
  if (depInspection) {
    for (const it of depInspection.items) {
      depItemMap.set(it.itemKey, it.condition);
    }
  }

  const handleAddDamage = async () => {
    if (readOnly || !dmgDesc.trim()) return;
    if (detail) {
      try {
        await erpClient.addVehicleDamage({
          vehicleId: detail.vehicle.id,
          contractId: detail.contract.id,
          inspectionId: detail.inspection.id,
          zoneCode: dmgZone,
          diagramX: dmgPoint.x,
          diagramY: dmgPoint.y,
          damageType: dmgType,
          severity: dmgSeverity,
          description: dmgDesc.trim(),
          isPreExisting: dmgPreExisting,
          isNewlyDiscovered: effectiveStage === 'RETURN' && !dmgPreExisting,
          estimatedRepairCostMinor: dmgEstimatedDzd ? toMinorUnits(Number(dmgEstimatedDzd)) : null,
        });
        setDmgDesc('');
        setDmgEstimatedDzd('');
        showSuccess(t.inspections.addDamageBtn);
        await loadContext();
        onSaved();
      } catch (err) {
        showError(err instanceof Error ? err.message : t.common.error);
      }
    } else {
      setPendingDamages((prev) => [
        ...prev,
        {
          zoneCode: dmgZone,
          diagramX: dmgPoint.x,
          diagramY: dmgPoint.y,
          damageType: dmgType,
          severity: dmgSeverity,
          description: dmgDesc.trim(),
          isPreExisting: dmgPreExisting,
          isNewlyDiscovered: effectiveStage === 'RETURN' && !dmgPreExisting,
          estimatedRepairCostDzd: dmgEstimatedDzd,
        },
      ]);
      setDmgDesc('');
      setDmgEstimatedDzd('');
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setSaving(true);
    try {
      if (!detail) {
        if (!contractId) return;
        const created = await erpClient.createInspection({
          contractId,
          stage: effectiveStage,
          odometerKm: Number(odometerKm || 0),
          fuelLevelPercent,
          exteriorNotes: exteriorNotes.trim() || null,
          interiorNotes: interiorNotes.trim() || null,
          agencySignatureData: agencySig,
          customerSignatureData: customerSig,
          customerAcknowledged,
          customerAcknowledgmentNotes: customerAckNotes.trim() || null,
          inspectedAt: inspectedAt || new Date().toISOString(),
          finalizeNow: false,
          items: items.map((it) => ({
            itemKey: it.itemKey,
            category: it.category,
            labelFr: it.labelFr,
            labelAr: it.labelAr,
            condition: it.condition,
            notes: it.notes.trim() || null,
            sortOrder: it.sortOrder,
          })),
          damages: pendingDamages.map((d) => ({
            zoneCode: d.zoneCode,
            diagramX: d.diagramX,
            diagramY: d.diagramY,
            damageType: d.damageType,
            severity: d.severity,
            description: d.description,
            isPreExisting: d.isPreExisting,
            isNewlyDiscovered: d.isNewlyDiscovered,
            estimatedRepairCostMinor: d.estimatedRepairCostDzd
              ? toMinorUnits(Number(d.estimatedRepairCostDzd))
              : null,
          })),
        });
        setDetail(created);
        setPendingDamages([]);
        showSuccess(t.inspections.saveDraftBtn);
        await loadContext();
        onSaved();
      } else {
        await erpClient.updateInspectionDraft({
          inspectionId: detail.inspection.id,
          odometerKm: Number(odometerKm || 0),
          fuelLevelPercent,
          exteriorNotes: exteriorNotes.trim() || null,
          interiorNotes: interiorNotes.trim() || null,
          agencySignatureData: agencySig,
          customerSignatureData: customerSig,
          customerAcknowledged,
          customerAcknowledgmentNotes: customerAckNotes.trim() || null,
          inspectedAt: inspectedAt || detail.inspection.inspectedAt,
          items: items.map((it) => ({
            itemKey: it.itemKey,
            category: it.category,
            labelFr: it.labelFr,
            labelAr: it.labelAr,
            condition: it.condition,
            notes: it.notes.trim() || null,
            sortOrder: it.sortOrder,
          })),
        });
        showSuccess(t.inspections.saveDraftBtn);
        await loadContext();
        onSaved();
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!detail) return;
    setFinalizing(true);
    try {
      // Save latest draft edits first, then finalize
      await erpClient.updateInspectionDraft({
        inspectionId: detail.inspection.id,
        odometerKm: Number(odometerKm || 0),
        fuelLevelPercent,
        exteriorNotes: exteriorNotes.trim() || null,
        interiorNotes: interiorNotes.trim() || null,
        agencySignatureData: agencySig,
        customerSignatureData: customerSig,
        customerAcknowledged,
        customerAcknowledgmentNotes: customerAckNotes.trim() || null,
        inspectedAt: inspectedAt || detail.inspection.inspectedAt,
        items: items.map((it) => ({
          itemKey: it.itemKey,
          category: it.category,
          labelFr: it.labelFr,
          labelAr: it.labelAr,
          condition: it.condition,
          notes: it.notes.trim() || null,
          sortOrder: it.sortOrder,
        })),
      });
      await erpClient.finalizeInspection(detail.inspection.id);
      showSuccess(t.inspections.statusFinalized);
      setConfirmFinalize(false);
      await loadContext();
      onSaved();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setFinalizing(false);
    }
  };

  const handlePhotoFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !detail) return;
    if (file.size > 5 * 1024 * 1024) {
      showError(t.dialogs.fileTooLarge);
      return;
    }
    const validMime =
      file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp'
        ? file.type
        : 'image/jpeg';

    setUploadingPhoto(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || '');
          const idx = res.indexOf(',');
          resolve(idx >= 0 ? res.slice(idx + 1) : res);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await erpClient.uploadInspectionPhoto({
        inspectionId: detail.inspection.id,
        originalFileName: file.name,
        mimeType: validMime,
        base64Data,
        caption: photoCaption.trim() || null,
      });
      setPhotoCaption('');
      showSuccess(t.inspections.uploadPhotoBtn);
      await loadContext();
      onSaved();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDeletePhoto = async () => {
    if (deletePhotoId == null) return;
    try {
      await erpClient.deleteInspectionPhoto(deletePhotoId);
      setDeletePhotoId(null);
      await loadContext();
      onSaved();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleExportPdf = async (comparisonMode = false) => {
    if (!detail) return;
    setExportingPdf(true);
    try {
      const payload = await erpClient.getInspectionPdfPayload(detail.inspection.id);
      if (comparisonMode) {
        await exportDamageComparisonPdf(payload, lang, numerals);
      } else {
        await exportInspectionPdf(payload, lang, numerals);
      }
      showSuccess(t.inspections.exportPdfBtn);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setExportingPdf(false);
    }
  };

  const diagramPins: DiagramPin[] = [
    ...(detail?.damages ?? []).map((d) => ({
      id: d.id,
      zoneCode: d.zoneCode,
      diagramX: d.diagramX,
      diagramY: d.diagramY,
      severity: d.severity,
      isNewlyDiscovered: d.isNewlyDiscovered,
      status: d.status,
      description: d.description,
    })),
    ...pendingDamages.map((d, i) => ({
      id: `pending-${i}`,
      zoneCode: d.zoneCode,
      diagramX: d.diagramX,
      diagramY: d.diagramY,
      severity: d.severity,
      isNewlyDiscovered: d.isNewlyDiscovered,
      description: d.description,
    })),
  ];

  const categories = ['EXTERIOR', 'INTERIOR', 'SAFETY_DOCS'] as const;

  const liveOdoDelta =
    effectiveStage === 'RETURN'
      ? Math.max(
          0,
          Number(odometerKm || 0) -
            (depInspection?.inspection.odometerKm ?? contractMeta?.departureOdometerKm ?? 0)
        )
      : null;

  return (
    <>
      <ModalDialog
        open={open}
        onClose={onClose}
        title={
          detail
            ? `${detail.inspection.inspectionNumber} · ${
                effectiveStage === 'DEPARTURE'
                  ? t.inspections.stageDeparture
                  : t.inspections.stageReturn
              }`
            : effectiveStage === 'DEPARTURE'
            ? t.inspections.newDeparture
            : t.inspections.newReturn
        }
        subtitle={
          contractMeta
            ? `${contractMeta.contractNumber} · ${contractMeta.vehicleLabel} (${formatDigits(contractMeta.vehicleMatricule, numerals)}) · ${contractMeta.customerName}`
            : undefined
        }
        size="xl"
        onSubmit={!readOnly ? handleSave : undefined}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <div className="flex flex-wrap items-center gap-2">
              {detail && (
                <>
                  <button
                    type="button"
                    disabled={exportingPdf}
                    onClick={() => void handleExportPdf(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span>{t.inspections.exportPdfBtn}</span>
                  </button>
                  {effectiveStage === 'RETURN' && detail.comparison && (
                    <button
                      type="button"
                      disabled={exportingPdf}
                      onClick={() => void handleExportPdf(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/30"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>{t.inspections.exportComparisonPdfBtn}</span>
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {t.common.close}
              </button>
              {!readOnly && (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
                >
                  {saving ? t.common.loading : t.inspections.saveDraftBtn}
                </button>
              )}
              {detail && !isFinalized && canFinalize && (
                <button
                  type="button"
                  onClick={() => setConfirmFinalize(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{t.inspections.finalizeBtn}</span>
                </button>
              )}
            </div>
          </div>
        }
      >
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">{t.common.loading}</div>
        ) : (
          <div className="space-y-6">
            {/* Finalized Lock Banner */}
            {isFinalized && detail && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-200">
                <Lock className="w-4 h-4 shrink-0" />
                <span>
                  {t.inspections.statusFinalized} ·{' '}
                  {detail.inspection.finalizedAt
                    ? formatDateTimeAlgiers(detail.inspection.finalizedAt, lang, numerals)
                    : ''}
                  {detail.inspection.finalizedByName ? ` (${detail.inspection.finalizedByName})` : ''}
                </span>
              </div>
            )}

            {/* Return Comparison & Compliance Banner */}
            {effectiveStage === 'RETURN' && (
              <div className="space-y-2">
                {depInspection && (
                  <div className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-teal-700 dark:text-teal-400">
                        {t.inspections.stageDeparture}
                      </div>
                      <div className="font-mono-tabular font-semibold">
                        {formatDigits(depInspection.inspection.odometerKm.toLocaleString(), numerals)} km ·{' '}
                        {formatDigits(depInspection.inspection.fuelLevelPercent, numerals)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-teal-700 dark:text-teal-400">
                        {t.inspections.odometerDelta}
                      </div>
                      <div className="font-mono-tabular font-semibold">
                        {liveOdoDelta != null
                          ? `${formatDigits(liveOdoDelta.toLocaleString(), numerals)} km`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-teal-700 dark:text-teal-400">
                        {t.inspections.fuelDelta}
                      </div>
                      <div className="font-mono-tabular font-semibold">
                        {formatDigits(
                          fuelLevelPercent - depInspection.inspection.fuelLevelPercent,
                          numerals
                        )}
                        %
                      </div>
                    </div>
                    <div>
                      <div className="text-teal-700 dark:text-teal-400">
                        {t.inspections.lateReturn}
                      </div>
                      <div className="font-mono-tabular font-semibold">
                        {detail && detail.inspection.lateReturnMinutes > 0
                          ? `${formatDigits(detail.inspection.lateReturnMinutes, numerals)} min`
                          : t.inspections.onTime}
                      </div>
                    </div>
                  </div>
                )}
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{t.inspections.noAutoChargeNotice}</span>
                </div>
              </div>
            )}

            {/* Telemetry Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.odometerKm}
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  dir="ltr"
                  disabled={readOnly}
                  value={odometerKm}
                  onChange={(e) => setOdometerKm(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.fuelLevelPercent} ({formatDigits(fuelLevelPercent, numerals)}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  disabled={readOnly}
                  value={fuelLevelPercent}
                  onChange={(e) => setFuelLevelPercent(Number(e.target.value))}
                  className="w-full mt-2 accent-blue-900 dark:accent-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.inspectedAt}
                </label>
                <input
                  type="datetime-local"
                  required
                  dir="ltr"
                  disabled={readOnly}
                  value={inspectedAt}
                  onChange={(e) => setInspectedAt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular disabled:opacity-60"
                />
              </div>
            </div>

            {/* Interactive Diagram + Damage Logger */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="lg:col-span-5 flex flex-col items-center">
                <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1">
                  {t.inspections.diagramTitle}
                </h4>
                <p className="text-[11px] text-slate-500 text-center mb-3">
                  {t.inspections.diagramHint}
                </p>
                <VehicleDamageDiagram
                  lang={lang}
                  selectedZone={dmgZone}
                  selectedPoint={dmgPoint}
                  pins={diagramPins}
                  interactive={!readOnly}
                  onSelectZone={(code, x, y) => {
                    setDmgZone(code);
                    setDmgPoint({ x, y });
                  }}
                />
              </div>

              <div className="lg:col-span-7 space-y-4">
                {!readOnly && (
                  <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {t.inspections.selectedZone}:{' '}
                        <span className="text-blue-900 dark:text-blue-400">
                          {getDiagramZoneLabel(dmgZone, lang)}
                        </span>
                      </span>
                      <select
                        value={dmgZone}
                        onChange={(e) => {
                          const code = e.target.value as VehicleDiagramZoneCode;
                          const def = VEHICLE_DIAGRAM_ZONES.find((z) => z.code === code);
                          setDmgZone(code);
                          if (def) setDmgPoint({ x: def.defaultX, y: def.defaultY });
                        }}
                        className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      >
                        {VEHICLE_DIAGRAM_ZONES.map((z) => (
                          <option key={z.code} value={z.code}>
                            {lang === 'ar' ? z.labelAr : z.labelFr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">
                          {t.inspections.damageType}
                        </label>
                        <select
                          value={dmgType}
                          onChange={(e) => setDmgType(e.target.value as DamageType)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                        >
                          {(['SCRATCH', 'DENT', 'CRACK', 'BROKEN', 'MISSING_ACCESSORY', 'OTHER'] as DamageType[]).map(
                            (dt) => (
                              <option key={dt} value={dt}>
                                {t.inspections.damageTypes[dt]}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">
                          {t.inspections.damageSeverity}
                        </label>
                        <select
                          value={dmgSeverity}
                          onChange={(e) => setDmgSeverity(e.target.value as DamageSeverity)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                        >
                          {(['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'] as DamageSeverity[]).map((sv) => (
                            <option key={sv} value={sv}>
                              {t.inspections.damageSeverities[sv]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">
                          {t.inspections.estimatedRepairCost}
                        </label>
                        <input
                          type="number"
                          min={0}
                          dir="ltr"
                          value={dmgEstimatedDzd}
                          onChange={(e) => setDmgEstimatedDzd(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
                        />
                      </div>
                    </div>

                    <input
                      type="text"
                      value={dmgDesc}
                      onChange={(e) => setDmgDesc(e.target.value)}
                      placeholder={t.inspections.damageDescription}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dmgPreExisting}
                          onChange={(e) => setDmgPreExisting(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        <span>{t.inspections.isPreExisting}</span>
                      </label>
                      <button
                        type="button"
                        disabled={!dmgDesc.trim()}
                        onClick={() => void handleAddDamage()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t.inspections.addDamageBtn}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Listed damages for this inspection */}
                <div className="space-y-2">
                  {diagramPins.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-center text-slate-500">
                      {t.inspections.emptyDamages}
                    </div>
                  ) : (
                    diagramPins.map((pin, idx) => (
                      <div
                        key={pin.id ?? idx}
                        className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            #{idx + 1} · {getDiagramZoneLabel(pin.zoneCode, lang)} ·{' '}
                            {pin.isNewlyDiscovered ? (
                              <span className="text-rose-700 dark:text-rose-400">
                                {t.inspections.isNewlyDiscovered}
                              </span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">
                                {t.inspections.isPreExisting}
                              </span>
                            )}
                          </div>
                          <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                            {pin.description}
                          </div>
                        </div>
                        {typeof pin.id === 'string' && pin.id.startsWith('pending-') && !readOnly && (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingDamages((prev) =>
                                prev.filter((_, pIdx) => `pending-${pIdx}` !== pin.id)
                              )
                            }
                            className="p-1 text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Structured Checklist */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                {t.inspections.checklistSection}
              </h4>
              {categories.map((cat) => {
                const catItems = items.filter((it) => it.category === cat);
                if (catItems.length === 0) return null;
                return (
                  <div
                    key={cat}
                    className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
                  >
                    <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t.inspections.categories[cat]}
                    </div>
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {catItems.map((it) => {
                        const depCond = depItemMap.get(it.itemKey);
                        const degraded =
                          effectiveStage === 'RETURN' &&
                          depCond &&
                          ((depCond === 'GOOD' && it.condition !== 'GOOD') ||
                            (depCond === 'DAMAGED' && it.condition === 'MISSING'));
                        return (
                          <div
                            key={it.itemKey}
                            className={`px-4 py-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs ${
                              degraded ? 'bg-rose-50/70 dark:bg-rose-950/20' : ''
                            }`}
                          >
                            <div className="md:col-span-5 font-medium text-slate-800 dark:text-slate-200">
                              {lang === 'ar' ? it.labelAr : it.labelFr}
                              {effectiveStage === 'RETURN' && depCond && (
                                <span className="ms-2 text-[11px] text-slate-500">
                                  ({t.inspections.stageDeparture}: {t.inspections.conditions[depCond]})
                                </span>
                              )}
                            </div>
                            <div className="md:col-span-3 flex items-center gap-1">
                              {(['GOOD', 'DAMAGED', 'MISSING'] as InspectionItemCondition[]).map(
                                (cond) => (
                                  <button
                                    key={cond}
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() =>
                                      setItems((prev) =>
                                        prev.map((row) =>
                                          row.itemKey === it.itemKey
                                            ? { ...row, condition: cond }
                                            : row
                                        )
                                      )
                                    }
                                    className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                                      it.condition === cond
                                        ? cond === 'GOOD'
                                          ? 'bg-emerald-700 text-white border-emerald-700'
                                          : cond === 'DAMAGED'
                                          ? 'bg-amber-600 text-white border-amber-600'
                                          : 'bg-rose-700 text-white border-rose-700'
                                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    {t.inspections.conditions[cond]}
                                  </button>
                                )
                              )}
                            </div>
                            <div className="md:col-span-4">
                              <input
                                type="text"
                                disabled={readOnly}
                                value={it.notes}
                                onChange={(e) =>
                                  setItems((prev) =>
                                    prev.map((row) =>
                                      row.itemKey === it.itemKey
                                        ? { ...row, notes: e.target.value }
                                        : row
                                    )
                                  )
                                }
                                placeholder="..."
                                className="w-full px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs disabled:opacity-60"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.exteriorNotes}
                </label>
                <textarea
                  rows={2}
                  disabled={readOnly}
                  value={exteriorNotes}
                  onChange={(e) => setExteriorNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.interiorNotes}
                </label>
                <textarea
                  rows={2}
                  disabled={readOnly}
                  value={interiorNotes}
                  onChange={(e) => setInteriorNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                />
              </div>
            </div>

            {/* Encrypted Photos Vault (enabled once inspection record exists) */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {t.inspections.photosTitle}
                </h4>
                {detail && !readOnly && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={photoCaption}
                      onChange={(e) => setPhotoCaption(e.target.value)}
                      placeholder={t.inspections.photoCaptionPlaceholder}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => void handlePhotoFile(e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{uploadingPhoto ? t.common.loading : t.inspections.uploadPhotoBtn}</span>
                    </button>
                  </div>
                )}
              </div>

              {!detail ? (
                <p className="text-xs text-slate-500">
                  {lang === 'ar'
                    ? 'احفظ المسودة أولاً لإرفاق الصور المشفرة.'
                    : 'Enregistrez le brouillon pour joindre des photos chiffrées AES-256.'}
                </p>
              ) : detail.photos.length === 0 ? (
                <p className="text-xs text-slate-500">—</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {detail.photos.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-950"
                    >
                      {photoUrls[p.id] ? (
                        <img
                          src={photoUrls[p.id]}
                          alt={p.caption || p.originalFileName || 'Inspection'}
                          className="w-full h-28 object-cover"
                        />
                      ) : (
                        <div className="w-full h-28 flex items-center justify-center text-xs text-slate-400">
                          {t.common.loading}
                        </div>
                      )}
                      <div className="p-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-slate-600 dark:text-slate-300">
                          {p.caption || p.originalFileName || `#${p.id}`}
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setDeletePhotoId(p.id)}
                            className="text-slate-400 hover:text-rose-600 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Customer Acknowledgment & Digital Signatures */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
              <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {t.inspections.signaturesTitle}
              </h4>
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={customerAcknowledged}
                    onChange={(e) => setCustomerAcknowledged(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>{t.inspections.customerAcknowledged}</span>
                </label>
                <input
                  type="text"
                  disabled={readOnly}
                  value={customerAckNotes}
                  onChange={(e) => setCustomerAckNotes(e.target.value)}
                  placeholder={t.inspections.customerAckNotes}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SignaturePad
                  label={t.inspections.agencySignature}
                  clearLabel={t.inspections.clearSignature}
                  value={agencySig}
                  disabled={readOnly}
                  onChange={setAgencySig}
                />
                <SignaturePad
                  label={t.inspections.customerSignature}
                  clearLabel={t.inspections.clearSignature}
                  value={customerSig}
                  disabled={readOnly}
                  onChange={setCustomerSig}
                />
              </div>
            </div>
          </div>
        )}
      </ModalDialog>

      <ConfirmDialog
        open={confirmFinalize}
        onClose={() => setConfirmFinalize(false)}
        onConfirm={handleFinalize}
        tone="warning"
        title={t.inspections.finalizeConfirmTitle}
        description={t.inspections.finalizeConfirmDesc}
        confirmLabel={t.inspections.finalizeBtn}
        cancelLabel={t.common.cancel}
        loading={finalizing}
      />

      <ConfirmDialog
        open={deletePhotoId != null}
        onClose={() => setDeletePhotoId(null)}
        onConfirm={handleDeletePhoto}
        tone="danger"
        title={t.inspections.deletePhotoConfirmTitle}
        description={t.inspections.deletePhotoConfirmDesc}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
      />
    </>
  );
}
