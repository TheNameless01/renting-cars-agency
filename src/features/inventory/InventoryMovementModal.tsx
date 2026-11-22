import { ShieldAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { PaymentMethod, Supplier, Vehicle } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type InventoryPartListItemDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor } from '../../lib/formatters.ts';

interface InventoryMovementModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mode: 'MOVEMENT' | 'ADJUST';
  parts: InventoryPartListItemDto[];
  suppliers: Supplier[];
  vehicles: Vehicle[];
  defaultPartId?: number | null;
}

export function InventoryMovementModal({
  open,
  onClose,
  onSaved,
  mode,
  parts,
  suppliers,
  vehicles,
  defaultPartId,
}: InventoryMovementModalProps) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const canManageExpenses = hasPermission('finance:manage_expenses');
  const [submitting, setSubmitting] = useState(false);

  const [partId, setPartId] = useState('');
  const [movementType, setMovementType] = useState<'PURCHASE' | 'ENTRY' | 'WITHDRAWAL' | 'RETURN'>('PURCHASE');
  const [quantity, setQuantity] = useState('1');
  const [quantityDelta, setQuantityDelta] = useState('0');
  const [unitCostDzd, setUnitCostDzd] = useState('0');
  const [supplierId, setSupplierId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  const [movementDate, setMovementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [recordInFinance, setRecordInFinance] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentReference, setPaymentReference] = useState('');

  useEffect(() => {
    if (!open) return;
    const activeParts = parts.filter((p) => !p.isArchived);
    const chosen = activeParts.find((p) => p.id === defaultPartId) ?? activeParts[0] ?? null;
    setPartId(chosen ? String(chosen.id) : '');
    setMovementType('PURCHASE');
    setQuantity('1');
    setQuantityDelta('1');
    setUnitCostDzd(chosen ? String(fromMinorUnits(chosen.unitPurchasePriceMinor)) : '0');
    setSupplierId(chosen?.supplierId ? String(chosen.supplierId) : '');
    setVehicleId('');
    setReferenceCode('');
    setMovementDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setOverrideReason('');
    setRecordInFinance(false);
    setPaymentMethod('CASH');
    setPaymentReference('');
  }, [defaultPartId, open, parts]);

  const selectedPart = parts.find((p) => String(p.id) === partId) ?? null;

  const handlePartChange = (nextPartId: string) => {
    setPartId(nextPartId);
    const p = parts.find((item) => String(item.id) === nextPartId);
    if (p) {
      setUnitCostDzd(String(fromMinorUnits(p.unitPurchasePriceMinor)));
      if (p.supplierId) setSupplierId(String(p.supplierId));
    }
  };

  const totalPurchaseMinor =
    mode === 'MOVEMENT' && movementType === 'PURCHASE'
      ? Number(quantity || 0) * toMinorUnits(Number(unitCostDzd || 0))
      : 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!partId) return;
    setSubmitting(true);
    try {
      if (mode === 'ADJUST') {
        await erpClient.adjustInventoryStock({
          partId: Number(partId),
          quantityDelta: Number(quantityDelta),
          overrideReason: overrideReason.trim(),
          notes: notes.trim() || null,
          movementDate,
        });
      } else {
        await erpClient.recordInventoryMovement({
          partId: Number(partId),
          movementType,
          quantity: Number(quantity),
          unitCostMinor: toMinorUnits(Number(unitCostDzd || 0)),
          supplierId: supplierId ? Number(supplierId) : null,
          vehicleId: vehicleId ? Number(vehicleId) : null,
          referenceCode: referenceCode.trim() || null,
          movementDate,
          notes: notes.trim() || null,
          recordInFinance: movementType === 'PURCHASE' && canManageExpenses ? recordInFinance : false,
          paymentMethod,
          paymentReference: paymentReference.trim() || null,
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

  const activeParts = parts.filter((p) => !p.isArchived);

  return (
    <ModalDialog
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={mode === 'ADJUST' ? t.inventory.adjustStock : t.inventory.recordMovement}
      subtitle={selectedPart ? `${selectedPart.partCode} · ${selectedPart.partName}` : undefined}
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
            disabled={submitting || !partId}
            className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {submitting ? t.common.loading : t.common.save}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {mode === 'ADJUST' && (
          <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{t.inventory.adjustAdminNotice}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.partName}</label>
            <select
              required
              value={partId}
              onChange={(e) => handlePartChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {activeParts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partCode} · {p.partName} ({t.maintenance.stockAvailable}: {p.quantityAvailable})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.movementDate}</label>
            <input
              type="date"
              required
              dir="ltr"
              value={movementDate}
              onChange={(e) => setMovementDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>

        {mode === 'ADJUST' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">{t.inventory.movementDelta}</label>
              <input
                type="number"
                required
                dir="ltr"
                value={quantityDelta}
                onChange={(e) => setQuantityDelta(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t.inventory.adjustReason}</label>
              <input
                required
                minLength={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">{t.maintenance.statusLabel}</label>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="PURCHASE">{t.inventory.movementTypes.PURCHASE}</option>
                  <option value="ENTRY">{t.inventory.movementTypes.ENTRY}</option>
                  <option value="WITHDRAWAL">{t.inventory.movementTypes.WITHDRAWAL}</option>
                  <option value="RETURN">{t.inventory.movementTypes.RETURN}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.inventory.movementQuantity}</label>
                <input
                  type="number"
                  required
                  min={1}
                  dir="ltr"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.inventory.unitPriceDzd}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={unitCostDzd}
                  onChange={(e) => setUnitCostDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">{t.inventory.defaultSupplier}</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="">{t.maintenance.noSupplier}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.inventory.movementVehicle}</label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
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
                <label className="block text-xs font-medium mb-1">{t.inventory.movementRef}</label>
                <input
                  dir="ltr"
                  value={referenceCode}
                  onChange={(e) => setReferenceCode(e.target.value)}
                  placeholder="BL-2026-041"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
            </div>

            {movementType === 'PURCHASE' && canManageExpenses && (
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={recordInFinance}
                      onChange={(e) => setRecordInFinance(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>{t.inventory.recordInFinancePurchase}</span>
                  </label>
                  <span className="text-xs font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrencyMinor(totalPurchaseMinor, 'DZD', lang, numerals)}
                  </span>
                </div>
                {recordInFinance && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            )}
          </>
        )}

        <div>
          <label className="block text-xs font-medium mb-1">{t.inventory.movementNotes}</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </div>
    </ModalDialog>
  );
}
