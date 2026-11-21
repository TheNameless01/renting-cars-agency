import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEventHandler,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../hooks/useI18n.tsx';

type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';
type DialogVariant = 'modal' | 'drawer';

export interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: DialogSize;
  variant?: DialogVariant;
  subHeader?: ReactNode;
  footer?: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  closeOnBackdrop?: boolean;
  disableClose?: boolean;
  bodyClassName?: string;
  children: ReactNode;
}

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl',
};

const DRAWER_SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-xl',
  xl: 'max-w-2xl',
  '2xl': 'max-w-3xl',
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Module-level dialog stack coordinates nested modals, z-index layering,
// Escape handling, and body scroll locking safely across the whole app.
const openDialogStack: symbol[] = [];
const stackListeners = new Set<() => void>();
let previousBodyOverflow: string | null = null;

function notifyStackListeners() {
  for (const listener of stackListeners) {
    listener();
  }
}

function registerDialog(id: symbol) {
  if (openDialogStack.length === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  if (!openDialogStack.includes(id)) {
    openDialogStack.push(id);
    notifyStackListeners();
  }
}

function unregisterDialog(id: symbol) {
  const index = openDialogStack.indexOf(id);
  if (index !== -1) {
    openDialogStack.splice(index, 1);
    if (openDialogStack.length === 0) {
      document.body.style.overflow = previousBodyOverflow ?? '';
      previousBodyOverflow = null;
    }
    notifyStackListeners();
  }
}

export function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  variant = 'modal',
  subHeader,
  footer,
  onSubmit,
  closeOnBackdrop = false,
  disableClose = false,
  bodyClassName = 'p-5 space-y-4',
  children,
}: ModalDialogProps) {
  const { t, dir } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dialogSymbolRef = useRef<symbol | null>(null);
  if (!dialogSymbolRef.current) {
    dialogSymbolRef.current = Symbol('ModalDialog');
  }

  const [stackInfo, setStackInfo] = useState<{ index: number; isTopMost: boolean }>({
    index: 0,
    isTopMost: false,
  });

  useEffect(() => {
    const id = dialogSymbolRef.current!;
    const syncStack = () => {
      const idx = openDialogStack.indexOf(id);
      setStackInfo({
        index: idx >= 0 ? idx : 0,
        isTopMost: idx !== -1 && idx === openDialogStack.length - 1,
      });
    };

    stackListeners.add(syncStack);
    if (open) {
      registerDialog(id);
      syncStack();
    }

    return () => {
      stackListeners.delete(syncStack);
      if (open) {
        unregisterDialog(id);
      }
    };
  }, [open]);

  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const target = previousFocusRef.current;
      previousFocusRef.current = null;
      if (target && target.isConnected && typeof target.focus === 'function') {
        window.requestAnimationFrame(() => {
          target.focus();
        });
      }
    };
  }, [open]);

  // Focus entry, focus trap, and Escape handling (topmost dialog only)
  useEffect(() => {
    if (!open || !stackInfo.isTopMost) return;

    const panel = panelRef.current;

    const focusTimer = window.requestAnimationFrame(() => {
      if (!panel) return;
      if (panel.contains(document.activeElement)) return;
      const autoFocusEl = panel.querySelector<HTMLElement>('[data-autofocus], [autofocus]');
      if (autoFocusEl && !autoFocusEl.hasAttribute('disabled')) {
        autoFocusEl.focus();
        return;
      }
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el.getClientRects().length > 0
      );
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        panel.focus();
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      const id = dialogSymbolRef.current!;
      const isStillTop = openDialogStack[openDialogStack.length - 1] === id;
      if (!isStillTop) return;

      if (e.key === 'Escape') {
        if (!disableClose) {
          e.preventDefault();
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab' && panel) {
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null || el.getClientRects().length > 0
        );
        if (focusables.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!active || active === first || !panel.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (!active || active === last || !panel.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, stackInfo.isTopMost, disableClose]);

  if (!open) return null;

  const zIndex = 100 + stackInfo.index * 10;
  const maxWClass =
    variant === 'drawer' ? DRAWER_SIZE_CLASSES[size] : SIZE_CLASSES[size];

  const headerNode = (
    <div className="shrink-0 px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 bg-white dark:bg-slate-900">
      <div className="min-w-0">
        <h3
          id={titleId}
          className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-snug"
        >
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {!disableClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          title={t.common.close}
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const innerContent = (
    <>
      {subHeader && (
        <div className="shrink-0 px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
          {subHeader}
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${bodyClassName}`}>
        {children}
      </div>
      {footer && (
        <div className="shrink-0 px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 flex flex-wrap items-center justify-end gap-2">
          {footer}
        </div>
      )}
    </>
  );

  const panelClasses =
    variant === 'drawer'
      ? `w-full ${maxWClass} h-dvh max-h-dvh flex flex-col overflow-hidden bg-white dark:bg-slate-900 border-s border-slate-200 dark:border-slate-800 shadow-2xl focus:outline-none`
      : `w-full ${maxWClass} max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] flex flex-col overflow-hidden rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl focus:outline-none`;

  const containerClasses =
    variant === 'drawer'
      ? 'fixed inset-0 bg-slate-950/60 backdrop-blur-[1px] flex justify-end'
      : 'fixed inset-0 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-6';

  return createPortal(
    <div
      dir={dir}
      style={{ zIndex }}
      className={containerClasses}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && closeOnBackdrop && !disableClose) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={panelClasses}
      >
        {headerNode}
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {innerContent}
          </form>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{innerContent}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
