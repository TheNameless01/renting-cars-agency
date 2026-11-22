import { useEffect, useState, type FormEvent } from 'react';
import type { MaintenanceType } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient } from '../../lib/apiClient.ts';

interface MaintenanceTypeModalProps {
  open: boolean;
  editingType: MaintenanceType | null;
  onClose: () => void;
  onSaved: () => void;
}

export function MaintenanceTypeModal({
  open,
  editingType,
  onClose,
  onSaved,
}: MaintenanceTypeModalProps) {
  const { t } = useI18n();
  const { showError, showSuccess } = useToast();

  const [code, setCode] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [defaultKm, setDefaultKm] = useState('');
  const [defaultDays, setDefaultDays] = useState('');
  const [kmWarning, setKmWarning] = useState('1000');
  const [dayWarning, setDayWarning] = useState('14');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingType) {
      setCode(editingType.code);
      setNameFr(editingType.nameFr);
      setNameAr(editingType.nameAr);
      setDefaultKm(editingType.defaultKmInterval != null ? String(editingType.defaultKmInterval) : '');
      setDefaultDays(editingType.defaultDayInterval != null ? String(editingType.defaultDayInterval) : '');
      setKmWarning(String(editingType.kmWarningThreshold ?? 1000));
      setDayWarning(String(editingType.dayWarningThreshold ?? 14));
      setIsActive(editingType.isActive);
    } else {
      setCode('');
      setNameFr('');
      setNameAr('');
      setDefaultKm('');
      setDefaultDays('');
      setKmWarning('1000');
      setDayWarning('14');
      setIsActive(true);
    }
  }, [editingType, open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await erpClient.upsertMaintenanceType({
        id: editingType?.id,
        code: code.trim().toUpperCase(),
        nameFr: nameFr.trim(),
        nameAr: nameAr.trim(),
        defaultKmInterval: defaultKm.trim() ? Number(defaultKm) : null,
        defaultDayInterval: defaultDays.trim() ? Number(defaultDays) : null,
        kmWarningThreshold: Number(kmWarning || 0),
        dayWarningThreshold: Number(dayWarning || 0),
        isActive,
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
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={t.maintenance.editTypeTitle}
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
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium mb-1">{t.maintenance.typeCode} *</label>
          <input
            required
            dir="ltr"
            data-autofocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular uppercase"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.maintenance.typeNameFr} *</label>
          <input
            required
            dir="ltr"
            value={nameFr}
            onChange={(e) => setNameFr(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.maintenance.typeNameAr} *</label>
          <input
            required
            dir="rtl"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.maintenance.kmInterval}</label>
          <input
            type="number"
            min={1}
            dir="ltr"
            value={defaultKm}
            onChange={(e) => setDefaultKm(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.maintenance.dayInterval}</label>
          <input
            type="number"
            min={1}
            dir="ltr"
            value={defaultDays}
            onChange={(e) => setDefaultDays(e.target.value)}
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
        <span>{t.maintenance.typeActive}</span>
      </label>
    </ModalDialog>
  );
}
