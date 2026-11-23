import { Download, FileCheck2, FileText } from 'lucide-react';
import { useState } from 'react';
import type { DocumentFormat, GeneratedDocument } from '../../../shared/types/domain.ts';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type PaymentReceiptDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';
import { exportPaymentReceiptPdf } from '../../lib/pdfExport.ts';

interface PaymentReceiptModalProps {
  receipt: PaymentReceiptDto | null;
  onClose: () => void;
}

export function PaymentReceiptModal({ receipt, onClose }: PaymentReceiptModalProps) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError } = useToast();

  const [pdfFormat, setPdfFormat] = useState<DocumentFormat>('A4_PDF');
  const [generating, setGenerating] = useState(false);
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDocument | null>(null);
  const [generatedPdfBase64, setGeneratedPdfBase64] = useState<string | null>(null);

  if (!receipt) {
    return null;
  }

  const p = receipt.payment;
  const canGenerateDoc = hasPermission('documents:generate');

  const handleGenerateArchivedReceipt = async () => {
    setGenerating(true);
    try {
      const res = await erpClient.generateDocument({
        documentKind: 'PAYMENT_RECEIPT',
        paymentId: p.id,
        format: pdfFormat,
        language: lang,
        numeralSystem: numerals,
      });
      setGeneratedDoc(res.document);
      setGeneratedPdfBase64(res.pdfBase64);
      setDocPreviewOpen(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <ModalDialog
        open={Boolean(receipt)}
        onClose={onClose}
        title={
          <span className="inline-flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span>{t.finance.payments.receiptTitle}</span>
          </span>
        }
        subtitle={`${formatDigits(p.receiptNumber, numerals)} · ${formatDigits(p.transactionCode, numerals)}`}
        size="lg"
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            {canGenerateDoc ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={pdfFormat}
                  onChange={(e) => setPdfFormat(e.target.value as DocumentFormat)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  <option value="A4_PDF">{t.documents.formats.A4_PDF}</option>
                  <option value="THERMAL_80MM">{t.documents.formats.THERMAL_80MM}</option>
                  <option value="THERMAL_58MM">{t.documents.formats.THERMAL_58MM}</option>
                </select>
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => void handleGenerateArchivedReceipt()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{generating ? t.common.loading : t.documents.triggers.paymentReceiptPdf}</span>
                </button>
              </div>
            ) : (
              <div />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => exportPaymentReceiptPdf(receipt, lang, numerals)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.finance.payments.downloadPdf}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {receipt.agency.name}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {receipt.agency.address} · {formatDigits(receipt.agency.phone, numerals)}
              </div>
              <div className="text-[11px] font-mono-tabular text-slate-500 mt-0.5">
                NIF: {receipt.agency.nif || '—'} · RC: {receipt.agency.rc || '—'}
              </div>
            </div>
            <div className="text-start sm:text-end">
              <div className="text-xs font-semibold text-blue-800 dark:text-blue-400">
                {t.finance.directions[p.direction]}
              </div>
              <div className="text-base font-bold font-mono-tabular">
                {formatDigits(p.receiptNumber, numerals)}
              </div>
              <div className="text-xs font-mono-tabular text-slate-500">
                {formatDigits(p.paymentDate, numerals)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="text-slate-500 font-medium">{t.contracts.wizard.selectCustomer}</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {receipt.customer.fullName}
              </div>
              <div className="font-mono-tabular text-slate-600 dark:text-slate-400">
                {formatDigits(receipt.customer.phone, numerals)}
              </div>
              {receipt.customer.address && (
                <div className="text-slate-500">{receipt.customer.address}</div>
              )}
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="text-slate-500 font-medium">{t.contracts.contractNumber}</div>
              <div className="text-sm font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
                {formatDigits(receipt.contract.contractNumber, numerals)}
              </div>
              <div className="text-slate-600 dark:text-slate-400">{receipt.contract.vehicleLabel}</div>
              <div className="font-mono-tabular text-slate-500">
                {formatDateTimeAlgiers(receipt.contract.startDate, lang, numerals)} →{' '}
                {formatDateTimeAlgiers(receipt.contract.expectedReturnDate, lang, numerals)}
              </div>
            </div>
          </div>

          <div
            className={`p-5 rounded-xl border text-center ${
              p.direction === 'REFUND'
                ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900'
                : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
            }`}
          >
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t.finance.directions[p.direction]} · {t.finance.methods[p.method]}
            </div>
            <div
              className={`text-2xl font-bold font-mono-tabular mt-1 ${
                p.direction === 'REFUND'
                  ? 'text-rose-800 dark:text-rose-300'
                  : 'text-emerald-800 dark:text-emerald-300'
              }`}
            >
              {formatCurrencyMinor(p.amountMinor, p.currency, lang, numerals)}
            </div>
            {p.paymentReference && (
              <div className="text-xs font-mono-tabular text-slate-600 dark:text-slate-400 mt-1">
                {t.finance.payments.referenceLabel}: {p.paymentReference}
              </div>
            )}
            {p.description && (
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{p.description}</div>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">{t.contracts.totalContract}</span>
              <span className="font-mono-tabular font-semibold">
                {formatCurrencyMinor(receipt.contract.totalContractAmountMinor, p.currency, lang, numerals)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">{t.contracts.paidAmount}</span>
              <span className="font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                {formatCurrencyMinor(receipt.contract.paidNetMinor, p.currency, lang, numerals)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-950">
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {t.contracts.remainingBalance}
              </span>
              <span className="font-mono-tabular font-bold text-amber-700 dark:text-amber-400">
                {formatCurrencyMinor(receipt.contract.outstandingMinor, p.currency, lang, numerals)}
              </span>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 flex items-center justify-between">
            <span>
              {receipt.recordedByFullName} ({p.recordedByUsername})
            </span>
            <span className="font-mono-tabular">
              {formatDateTimeAlgiers(p.createdAt, lang, numerals)}
            </span>
          </div>
        </div>
      </ModalDialog>

      <DocumentPreviewModal
        open={docPreviewOpen}
        onClose={() => setDocPreviewOpen(false)}
        initialDocument={generatedDoc}
        initialPdfBase64={generatedPdfBase64}
      />
    </>
  );
}
