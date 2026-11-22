import { useEffect, useState, type FormEvent } from 'react';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { Supplier } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type InventoryPartListItemDto } from '../../lib/apiClient.ts';

interface InventoryPartModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  part?: InventoryPartListItemDto | null;
  suppliers: Supplier[];
  existingCategories: string[];
}

const DEFAULT_PART_CATEGORIES = [
  'FILTRATION',
  'FREINAGE',
  'LUBRIFIANTS',
  'DISTRIBUTION',
  'PNEUMATIQUES',
  'SUSPENSION',
  'ELECTRICITE',
  'CLIMATISATION',
  'CARROSSERIE',
  'DIVERS',
];

export function InventoryPartModal({
  open,
  onClose,
  onSaved,
  part,
  suppliers,
  existingCategories,
}: InventoryPartModalProps) {
  const { t } = useI18n();
  const { showError, showSuccess } = useToast();
  const isEdit = Boolean(part);

  const [submitting, setSubmitting] = useState(false);
  const [partCode, setPartCode] = useState('');
  const [partName, setPartName] = useState('');
  const [category, setCategory] = useState('FILTRATION');
  const [unitLabel, setUnitLabel] = useState('PIECE');
  const [compatibleModels, setCompatibleModels] = useState('');
  const [minimumStock, setMinimumStock] = useState('2');
  const [unitPriceDzd, setUnitPriceDzd] = useState('0');
  const [initialStock, setInitialStock] = useState('0');
  const [supplierId, setSupplierId] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    if (part) {
      setPartCode(part.partCode);
      setPartName(part.partName);
      setCategory(part.category);
      setUnitLabel(part.unitLabel || 'PIECE');
      setCompatibleModels(part.compatibleModels ?? '');
      setMinimumStock(String(part.minimumStock));
      setUnitPriceDzd(String(fromMinorUnits(part.unitPurchasePriceMinor)));
      setInitialStock(String(part.quantityAvailable));
      setSupplierId(part.supplierId ? String(part.supplierId) : '');
      setStorageLocation(part.storageLocation ?? '');
      setDescription(part.description ?? '');
    } else {
      setPartCode('');
      setPartName('');
      setCategory('FILTRATION');
      setUnitLabel('PIECE');
      setCompatibleModels('');
      setMinimumStock('2');
      setUnitPriceDzd('0');
      setInitialStock('0');
      setSupplierId('');
      setStorageLocation('');
      setDescription('');
    }
  }, [open, part]);

  const categorySuggestions = Array.from(new Set([...DEFAULT_PART_CATEGORIES, ...existingCategories])).sort();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await erpClient.upsertInventoryPart({
        id: part?.id,
        partCode: partCode.trim().toUpperCase(),
        partName: partName.trim(),
        category: category.trim(),
        unitLabel: unitLabel.trim() || 'PIECE',
        compatibleModels: compatibleModels.trim() || null,
        minimumStock: Number(minimumStock || 0),
        unitPurchasePriceMinor: toMinorUnits(Number(unitPriceDzd || 0)),
        supplierId: supplierId ? Number(supplierId) : null,
        storageLocation: storageLocation.trim() || null,
        description: description.trim() || null,
        initialStock: !isEdit ? Number(initialStock || 0) : undefined,
      });
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
      title={isEdit ? t.inventory.editPart : t.inventory.newPart}
      subtitle={part ? `${part.partCode} · ${part.partName}` : undefined}
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
            disabled={submitting || !partCode.trim() || !partName.trim() || !category.trim()}
            className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {submitting ? t.common.loading : t.common.save}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.partCode}</label>
            <input
              required
              dir="ltr"
              value={partCode}
              onChange={(e) => setPartCode(e.target.value)}
              placeholder="FLT-HUI-CLIO4"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular uppercase"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.partName}</label>
            <input
              required
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
              placeholder="Filtre à huile 1.5 dCi"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.category}</label>
            <input
              required
              list="inventory-part-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
            <datalist id="inventory-part-categories">
              {categorySuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.unitLabel}</label>
            <input
              required
              dir="ltr"
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
              placeholder="PIECE"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.storageLocation}</label>
            <input
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              placeholder="Rayon B · Casier 04"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.unitPriceDzd}</label>
            <input
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              value={unitPriceDzd}
              onChange={(e) => setUnitPriceDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.minimumStock}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={minimumStock}
              onChange={(e) => setMinimumStock(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          {!isEdit ? (
            <div>
              <label className="block text-xs font-medium mb-1">{t.inventory.initialStock}</label>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium mb-1">{t.inventory.quantityAvailable}</label>
              <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm font-mono-tabular font-semibold">
                {part?.quantityAvailable ?? 0} {part?.unitLabel}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  {s.specialty ? ` · ${s.specialty}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.compatibleModels}</label>
            <input
              value={compatibleModels}
              onChange={(e) => setCompatibleModels(e.target.value)}
              placeholder="Clio 4, Sandero, Symbol, 208..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">{t.inventory.movementNotes}</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </div>
    </ModalDialog>
  );
}
