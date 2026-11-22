import { useEffect, useState, type FormEvent } from 'react';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type VehicleMaintenanceDueItemDto } from '../../lib/apiClient.ts';

interface MaintenanceScheduleModalProps {
  open: boolean;
  vehicleId: number;
  item: VehicleMaintenanceDueItemDto | null;
  onClose: () => void;
  onSaved: () => void;
}

export function MaintenanceScheduleModal({
  open,
  vehicleId,
  item,
  onClose,
  onSaved,
}: MaintenanceScheduleModalProps) {
  const { t, lang } = useI18n();
  const { showError, showSuccess } = useToast();

  const [kmInterval, setKmInterval] = useState('');
  const [dayInterval, setDayInterval] = useState('');
  const [kmWarning, setKmWarning] = useState('1000');
  const [dayWarning, setDayWarning] = useState('14');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    setKmInterval(item.kmInterval != null ? String(item.kmInterval) : '');
    setDayInterval(item.dayInterval != null ? String(item.dayInterval) : '');
    setKmWarning(String(item.kmWarningThreshold ?? 1000));
    setDayWarning(String(item.dayWarningThreshold ?? 14));
    setIsActive(item.isScheduleActive);
    setNotes(item.scheduleNotes ?? '');
  }, [item, open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setSaving(true);
    try {
      await erpClient.upsertVehicleMaintenanceSchedule({
        vehicleId,
        maintenanceTypeId: item.maintenanceTypeId,
        kmInterval: kmInterval.trim() ? Number(kmInterval) : null,
        dayInterval: dayInterval.trim() ? Number(dayInterval) : null,
        kmWarningThreshold: Number(kmWarning || 0),
        dayWarningThreshold: Number(dayWarning || 0),
        isActive,
        notes: notes.trim() || null,
      });
      showSuccess(t.common.save);
      onSaved();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      open={open && Boolean(item)}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={t.maintenance.customizeSchedule}
      subtitle={item ? (lang === 'ar' ? item.nameAr : item.nameFr) : undefined}
      size="md"
      disableClose={saving}
      onSubmit={handleSubmit}
      footer={
        <>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {saving ? t.common.loading : t.common.save}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">{t.maintenance.kmInterval}</label>
          <input
            type="number"
            min={1}
            dir="ltr"
            data-autofocus
            value={kmInterval}
            onChange={(e) => setKmInterval(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.maintenance.dayInterval}</label>
          <input
            type="number"
            min={1}
            dir="ltr"
            value={dayInterval}
            onChange={(e) => setDayInterval(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.maintenance.kmWarningThreshold}</label>
          <input
            type="number"
            min={0}
            dir="ltr"
            value={kmWarning}
            onChange={(e) => setKmWarning(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.maintenance.dayWarningThreshold}</label>
          <input
            type="number"
            min={0}
            dir="ltr"
            value={dayWarning}
            onChange={(e) => setDayWarning(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="rounded border-slate-300"
        />
        <span>{t.maintenance.scheduleActive}</span>
      </label>

      <div>
        <label className="block text-xs font-medium mb-1">{t.vehicles.notes}</label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
        />
      </div>
    </ModalDialog>
  );
}
