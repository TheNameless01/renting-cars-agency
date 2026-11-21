import { useState, type FormEvent } from 'react';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient } from '../../lib/apiClient.ts';

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { showSuccess, showError } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      showError(t.auth.minPasswordHint);
      return;
    }
    setSubmitting(true);
    try {
      await erpClient.changePassword({ currentPassword, newPassword });
      showSuccess(t.auth.passwordChangedSuccess);
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open
      onClose={onClose}
      title={t.auth.changePasswordTitle}
      size="sm"
      disableClose={submitting}
      onSubmit={handleSubmit}
      footer={
        <>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.auth.cancel}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {submitting ? t.common.loading : t.auth.savePassword}
          </button>
        </>
      }
    >
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.auth.currentPassword}
        </label>
        <input
          type="password"
          required
          data-autofocus
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          dir="ltr"
          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.auth.newPassword}
        </label>
        <input
          type="password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          dir="ltr"
          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
        />
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          {t.auth.minPasswordHint}
        </p>
      </div>
    </ModalDialog>
  );
}
