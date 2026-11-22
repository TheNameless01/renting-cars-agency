import { useEffect, useState, type FormEvent } from 'react';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import { getDiagramZoneLabel } from '../../../shared/constants/inspections.ts';
import type { DamageStatus } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type VehicleDamageListItemDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';

interface DamageResolutionModalProps {
  open: boolean;
  damage: VehicleDamageListItemDto | null;
  onClose: () => void;
  onUpdated: () => void;
}

const DAMAGE_STATUSES: DamageStatus[] = [
  'REPORTED',
  'UNDER_REVIEW',
  'CONFIRMED',
  'UNDER_REPAIR',
  'REPAIRED',
  'REJECTED',
];

export function DamageResolutionModal({
  open,
  damage,
  onClose,
  onUpdated,
}: DamageResolutionModalProps) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const canManage = hasPermission('inspections:manage_damage');

  const [newStatus, setNewStatus] = useState<DamageStatus>('UNDER_REVIEW');
  const [estimatedDzd, setEstimatedDzd] = useState('');
  const [repairReference, setRepairReference] = useState('');
  const [linkedExpenseId, setLinkedExpenseId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!damage) return;
    setNewStatus(damage.status);
    setEstimatedDzd(
      damage.estimatedRepairCostMinor != null
        ? String(fromMinorUnits(damage.estimatedRepairCostMinor))
        : ''
    );
    setRepairReference(damage.repairReference ?? '');
    setLinkedExpenseId(damage.linkedExpenseId != null ? String(damage.linkedExpenseId) : '');
    setNotes('');
  }, [damage]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!damage || !canManage) return;
    setSaving(true);
    try {
      await erpClient.updateDamageStatus({
        damageId: damage.id,
        newStatus,
        notes: notes.trim(),
        estimatedRepairCostMinor: estimatedDzd ? toMinorUnits(Number(estimatedDzd)) : null,
        repairReference: repairReference.trim() || null,
        linkedExpenseId: linkedExpenseId.trim() ? Number(linkedExpenseId) : null,
      });
      showSuccess(t.common.save);
      onUpdated();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      open={open && Boolean(damage)}
      onClose={onClose}
      title={t.inspections.manageDamageTitle}
      subtitle={
        damage
          ? `${damage.damageCode} · ${damage.vehicleLabel} (${formatDigits(damage.vehicleMatricule, numerals)})`
          : undefined
      }
      size="lg"
      onSubmit={canManage ? handleSubmit : undefined}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.common.close}
          </button>
          {canManage && (
            <button
              type="submit"
              disabled={saving || !notes.trim()}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? t.common.loading : t.common.save}
            </button>
          )}
        </>
      }
    >
      {damage && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {getDiagramZoneLabel(damage.zoneCode, lang)} ·{' '}
                {t.inspections.damageTypes[damage.damageType]} (
                {t.inspections.damageSeverities[damage.severity]})
              </span>
              <span className="font-mono-tabular px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                {t.inspections.damageStatuses[damage.status]}
              </span>
            </div>
            <p className="text-slate-700 dark:text-slate-300">{damage.description}</p>
            <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 pt-1">
              {damage.contractNumber && <span>Contrat: {damage.contractNumber}</span>}
              {damage.inspectionNumber && <span>EDL: {damage.inspectionNumber}</span>}
              {damage.estimatedRepairCostMinor != null && (
                <span className="font-mono-tabular">
                  {t.inspections.estimatedRepairCost}:{' '}
                  {formatCurrencyMinor(damage.estimatedRepairCostMinor, 'DZD', lang, numerals)}
                </span>
              )}
              {damage.linkedExpenseNumber && (
                <span className="font-mono-tabular">Dépense: {damage.linkedExpenseNumber}</span>
              )}
            </div>
          </div>

          {/* Workflow update fields */}
          {canManage && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">{t.inspections.newStatus}</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as DamageStatus)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  {DAMAGE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {t.inspections.damageStatuses[st]}
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
                  step="1"
                  dir="ltr"
                  value={estimatedDzd}
                  onChange={(e) => setEstimatedDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.repairReference}
                </label>
                <input
                  type="text"
                  value={repairReference}
                  onChange={(e) => setRepairReference(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.linkedExpenseId}
                </label>
                <input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={linkedExpenseId}
                  onChange={(e) => setLinkedExpenseId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  {t.inspections.resolutionNotes} *
                </label>
                <textarea
                  rows={2}
                  required
                  minLength={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
            </div>
          )}

          {/* Resolution History */}
          <div>
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {t.inspections.resolutionHistory}
            </h4>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800 max-h-48 overflow-y-auto">
              {damage.resolutionHistory.map((h) => (
                <div key={h.id} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {h.previousStatus ? `${t.inspections.damageStatuses[h.previousStatus]} → ` : ''}
                      {t.inspections.damageStatuses[h.newStatus]}
                    </span>
                    <span className="font-mono-tabular text-[11px] text-slate-500">
                      {formatDateTimeAlgiers(h.createdAt, lang, numerals)} · {h.recordedByUsername}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{h.notes}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
