import { Download, Eye, FileText, ShieldCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type {
  DepositChargeCategory,
  GeneratedDocument,
  PaymentMethod,
} from '../../../shared/types/domain.ts';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type DepositDetailDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';

interface DepositSettleModalProps {
  depositId: number | null;
  onClose: () => void;
  onSettled: () => void | Promise<void>;
}

const MAX_DOC_BYTES = 5 * 1024 * 1024;

export function DepositSettleModal({ depositId, onClose, onSettled }: DepositSettleModalProps) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [detail, setDetail] = useState<DepositDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [deductMajor, setDeductMajor] = useState('0');
  const [refundMajor, setRefundMajor] = useState('0');
  const [chargeCategory, setChargeCategory] = useState<DepositChargeCategory>('DAMAGE');
  const [deductionReason, setDeductionReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('CASH');
  const [trafficFineId, setTrafficFineId] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);

  const [previewDoc, setPreviewDoc] = useState<{
    originalFileName: string;
    mimeType: string;
    base64Data: string;
  } | null>(null);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDocument | null>(null);
  const [generatedPdfBase64, setGeneratedPdfBase64] = useState<string | null>(null);

  const canManageDeposits = hasPermission('finance:manage_deposit');
  const canGenerateDoc = hasPermission('documents:generate');

  const loadDetail = useCallback(async () => {
    if (depositId == null) return;
    setLoading(true);
    try {
      const res = await erpClient.getDepositDetail(depositId);
      setDetail(res);
      setDeductMajor('0');
      setRefundMajor(String(fromMinorUnits(res.deposit.remainingHeldMinor)));
      setChargeCategory('DAMAGE');
      setDeductionReason('');
      setRefundMethod('CASH');
      setTrafficFineId('');
      setDocFile(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
      onClose();
    } finally {
      setLoading(false);
    }
  }, [depositId, onClose, showError, t.common.error]);

  useEffect(() => {
    if (depositId != null) {
      void loadDetail();
    } else {
      setDetail(null);
    }
  }, [depositId, loadDetail]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setDocFile(null);
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(f.type)) {
      showError('Format non supporté (PDF, JPG, PNG, WebP)');
      e.target.value = '';
      setDocFile(null);
      return;
    }
    if (f.size > MAX_DOC_BYTES) {
      showError(t.dialogs.fileTooLarge);
      e.target.value = '';
      setDocFile(null);
      return;
    }
    setDocFile(f);
  };

  const handleOpenEvidence = async () => {
    if (!detail) return;
    try {
      const doc = await erpClient.readDepositDoc(detail.deposit.id);
      setPreviewDoc(doc);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleGeneratePdf = async (kind: 'DEPOSIT_RECEIPT' | 'DEPOSIT_SETTLEMENT') => {
    if (!detail) return;
    setGeneratingPdf(true);
    try {
      const res = await erpClient.generateDocument({
        documentKind: kind,
        depositId: detail.deposit.id,
        format: 'A4_PDF',
        language: lang,
        numeralSystem: numerals,
      });
      setGeneratedDoc(res.document);
      setGeneratedPdfBase64(res.pdfBase64);
      setDocPreviewOpen(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    const deductedMinor = toMinorUnits(Number(deductMajor || 0));
    const refundedMinor = toMinorUnits(Number(refundMajor || 0));

    if (deductedMinor + refundedMinor <= 0) {
      showError(t.common.error);
      return;
    }

    setSubmitting(true);
    try {
      let supportingDoc: {
        originalFileName: string;
        mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
        base64Data: string;
      } | null = null;

      if (docFile) {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = String(reader.result || '');
            resolve(res.includes(',') ? res.split(',')[1] : res);
          };
          reader.onerror = () => reject(new Error(t.common.error));
          reader.readAsDataURL(docFile);
        });
        supportingDoc = {
          originalFileName: docFile.name,
          mimeType: docFile.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
          base64Data,
        };
      }

      await erpClient.settleDeposit({
        depositId: detail.deposit.id,
        deductedAmountMinor: deductedMinor,
        refundedAmountMinor: refundedMinor,
        chargeCategory: deductedMinor > 0 ? chargeCategory : null,
        deductionReason: deductionReason.trim() || null,
        refundMethod,
        trafficFineId: trafficFineId ? Number(trafficFineId) : null,
        supportingDoc,
      });

      showSuccess(t.common.save);
      await onSettled();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (depositId == null) return null;

  const d = detail?.deposit;
  const remaining = d?.remainingHeldMinor ?? 0;
  const parsedDeduct = toMinorUnits(Number(deductMajor || 0));
  const parsedRefund = toMinorUnits(Number(refundMajor || 0));
  const exceedsRemaining = parsedDeduct + parsedRefund > remaining;

  return (
    <>
      <ModalDialog
        open={depositId != null}
        onClose={() => {
          if (!submitting) onClose();
        }}
        title={t.finance.deposits.detailTitle}
        subtitle={
          d ? `${d.contractNumber} · ${d.customerName} · ${d.vehicleLabel}` : t.common.loading
        }
        size="xl"
        disableClose={submitting}
        onSubmit={canManageDeposits && remaining > 0 ? handleSubmit : undefined}
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            {d && canGenerateDoc ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={generatingPdf}
                  onClick={() => void handleGeneratePdf('DEPOSIT_RECEIPT')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
                  <span>{t.documents.triggers.depositReceiptPdf}</span>
                </button>
                {(d.deductedAmountMinor > 0 || d.refundedAmountMinor > 0 || d.status !== 'HELD') && (
                  <button
                    type="button"
                    disabled={generatingPdf}
                    onClick={() => void handleGeneratePdf('DEPOSIT_SETTLEMENT')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                    <span>{t.documents.triggers.depositSettlementPdf}</span>
                  </button>
                )}
              </div>
            ) : (
              <div />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {t.common.close}
              </button>
              {canManageDeposits && remaining > 0 && (
                <button
                  type="submit"
                  disabled={submitting || exceedsRemaining || parsedDeduct + parsedRefund <= 0}
                  className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
                >
                  {submitting ? t.common.loading : t.finance.deposits.settleDeposit}
                </button>
              )}
            </div>
          </div>
        }
      >
        {loading || !detail || !d ? (
          <div className="py-8 text-center text-sm text-slate-500">{t.common.loading}</div>
        ) : (
          <div className="space-y-5">
            {/* Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.finance.deposits.receivedAmount}</div>
                <div className="text-base font-bold font-mono-tabular mt-1">
                  {formatCurrencyMinor(d.amountMinor, d.currency, lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.finance.deposits.deductedAmount}</div>
                <div className="text-base font-bold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
                  {formatCurrencyMinor(d.deductedAmountMinor, d.currency, lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.finance.deposits.refundedAmount}</div>
                <div className="text-base font-bold font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
                  {formatCurrencyMinor(d.refundedAmountMinor, d.currency, lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.finance.deposits.remainingHeld}</div>
                <div className="text-base font-bold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
                  {formatCurrencyMinor(d.remainingHeldMinor, d.currency, lang, numerals)}
                </div>
              </div>
            </div>

            {/* Contract Charges & Supporting Document */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  {t.finance.deposits.contractChargesTitle}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500">{t.contracts.completeModal.damageCharge}: </span>
                    <span className="font-mono-tabular font-semibold">
                      {formatCurrencyMinor(detail.contractCharges.damageChargeMinor, d.currency, lang, numerals)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">{t.contracts.completeModal.lateFee}: </span>
                    <span className="font-mono-tabular font-semibold">
                      {formatCurrencyMinor(detail.contractCharges.lateFeeMinor, d.currency, lang, numerals)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">{t.finance.chargeCategories.EXTRA_KM}: </span>
                    <span className="font-mono-tabular font-semibold">
                      {formatCurrencyMinor(detail.contractCharges.extraKmChargeMinor, d.currency, lang, numerals)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">{t.contracts.completeModal.otherCharges}: </span>
                    <span className="font-mono-tabular font-semibold">
                      {formatCurrencyMinor(detail.contractCharges.otherChargesMinor, d.currency, lang, numerals)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-700 dark:text-slate-200">
                    {t.finance.deposits.supportingDoc}
                  </div>
                  <div className="text-slate-500 mt-1 font-mono-tabular">
                    {d.supportingDocOriginalName || '—'}
                  </div>
                </div>
                {d.hasSupportingDoc && (
                  <button
                    type="button"
                    onClick={() => void handleOpenEvidence()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{t.finance.deposits.viewDoc}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Settlement Form if remaining > 0 */}
            {canManageDeposits && remaining > 0 && (
              <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 space-y-4">
                <div className="text-xs font-semibold flex items-center gap-2 text-blue-900 dark:text-blue-300">
                  <ShieldCheck className="w-4 h-4" />
                  <span>{t.finance.deposits.settleDeposit}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {t.finance.deposits.newDeductAmount} ({d.currency})
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      dir="ltr"
                      data-autofocus
                      value={deductMajor}
                      onChange={(e) => {
                        setDeductMajor(e.target.value);
                        const dedMinor = toMinorUnits(Number(e.target.value || 0));
                        const remAfter = Math.max(0, remaining - dedMinor);
                        setRefundMajor(String(fromMinorUnits(remAfter)));
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {t.finance.deposits.newRefundAmount} ({d.currency})
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      dir="ltr"
                      value={refundMajor}
                      onChange={(e) => setRefundMajor(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {t.finance.deposits.chargeCategory}
                    </label>
                    <select
                      value={chargeCategory}
                      onChange={(e) => setChargeCategory(e.target.value as DepositChargeCategory)}
                      disabled={parsedDeduct <= 0}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-50"
                    >
                      {(
                        [
                          'DAMAGE',
                          'TRAFFIC_FINE',
                          'LATE_FEE',
                          'EXTRA_KM',
                          'CLEANING',
                          'FUEL',
                          'OTHER',
                        ] as const
                      ).map((cat) => (
                        <option key={cat} value={cat}>
                          {t.finance.chargeCategories[cat]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {t.finance.deposits.refundMethod}
                    </label>
                    <select
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                      disabled={parsedRefund <= 0}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-50"
                    >
                      {(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER'] as const).map((m) => (
                        <option key={m} value={m}>
                          {t.finance.methods[m]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {detail.fines.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium mb-1">{t.finance.deposits.linkFine}</label>
                    <select
                      value={trafficFineId}
                      onChange={(e) => setTrafficFineId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                    >
                      <option value="">{t.finance.deposits.noFineLinked}</option>
                      {detail.fines.map((f) => (
                        <option key={f.id} value={f.id}>
                          {t.finance.fineTypes[f.fineType]} · {f.referenceNumber || f.incurredDate} ·{' '}
                          {formatCurrencyMinor(f.amountMinor, 'DZD', lang, numerals)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {t.finance.deposits.deductionReason} {parsedDeduct > 0 ? '*' : ''}
                    </label>
                    <input
                      required={parsedDeduct > 0}
                      value={deductionReason}
                      onChange={(e) => setDeductionReason(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {t.finance.deposits.supportingDoc}
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900">
                      <Upload className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">
                        {docFile ? docFile.name : t.customers.vault.selectFile}
                      </span>
                      <input
                        type="file"
                        accept=".pdf,image/jpeg,image/png,image/webp"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {exceedsRemaining && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    {t.finance.deposits.remainingHeld}:{' '}
                    {formatCurrencyMinor(remaining, d.currency, lang, numerals)}
                  </p>
                )}
              </div>
            )}

            {/* Deposit Movement History */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                {t.finance.deposits.movementsTitle}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-start">{t.settings.audit.timestamp}</th>
                      <th className="px-3 py-2 text-start">{t.contracts.paymentMethod}</th>
                      <th className="px-3 py-2 text-start">{t.finance.deposits.chargeCategory}</th>
                      <th className="px-3 py-2 text-start">{t.settings.audit.details}</th>
                      <th className="px-3 py-2 text-end">{t.finance.payments.amountLabel}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {detail.movements.map((mv) => (
                      <tr key={mv.id}>
                        <td className="px-3 py-2 font-mono-tabular whitespace-nowrap">
                          {formatDateTimeAlgiers(mv.createdAt, lang, numerals)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-semibold">{mv.movementType}</span>
                          {mv.paymentMethod ? ` · ${t.finance.methods[mv.paymentMethod]}` : ''}
                        </td>
                        <td className="px-3 py-2">
                          {mv.chargeCategory ? t.finance.chargeCategories[mv.chargeCategory] : '—'}
                          {mv.fineReference ? ` (${mv.fineReference})` : ''}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          {mv.reason || '—'} · <span className="text-slate-400">{mv.recordedByUsername}</span>
                        </td>
                        <td className="px-3 py-2 text-end font-mono-tabular font-semibold">
                          {formatCurrencyMinor(mv.amountMinor, d.currency, lang, numerals)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </ModalDialog>

      {/* Decrypted Supporting Evidence Preview */}
      <ModalDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.originalFileName ?? t.finance.deposits.supportingDoc}
        size="lg"
        footer={
          previewDoc && (
            <>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                {t.common.close}
              </button>
              <a
                href={`data:${previewDoc.mimeType};base64,${previewDoc.base64Data}`}
                download={previewDoc.originalFileName}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.dialogs.downloadDoc}</span>
              </a>
            </>
          )
        }
      >
        {previewDoc &&
          (previewDoc.mimeType === 'application/pdf' ? (
            <iframe
              title={previewDoc.originalFileName}
              src={`data:application/pdf;base64,${previewDoc.base64Data}`}
              className="w-full h-[65vh] rounded-lg border border-slate-200 dark:border-slate-800"
            />
          ) : (
            <img
              src={`data:${previewDoc.mimeType};base64,${previewDoc.base64Data}`}
              alt={previewDoc.originalFileName}
              className="max-h-[65vh] mx-auto rounded-lg object-contain"
            />
          ))}
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
