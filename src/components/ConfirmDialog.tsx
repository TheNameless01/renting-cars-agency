import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { type ReactNode } from 'react';
import { useI18n } from '../hooks/useI18n.tsx';
import { ModalDialog } from './ModalDialog.tsx';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description: ReactNode;
  warningText?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'info';
  loading?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  warningText,
  confirmLabel,
  cancelLabel,
  tone = 'warning',
  loading = false,
  children,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  const icon =
    tone === 'danger' ? (
      <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
    ) : tone === 'warning' ? (
      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
    ) : (
      <Info className="w-5 h-5 text-blue-700 dark:text-blue-400 shrink-0" />
    );

  const confirmBtnClasses =
    tone === 'danger'
      ? 'bg-rose-700 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 text-white'
      : tone === 'warning'
        ? 'bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500 text-white'
        : 'bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white';

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </span>
      }
      size="sm"
      disableClose={loading}
      closeOnBackdrop={!loading}
      footer={
        <>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {cancelLabel ?? t.common.cancel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onConfirm()}
            data-autofocus
            className={`px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-50 ${confirmBtnClasses}`}
          >
            {loading ? t.common.loading : (confirmLabel ?? t.dialogs.confirmAction)}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{description}</p>
      {warningText && (
        <div
          className={`p-3 rounded-lg border text-xs leading-relaxed ${
            tone === 'danger'
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
          }`}
        >
          {warningText}
        </div>
      )}
      {children}
    </ModalDialog>
  );
}
