import { AlertTriangle, Download, FileText, Lock, Package, Plus, Trash2, Wrench } from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type {
  MaintenancePartInput,
  MaintenanceStatus,
  MaintenanceType,
  PaymentMethod,
  Supplier,
  Vehicle,
} from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type InventoryPartListItemDto,
  type MaintenanceRecordDetailDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';

interface MaintenanceRecordModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  recordId?: number | null;
  defaultVehicleId?: number;
  defaultMaintenanceTypeId?: number;
}

const ACCEPTED_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_DOC_BYTES = 5 * 1024 * 1024;

export function MaintenanceRecordModal({
  open,
  onClose,
  onSaved,
  recordId,
  defaultVehicleId,
  defaultMaintenanceTypeId,
}: MaintenanceRecordModalProps) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const isEdit = Boolean(recordId);
  const canComplete = hasPermission('maintenance:complete') || hasPermission('maintenance:write');
  const canManageExpense = hasPermission('finance:manage_expenses');
  const canReadFinance = hasPermission('finance:read') || canManageExpense;

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [types, setTypes] = useState<MaintenanceType[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventoryParts, setInventoryParts] = useState<InventoryPartListItemDto[]>([]);
  const [detail, setDetail] = useState<MaintenanceRecordDetailDto | null>(null);

  const [vehicleId, setVehicleId] = useState('');
  const [maintenanceTypeId, setMaintenanceTypeId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState<MaintenanceStatus>('COMPLETED');
  const [isEmergency, setIsEmergency] = useState(false);
  const [workDescription, setWorkDescription] = useState('');
  const [performedDate, setPerformedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scheduledStartDate, setScheduledStartDate] = useState('');
  const [scheduledEndDate, setScheduledEndDate] = useState('');
  const [odometerKm, setOdometerKm] = useState('0');
  const [nextDueDate, setNextDueDate] = useState('');
  const [nextDueOdometerKm, setNextDueOdometerKm] = useState('');
  const [laborCostDzd, setLaborCostDzd] = useState('0');
  const [partsCostDzd, setPartsCostDzd] = useState('0');
  const [partsRows, setPartsRows] = useState<Array<{ partId: string; quantityUsed: string; unitCostDzd: string }>>([]);
  const [technicianName, setTechnicianName] = useState('');
  const [notes, setNotes] = useState('');
  const [blockVehicle, setBlockVehicle] = useState(false);
  const [recordInFinance, setRecordInFinance] = useState(false);
  const [financeCategory, setFinanceCategory] = useState<'MAINTENANCE' | 'REPAIRS'>('MAINTENANCE');
  const [financeExpenseScope, setFinanceExpenseScope] = useState<'TOTAL' | 'LABOR_ONLY'>('TOTAL');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [invoiceDoc, setInvoiceDoc] = useState<{
    originalFileName: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
    base64Data: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setInvoiceDoc(null);

    Promise.all([
      erpClient.listVehicles({ includeArchived: false }),
      erpClient.listMaintenanceTypes(false),
      canReadFinance ? erpClient.listSuppliers().catch(() => []) : Promise.resolve([]),
      erpClient.listInventoryParts({ includeArchived: false }).catch(() => []),
      recordId ? erpClient.getMaintenanceDetail(recordId) : Promise.resolve(null),
    ])
      .then(([vList, tList, sList, invParts, det]) => {
        if (cancelled) return;
        setVehicles(vList);
        setTypes(tList);
        setSuppliers(sList);
        setInventoryParts(invParts);
        setDetail(det);

        if (det) {
          const r = det.record;
          setVehicleId(String(r.vehicleId));
          setMaintenanceTypeId(String(r.maintenanceTypeId));
          setSupplierId(r.supplierId ? String(r.supplierId) : '');
          setStatus(r.status);
          setIsEmergency(r.isEmergency);
          setWorkDescription(r.workDescription);
          setPerformedDate(r.performedDate.slice(0, 10));
          setScheduledStartDate(r.scheduledStartDate ? r.scheduledStartDate.slice(0, 16) : '');
          setScheduledEndDate(r.scheduledEndDate ? r.scheduledEndDate.slice(0, 16) : '');
          setOdometerKm(String(r.odometerKm));
          setNextDueDate(r.nextDueDate ? r.nextDueDate.slice(0, 10) : '');
          setNextDueOdometerKm(r.nextDueOdometerKm != null ? String(r.nextDueOdometerKm) : '');
          setLaborCostDzd(String(fromMinorUnits(r.laborCostMinor)));
          setPartsCostDzd(String(fromMinorUnits(r.partsCostMinor)));
          setPartsRows(
            det.parts.map((p) => ({
              partId: String(p.partId),
              quantityUsed: String(p.quantityUsed),
              unitCostDzd: String(fromMinorUnits(p.unitCostMinor)),
            }))
          );
          setTechnicianName(r.technicianName ?? '');
          setNotes(r.notes ?? '');
          setBlockVehicle(r.blockIsActive);
          setRecordInFinance(false);
          setFinanceCategory(r.isEmergency ? 'REPAIRS' : 'MAINTENANCE');
          setFinanceExpenseScope(det.parts.length > 0 ? 'LABOR_ONLY' : 'TOTAL');
          setPaymentMethod('CASH');
          setPaymentReference('');
        } else {
          const initialVehicle =
            vList.find((v) => v.id === defaultVehicleId) ?? vList[0] ?? null;
          const initialType =
            tList.find((mt) => mt.id === defaultMaintenanceTypeId) ?? tList[0] ?? null;
          setVehicleId(initialVehicle ? String(initialVehicle.id) : '');
          setMaintenanceTypeId(initialType ? String(initialType.id) : '');
          setSupplierId('');
          setStatus(canComplete ? 'COMPLETED' : 'IN_PROGRESS');
          setIsEmergency(false);
          setWorkDescription('');
          setPerformedDate(new Date().toISOString().slice(0, 10));
          setScheduledStartDate('');
          setScheduledEndDate('');
          setOdometerKm(initialVehicle ? String(initialVehicle.currentOdometerKm) : '0');
          setNextDueDate('');
          setNextDueOdometerKm('');
          setLaborCostDzd('0');
          setPartsCostDzd('0');
          setPartsRows([]);
          setTechnicianName('');
          setNotes('');
          setBlockVehicle(false);
          setRecordInFinance(false);
          setFinanceCategory('MAINTENANCE');
          setFinanceExpenseScope('TOTAL');
          setPaymentMethod('CASH');
          setPaymentReference('');
        }
      })
      .catch((err) => {
        if (!cancelled) showError(err instanceof Error ? err.message : t.common.error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    canComplete,
    canReadFinance,
    defaultMaintenanceTypeId,
    defaultVehicleId,
    open,
    recordId,
    showError,
    t.common.error,
  ]);

  const handleVehicleChange = (nextId: string) => {
    setVehicleId(nextId);
    if (!isEdit) {
      const v = vehicles.find((item) => String(item.id) === nextId);
      if (v) setOdometerKm(String(v.currentOdometerKm));
    }
  };

  const handleInvoiceFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_MIMES.has(file.type)) {
      showError(t.dialogs.uploadEncryptedHint);
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      showError(t.dialogs.fileTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setInvoiceDoc({
        originalFileName: file.name,
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
        base64Data: base64,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadInvoice = async () => {
    if (!detail?.record.id) return;
    try {
      const doc = await erpClient.readMaintenanceInvoice(detail.record.id);
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

  const partsLocked = Boolean(detail?.record.partsConsumedLocked);
  const validPartsUsed: MaintenancePartInput[] = partsRows
    .filter((row) => row.partId && Number(row.quantityUsed) > 0)
    .map((row) => ({
      partId: Number(row.partId),
      quantityUsed: Math.trunc(Number(row.quantityUsed)),
      unitCostMinor: toMinorUnits(Number(row.unitCostDzd || 0)),
    }));

  const computedSelectedPartsMinor = validPartsUsed.reduce(
    (acc, item) => acc + item.quantityUsed * Number(item.unitCostMinor ?? 0),
    0
  );
  const effectivePartsMinorPreview =
    validPartsUsed.length > 0 ? computedSelectedPartsMinor : toMinorUnits(Number(partsCostDzd || 0));

  const totalMinorPreview =
    toMinorUnits(Number(laborCostDzd || 0)) + effectivePartsMinorPreview;

  const isLockedStatus = detail?.record.status === 'CANCELLED';
  const wasCompleted = detail?.record.status === 'COMPLETED';
  const alreadyLinkedExpense = Boolean(detail?.record.linkedExpenseId);

  const addPartRow = () => {
    const first = inventoryParts.find((p) => p.quantityAvailable > 0) ?? inventoryParts[0];
    if (!first) return;
    setPartsRows((prev) => [
      ...prev,
      {
        partId: String(first.id),
        quantityUsed: '1',
        unitCostDzd: String(fromMinorUnits(first.unitPurchasePriceMinor)),
      },
    ]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (scheduledStartDate && scheduledEndDate && Date.parse(scheduledEndDate) <= Date.parse(scheduledStartDate)) {
      showError(t.dialogs.invalidDateRange);
      return;
    }
    setSubmitting(true);
    try {
      const laborCostMinor = toMinorUnits(Number(laborCostDzd || 0));
      const partsCostMinor = effectivePartsMinorPreview;
      const parsedNextKm = nextDueOdometerKm.trim() !== '' ? Number(nextDueOdometerKm) : undefined;
      const parsedNextDate = nextDueDate.trim() !== '' ? nextDueDate.trim() : undefined;

      if (isEdit && recordId) {
        await erpClient.updateMaintenance({
          recordId,
          status,
          supplierId: supplierId ? Number(supplierId) : null,
          workDescription: workDescription.trim(),
          performedDate,
          scheduledStartDate: scheduledStartDate || null,
          scheduledEndDate: scheduledEndDate || null,
          odometerKm: Number(odometerKm || 0),
          nextDueDate: parsedNextDate ?? (nextDueDate === '' && wasCompleted ? null : undefined),
          nextDueOdometerKm:
            parsedNextKm !== undefined
              ? parsedNextKm
              : nextDueOdometerKm === '' && wasCompleted
                ? null
                : undefined,
          laborCostMinor,
          partsCostMinor,
          partsUsed: partsLocked ? undefined : validPartsUsed,
          technicianName: technicianName.trim() || null,
          notes: notes.trim() || null,
          blockVehicle,
          recordInFinance: canManageExpense && !alreadyLinkedExpense ? recordInFinance : false,
          financeCategory,
          financeExpenseScope,
          paymentMethod,
          paymentReference: paymentReference.trim() || null,
          invoiceDoc,
        });
      } else {
        await erpClient.createMaintenance({
          vehicleId: Number(vehicleId),
          maintenanceTypeId: Number(maintenanceTypeId),
          supplierId: supplierId ? Number(supplierId) : null,
          status: status as 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED',
          isEmergency,
          workDescription: workDescription.trim(),
          performedDate,
          scheduledStartDate: scheduledStartDate || null,
          scheduledEndDate: scheduledEndDate || null,
          odometerKm: Number(odometerKm || 0),
          nextDueDate: parsedNextDate ?? null,
          nextDueOdometerKm: parsedNextKm ?? null,
          laborCostMinor,
          partsCostMinor,
          partsUsed: validPartsUsed.length > 0 ? validPartsUsed : undefined,
          technicianName: technicianName.trim() || null,
          notes: notes.trim() || null,
          blockVehicle,
          recordInFinance: canManageExpense ? recordInFinance : false,
          financeCategory,
          financeExpenseScope,
          paymentMethod,
          paymentReference: paymentReference.trim() || null,
          invoiceDoc,
        });
      }
      showSuccess(t.common.save);
      onSaved();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={isEdit ? t.maintenance.editIntervention : t.maintenance.newIntervention}
      subtitle={
        detail
          ? `${detail.record.recordNumber} · ${detail.record.vehicleLabel}`
          : undefined
      }
      size="lg"
      disableClose={submitting}
      onSubmit={handleSubmit}
      footer={
        <>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={submitting || loading || isLockedStatus || !vehicleId || !maintenanceTypeId}
            className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {submitting ? t.common.loading : t.common.save}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">{t.common.loading}</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">{t.nav.vehicles} *</label>
              <select
                required
                disabled={isEdit}
                data-autofocus={!isEdit}
                value={vehicleId}
                onChange={(e) => handleVehicleChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
              >
                <option value="">—</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} ({v.matricule})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.maintenanceType} *</label>
              <select
                required
                disabled={isEdit}
                value={maintenanceTypeId}
                onChange={(e) => setMaintenanceTypeId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
              >
                <option value="">—</option>
                {types.map((mt) => (
                  <option key={mt.id} value={mt.id}>
                    {lang === 'ar' ? mt.nameAr : mt.nameFr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.statusLabel}</label>
              <select
                disabled={isLockedStatus}
                value={status}
                onChange={(e) => setStatus(e.target.value as MaintenanceStatus)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
              >
                {!wasCompleted && (
                  <>
                    <option value="SCHEDULED">{t.maintenance.statuses.SCHEDULED}</option>
                    <option value="IN_PROGRESS">{t.maintenance.statuses.IN_PROGRESS}</option>
                  </>
                )}
                {(canComplete || wasCompleted) && (
                  <option value="COMPLETED">{t.maintenance.statuses.COMPLETED}</option>
                )}
                {isEdit && !wasCompleted && (
                  <option value="CANCELLED">{t.maintenance.statuses.CANCELLED}</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.performedDate} *</label>
              <input
                type="date"
                required
                dir="ltr"
                value={performedDate}
                onChange={(e) => setPerformedDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.odometerKm} *</label>
              <input
                type="number"
                required
                min={0}
                dir="ltr"
                value={odometerKm}
                onChange={(e) => setOdometerKm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-rose-700 dark:text-rose-400 cursor-pointer">
            <input
              type="checkbox"
              disabled={isEdit}
              checked={isEmergency}
              onChange={(e) => {
                setIsEmergency(e.target.checked);
                if (e.target.checked) setFinanceCategory('REPAIRS');
              }}
              className="rounded border-slate-300"
            />
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{t.maintenance.emergencyToggle}</span>
          </label>

          <div>
            <label className="block text-xs font-medium mb-1">{t.maintenance.workDescription} *</label>
            <input
              required
              minLength={3}
              data-autofocus={isEdit}
              value={workDescription}
              onChange={(e) => setWorkDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.scheduledStart}</label>
              <input
                type="datetime-local"
                dir="ltr"
                value={scheduledStartDate}
                onChange={(e) => setScheduledStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.scheduledEnd}</label>
              <input
                type="datetime-local"
                dir="ltr"
                value={scheduledEndDate}
                onChange={(e) => setScheduledEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>
          </div>

          {(status === 'SCHEDULED' || status === 'IN_PROGRESS') && (
            <label className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 text-xs font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={blockVehicle}
                onChange={(e) => setBlockVehicle(e.target.checked)}
                className="rounded border-amber-400"
              />
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>{t.maintenance.blockVehicleToggle}</span>
            </label>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.technicianName}</label>
              <input
                value={technicianName}
                onChange={(e) => setTechnicianName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.supplierLabel}</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              >
                <option value="">{t.maintenance.noSupplier}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.specialty ? `(${s.specialty})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.nextDueOdometerKm}</label>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={nextDueOdometerKm}
                onChange={(e) => setNextDueOdometerKm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t.maintenance.nextDueDate}</label>
              <input
                type="date"
                dir="ltr"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-2">
            {t.maintenance.nextDueAutoHint}
          </p>

          {/* Costs & Spare-Parts Consumption */}
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium mb-1">{t.maintenance.laborCostDzd}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={laborCostDzd}
                  onChange={(e) => setLaborCostDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.maintenance.partsCostDzd}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  disabled={validPartsUsed.length > 0 || partsLocked}
                  value={
                    validPartsUsed.length > 0
                      ? String(fromMinorUnits(computedSelectedPartsMinor))
                      : partsCostDzd
                  }
                  onChange={(e) => setPartsCostDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular disabled:opacity-60"
                />
              </div>
              <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500">{t.maintenance.totalCostDzd}</div>
                <div className="text-sm font-bold font-mono-tabular text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatCurrencyMinor(totalMinorPreview, 'DZD', lang, numerals)}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                  <Package className="w-3.5 h-3.5" />
                  <span>{t.maintenance.partsUsedTitle}</span>
                </div>
                {!partsLocked && !isLockedStatus && inventoryParts.length > 0 && (
                  <button
                    type="button"
                    onClick={addPartRow}
                    className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{t.maintenance.addPartRow}</span>
                  </button>
                )}
              </div>

              {partsLocked && (
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span>{t.maintenance.partsConsumedLockedHint}</span>
                </div>
              )}

              {partsLocked && detail?.parts && detail.parts.length > 0 ? (
                <div className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                  {detail.parts.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono-tabular"
                    >
                      <span>
                        {p.partCode} · {p.partName} × {formatDigits(p.quantityUsed, numerals)}
                      </span>
                      <span>{formatCurrencyMinor(p.totalCostMinor, 'DZD', lang, numerals)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {partsRows.length > 0 && (
                    <div className="space-y-2">
                      {partsRows.map((row, idx) => {
                        const partObj = inventoryParts.find((ip) => String(ip.id) === row.partId);
                        return (
                          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-6">
                              <select
                                value={row.partId}
                                onChange={(e) => {
                                  const nextId = e.target.value;
                                  const found = inventoryParts.find((ip) => String(ip.id) === nextId);
                                  setPartsRows((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? {
                                            ...item,
                                            partId: nextId,
                                            unitCostDzd: found
                                              ? String(fromMinorUnits(found.unitPurchasePriceMinor))
                                              : item.unitCostDzd,
                                          }
                                        : item
                                    )
                                  );
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                              >
                                <option value="">{t.maintenance.selectPart}</option>
                                {inventoryParts.map((ip) => (
                                  <option key={ip.id} value={ip.id}>
                                    {ip.partCode} · {ip.partName} ({t.maintenance.stockAvailable}:{' '}
                                    {ip.quantityAvailable})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <input
                                type="number"
                                min={1}
                                max={partObj ? Math.max(partObj.quantityAvailable, 1) : undefined}
                                dir="ltr"
                                title={t.maintenance.qtyUsed}
                                value={row.quantityUsed}
                                onChange={(e) =>
                                  setPartsRows((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, quantityUsed: e.target.value } : item
                                    )
                                  )
                                }
                                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
                              />
                            </div>
                            <div className="col-span-3">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                dir="ltr"
                                title={t.maintenance.unitCostDzd}
                                value={row.unitCostDzd}
                                onChange={(e) =>
                                  setPartsRows((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, unitCostDzd: e.target.value } : item
                                    )
                                  )
                                }
                                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
                              />
                            </div>
                            <div className="col-span-1 flex justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  setPartsRows((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="p-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t.maintenance.partsWillConsumeHint}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Finance Integration */}
          {alreadyLinkedExpense ? (
            <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
              <span className="font-medium flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5" />
                {t.maintenance.alreadyPostedExpense}
              </span>
              <span className="font-mono-tabular font-semibold">{detail?.record.linkedExpenseNumber}</span>
            </div>
          ) : (
            canManageExpense &&
            status !== 'CANCELLED' && (
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recordInFinance}
                    onChange={(e) => setRecordInFinance(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>{t.maintenance.recordInFinanceToggle}</span>
                </label>

                {recordInFinance && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">{t.maintenance.financeCategory}</label>
                      <select
                        value={financeCategory}
                        onChange={(e) => setFinanceCategory(e.target.value as 'MAINTENANCE' | 'REPAIRS')}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      >
                        <option value="MAINTENANCE">{t.finance.expenseCategories.MAINTENANCE}</option>
                        <option value="REPAIRS">{t.finance.expenseCategories.REPAIRS}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t.maintenance.financeExpenseScope}</label>
                      <select
                        value={financeExpenseScope}
                        onChange={(e) =>
                          setFinanceExpenseScope(e.target.value as 'TOTAL' | 'LABOR_ONLY')
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      >
                        <option value="TOTAL">{t.maintenance.scopeTotal}</option>
                        <option value="LABOR_ONLY">{t.maintenance.scopeLaborOnly}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t.finance.expenses.paymentMethod}</label>
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      >
                        <option value="CASH">{t.finance.methods.CASH}</option>
                        <option value="CCP">{t.finance.methods.CCP}</option>
                        <option value="BARIDIMOB">{t.finance.methods.BARIDIMOB}</option>
                        <option value="BANK_TRANSFER">{t.finance.methods.BANK_TRANSFER}</option>
                        <option value="OTHER">{t.finance.methods.OTHER}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t.finance.expenses.paymentRef}</label>
                      <input
                        dir="ltr"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          )}

          {/* Encrypted Invoice Upload / Download */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium">{t.maintenance.invoiceDoc}</label>
              {detail?.record.invoiceFilePath && (
                <button
                  type="button"
                  onClick={() => void handleDownloadInvoice()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{detail.record.invoiceOriginalName || t.maintenance.viewInvoice}</span>
                </button>
              )}
            </div>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handleInvoiceFile}
              className="block w-full text-xs text-slate-600 dark:text-slate-300 file:me-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-800 dark:file:bg-slate-800 dark:file:text-slate-200"
            />
            {invoiceDoc && (
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                <span>{invoiceDoc.originalFileName}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">{t.maintenance.notes}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
