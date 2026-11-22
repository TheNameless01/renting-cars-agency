import { useEffect, useState, type FormEvent } from 'react';
import type { Supplier } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type WilayaDto } from '../../lib/apiClient.ts';

interface SupplierModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  supplier?: Supplier | null;
}

export function SupplierModal({ open, onClose, onSaved, supplier }: SupplierModalProps) {
  const { t, lang } = useI18n();
  const { showError, showSuccess } = useToast();
  const isEdit = Boolean(supplier);

  const [submitting, setSubmitting] = useState(false);
  const [wilayas, setWilayas] = useState<WilayaDto[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [wilayaCode, setWilayaCode] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [nifNumber, setNifNumber] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isArchived, setIsArchived] = useState(false);

  useEffect(() => {
    if (!open) return;
    erpClient.listWilayas(false).then(setWilayas).catch(() => setWilayas([]));
    if (supplier) {
      setName(supplier.name);
      setPhone(supplier.phone ?? '');
      setEmail(supplier.email ?? '');
      setWilayaCode(supplier.wilayaCode ?? '');
      setSpecialty(supplier.specialty ?? '');
      setNifNumber(supplier.nifNumber ?? '');
      setAddress(supplier.address ?? '');
      setNotes(supplier.notes ?? '');
      setIsArchived(supplier.isArchived);
    } else {
      setName('');
      setPhone('');
      setEmail('');
      setWilayaCode('');
      setSpecialty('');
      setNifNumber('');
      setAddress('');
      setNotes('');
      setIsArchived(false);
    }
  }, [open, supplier]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await erpClient.upsertSupplier({
        id: supplier?.id,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        wilayaCode: wilayaCode || null,
        specialty: specialty.trim() || null,
        nifNumber: nifNumber.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        isArchived,
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
      title={isEdit ? t.inventory.editSupplier : t.inventory.newSupplier}
      size="md"
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
            disabled={submitting || !name.trim()}
            className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {submitting ? t.common.loading : t.common.save}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1">{t.inventory.supplierName}</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.supplierPhone}</label>
            <input
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.supplierEmail}</label>
            <input
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.supplierSpecialty}</label>
            <input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.supplierWilaya}</label>
            <select
              value={wilayaCode}
              onChange={(e) => setWilayaCode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="">—</option>
              {wilayas.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} — {lang === 'ar' ? w.nameAr : w.nameFr}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.supplierNif}</label>
            <input
              dir="ltr"
              value={nifNumber}
              onChange={(e) => setNifNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.inventory.supplierAddress}</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">{t.inventory.supplierNotes}</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isArchived}
              onChange={(e) => setIsArchived(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span>{t.inventory.supplierArchiveToggle}</span>
          </label>
        )}
      </div>
    </ModalDialog>
  );
}
