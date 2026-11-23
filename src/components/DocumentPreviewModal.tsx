import { CopyPlus, Download, FileCheck2, Printer, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AppLanguage,
  DocumentFormat,
  GeneratedDocument,
  SystemPrinterInfo,
} from '../../shared/types/domain.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../hooks/useI18n.tsx';
import { erpClient, isDesktopRuntime } from '../lib/apiClient.ts';
import { formatDateTimeAlgiers } from '../lib/formatters.ts';
import {
  base64ToBlobUrl,
  downloadBase64File,
  printPdfInBrowserIframe,
} from '../lib/pdfExport.ts';
import { ModalDialog } from './ModalDialog.tsx';
import { useToast } from './Toast.tsx';

export interface DocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  documentId?: number | null;
  initialDocument?: GeneratedDocument | null;
  initialPdfBase64?: string | null;
  onDocumentUpdated?: (doc: GeneratedDocument) => void;
}

const ALL_FORMATS: DocumentFormat[] = [
  'A4_PDF',
  'A4_LANDSCAPE_PDF',
  'THERMAL_80MM',
  'THERMAL_58MM',
];

export function DocumentPreviewModal({
  open,
  onClose,
  documentId,
  initialDocument,
  initialPdfBase64,
  onDocumentUpdated,
}: DocumentPreviewModalProps) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showSuccess, showError } = useToast();

  const [doc, setDoc] = useState<GeneratedDocument | null>(initialDocument ?? null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(initialPdfBase64 ?? null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [printers, setPrinters] = useState<SystemPrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [copies, setCopies] = useState(1);
  const [silentPrint, setSilentPrint] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [reprintFormat, setReprintFormat] = useState<DocumentFormat>('A4_PDF');
  const [reprintLang, setReprintLang] = useState<AppLanguage>(lang);
  const [reprinting, setReprinting] = useState(false);

  const desktop = isDesktopRuntime();
  const canReprint = hasPermission('documents:reprint');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadError(null);

    const load = async () => {
      if (initialDocument && initialPdfBase64) {
        setDoc(initialDocument);
        setPdfBase64(initialPdfBase64);
        setReprintFormat(initialDocument.format);
        setReprintLang(initialDocument.language);
      } else if (documentId) {
        setLoading(true);
        try {
          const res = await erpClient.readDocumentPdf(documentId);
          if (!active) return;
          setDoc(res.document);
          setPdfBase64(res.base64Data);
          setReprintFormat(res.document.format);
          setReprintLang(res.document.language);
        } catch (err) {
          if (!active) return;
          setLoadError(err instanceof Error ? err.message : t.common.error);
        } finally {
          if (active) setLoading(false);
        }
      }

      try {
        const list = await erpClient.listPrinters();
        if (!active) return;
        setPrinters(list);
        const def = list.find((p) => p.isDefault) ?? list[0];
        if (def) setSelectedPrinter(def.name);
      } catch {
        // Non-blocking in browser mode
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [open, documentId, initialDocument, initialPdfBase64, t.common.error]);

  useEffect(() => {
    if (!open || !pdfBase64) {
      setBlobUrl(null);
      return;
    }
    const url = base64ToBlobUrl(pdfBase64, 'application/pdf');
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [open, pdfBase64]);

  const handleDownload = () => {
    if (!doc || !pdfBase64) return;
    downloadBase64File(doc.originalFileName || `${doc.documentNumber}.pdf`, 'application/pdf', pdfBase64);
  };

  const handlePrint = async () => {
    if (!doc || !pdfBase64) return;
    setPrinting(true);
    try {
      if (desktop) {
        const res = await erpClient.printDocument({
          documentId: doc.id,
          printerName: selectedPrinter || null,
          silent: silentPrint,
          copies,
        });
        setDoc(res.document);
        onDocumentUpdated?.(res.document);
        showSuccess(t.documents.preview.printSuccessDesktop);
      } else {
        await printPdfInBrowserIframe(pdfBase64);
        const res = await erpClient.printDocument({
          documentId: doc.id,
          printerName: null,
          silent: false,
          copies,
        });
        setDoc(res.document);
        onDocumentUpdated?.(res.document);
        showSuccess(t.documents.preview.printSuccessBrowser);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setPrinting(false);
    }
  };

  const handleReprintCopy = async () => {
    if (!doc || !canReprint) return;
    setReprinting(true);
    try {
      const targetId = doc.sourceDocumentId ?? doc.id;
      const res = await erpClient.reprintDocument({
        sourceDocumentId: targetId,
        format: reprintFormat,
        language: reprintLang,
      });
      setDoc(res.document);
      setPdfBase64(res.pdfBase64);
      onDocumentUpdated?.(res.document);
      showSuccess(t.documents.preview.copyCreatedSuccess);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setReprinting(false);
    }
  };

  const kindLabel = doc ? t.documents.kinds[doc.documentKind] : '';
  const formatLabel = doc ? t.documents.formats[doc.format] : '';

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex flex-wrap items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
          <span>{doc ? `${doc.documentNumber} — ${kindLabel}` : t.documents.preview.title}</span>
        </div>
      }
      subtitle={
        doc ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>{formatLabel}</span>
            <span>·</span>
            <span
              className={`px-1.5 py-0.5 rounded border font-semibold ${
                doc.isCopy
                  ? 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {doc.isCopy
                ? `${t.documents.table.copyTag}${doc.sourceDocumentNumber ? ` (${t.documents.table.sourcePrefix} ${doc.sourceDocumentNumber})` : ''}`
                : t.documents.table.originalTag}
            </span>
            <span>·</span>
            <span>{doc.language.toUpperCase()}</span>
          </div>
        ) : undefined
      }
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-3">
            {doc?.sha256Hash && (
              <span className="inline-flex items-center gap-1 font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                {t.documents.preview.sha256Label}: {doc.sha256Hash.slice(0, 14)}…
              </span>
            )}
            {doc && (
              <span>
                {t.documents.preview.lastPrintedLabel}:{' '}
                {doc.lastPrintedAt
                  ? formatDateTimeAlgiers(doc.lastPrintedAt, lang, numerals)
                  : t.documents.preview.neverPrinted}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!pdfBase64}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t.documents.preview.downloadPdf}</span>
            </button>
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={!pdfBase64 || printing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{printing ? t.common.loading : t.documents.preview.printNow}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {t.common.close}
            </button>
          </div>
        </div>
      }
    >
      {/* Print & Copy Toolbar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
        {/* Printer controls */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {t.documents.preview.printerLabel}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {desktop && printers.length > 0 ? (
              <select
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName || p.name}
                    {p.isDefault ? ' ★' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400">
                {t.documents.preview.browserFallbackPrinter}
              </div>
            )}
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <span>{t.documents.preview.copiesLabel}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="w-14 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums"
              />
            </label>
          </div>
          {desktop && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={silentPrint}
                onChange={(e) => setSilentPrint(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700"
              />
              <span>{t.documents.preview.silentPrint}</span>
            </label>
          )}
        </div>

        {/* Reprint certified copy controls */}
        {canReprint && doc && (
          <div className="space-y-2 border-t lg:border-t-0 lg:border-s border-slate-200 dark:border-slate-800 pt-2 lg:pt-0 lg:ps-3">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t.documents.preview.reprintCopy}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={reprintFormat}
                onChange={(e) => setReprintFormat(e.target.value as DocumentFormat)}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                {ALL_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t.documents.formats[f]}
                  </option>
                ))}
              </select>
              <select
                value={reprintLang}
                onChange={(e) => setReprintLang(e.target.value as AppLanguage)}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                <option value="fr">FR</option>
                <option value="ar">AR</option>
              </select>
              <button
                type="button"
                disabled={reprinting}
                onClick={() => void handleReprintCopy()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <CopyPlus className="w-3.5 h-3.5" />
                <span>{reprinting ? t.common.loading : t.documents.preview.reprintCopy}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t.documents.preview.reprintHint}
            </p>
          </div>
        )}
      </div>

      {/* Inline PDF Viewer */}
      {loading && (
        <div className="h-[540px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 text-sm text-slate-500">
          {t.common.loading}
        </div>
      )}

      {!loading && loadError && (
        <div className="p-4 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-sm text-rose-700 dark:text-rose-300">
          {loadError}
        </div>
      )}

      {!loading && !loadError && blobUrl && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-200 dark:bg-slate-950">
          <iframe
            src={blobUrl}
            title={doc?.documentNumber || t.documents.preview.title}
            className="w-full h-[560px] bg-white"
          />
        </div>
      )}
    </ModalDialog>
  );
}
