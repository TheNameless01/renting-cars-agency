import { Plus, Receipt, RotateCcw, Search } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { PaymentDirection, PaymentMethod } from '../../../shared/types/domain.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type ContractListItemDto,
  type PaymentItemDto,
  type PaymentReceiptDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';
import { PaymentReceiptModal } from './PaymentReceiptModal.tsx';

export function PaymentsTab() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [payments, setPayments] = useState<PaymentItemDto[]>([]);
  const [contracts, setContracts] = useState<ContractListItemDto[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [directionFilter, setDirectionFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Record payment modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [submittingRecord, setSubmittingRecord] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [direction, setDirection] = useState<PaymentDirection>('INFLOW');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [amountMajor, setAmountMajor] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');

  // Receipt modal
  const [receipt, setReceipt] = useState<PaymentReceiptDto | null>(null);

  // Reverse modal
  const [reverseTarget, setReverseTarget] = useState<PaymentItemDto | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [submittingReverse, setSubmittingReverse] = useState(false);

  const canRecord = hasPermission('finance:record_payment');
  const canReverse = hasPermission('finance:approve_adjustment');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [payRows, contractRows] = await Promise.all([
        erpClient.listPayments({
          search: search.trim() || undefined,
          method: methodFilter !== 'ALL' ? methodFilter : undefined,
          direction: directionFilter !== 'ALL' ? directionFilter : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
        erpClient.listContracts(),
      ]);
      setPayments(payRows);
      setContracts(contractRows.filter((c) => c.status !== 'CANCELLED'));
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, directionFilter, methodFilter, search, showError, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedContract = contracts.find((c) => String(c.id) === selectedContractId) ?? null;

  const openRecordModal = () => {
    const first = contracts.find((c) => c.outstandingMinor > 0) ?? contracts[0] ?? null;
    setSelectedContractId(first ? String(first.id) : '');
    setDirection('INFLOW');
    setMethod('CASH');
    setPaymentReference('');
    setAmountMajor(first && first.outstandingMinor > 0 ? String(fromMinorUnits(first.outstandingMinor)) : '');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setDescription('');
    setShowRecordModal(true);
  };

  const handleSubmitRecord = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedContract) return;
    setSubmittingRecord(true);
    try {
      const createdReceipt = await erpClient.recordPayment({
        contractId: selectedContract.id,
        direction,
        method,
        paymentReference: paymentReference.trim() || null,
        amountMinor: toMinorUnits(Number(amountMajor || 0)),
        currency: selectedContract.currency,
        paymentDate,
        description: description.trim() || null,
      });
      showSuccess(createdReceipt.payment.receiptNumber);
      setShowRecordModal(false);
      setReceipt(createdReceipt);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingRecord(false);
    }
  };

  const handleOpenReceipt = async (paymentId: number) => {
    try {
      const res = await erpClient.getPaymentReceipt(paymentId);
      setReceipt(res);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleConfirmReverse = async () => {
    if (!reverseTarget || reverseReason.trim().length < 3) return;
    setSubmittingReverse(true);
    try {
      const revReceipt = await erpClient.reversePayment(reverseTarget.id, reverseReason.trim());
      showSuccess(revReceipt.payment.receiptNumber);
      setReverseTarget(null);
      setReverseReason('');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingReverse(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters & Action */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative min-w-[210px] flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.contracts.searchPlaceholder}
              className="w-full ps-8 pe-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="ALL">{t.contracts.filterAll}</option>
            {(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER'] as const).map((m) => (
              <option key={m} value={m}>
                {t.finance.methods[m]}
              </option>
            ))}
          </select>
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="ALL">{t.contracts.filterAll}</option>
            <option value="INFLOW">{t.finance.directions.INFLOW}</option>
            <option value="REFUND">{t.finance.directions.REFUND}</option>
          </select>
          <input
            type="date"
            dir="ltr"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
          />
          <input
            type="date"
            dir="ltr"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
          />
        </div>

        {canRecord && (
          <button
            type="button"
            onClick={openRecordModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.finance.payments.recordPayment}</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start">Code / Reçu</th>
                <th className="px-4 py-3 text-start">{t.contracts.contractNumber}</th>
                <th className="px-4 py-3 text-start">{t.nav.customers}</th>
                <th className="px-4 py-3 text-start">{t.finance.payments.paymentDateLabel}</th>
                <th className="px-4 py-3 text-start">{t.finance.payments.methodLabel}</th>
                <th className="px-4 py-3 text-end">{t.finance.payments.amountLabel}</th>
                <th className="px-4 py-3 text-end">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {t.common.loading}
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {t.finance.payments.empty}
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-mono-tabular">
                      <div className="font-semibold">{formatDigits(p.receiptNumber, numerals)}</div>
                      <div className="text-[11px] text-slate-500">{formatDigits(p.transactionCode, numerals)}</div>
                      {p.isReversed && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-sans">
                          {t.finance.payments.reversedBadge}
                        </span>
                      )}
                      {p.reversalOfPaymentId != null && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-sans">
                          {t.finance.payments.reversalEntryBadge}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/contracts/${p.contractId}`}
                        className="font-mono-tabular font-medium text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        {p.contractNumber}
                      </Link>
                      <div className="text-[11px] text-slate-500">{p.vehicleLabel}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/customers/${p.customerId}`} className="hover:underline font-medium">
                        {p.customerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular">{formatDigits(p.paymentDate, numerals)}</td>
                    <td className="px-4 py-3">
                      <div>{t.finance.methods[p.method]}</div>
                      {p.paymentReference && (
                        <div className="font-mono-tabular text-[11px] text-slate-500">{p.paymentReference}</div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 text-end font-mono-tabular font-semibold ${
                        p.direction === 'REFUND'
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {p.direction === 'REFUND' ? '−' : '+'}
                      {formatCurrencyMinor(p.amountMinor, p.currency, lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleOpenReceipt(p.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Receipt className="w-3 h-3" />
                          <span>{t.finance.payments.viewReceipt}</span>
                        </button>
                        {canReverse && !p.isReversed && p.reversalOfPaymentId == null && (
                          <button
                            type="button"
                            onClick={() => {
                              setReverseTarget(p);
                              setReverseReason('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{t.finance.payments.reversePayment}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Payment Modal */}
      <ModalDialog
        open={showRecordModal}
        onClose={() => {
          if (!submittingRecord) setShowRecordModal(false);
        }}
        title={t.finance.payments.recordPayment}
        size="md"
        disableClose={submittingRecord}
        onSubmit={handleSubmitRecord}
        footer={
          <>
            <button
              type="button"
              disabled={submittingRecord}
              onClick={() => setShowRecordModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submittingRecord || !selectedContract}
              className="px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {submittingRecord ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.payments.selectContract} *
          </label>
          <select
            required
            data-autofocus
            value={selectedContractId}
            onChange={(e) => {
              const nextId = e.target.value;
              setSelectedContractId(nextId);
              const found = contracts.find((c) => String(c.id) === nextId);
              if (found && direction === 'INFLOW') {
                setAmountMajor(found.outstandingMinor > 0 ? String(fromMinorUnits(found.outstandingMinor)) : '');
              }
            }}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.contractNumber} · {c.customerName} ({formatCurrencyMinor(c.outstandingMinor, c.currency, lang, numerals)})
              </option>
            ))}
          </select>
          {selectedContract && (
            <p className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
              {t.finance.payments.contractRemainingHint}:{' '}
              {formatCurrencyMinor(selectedContract.outstandingMinor, selectedContract.currency, lang, numerals)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.payments.directionLabel}
            </label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as PaymentDirection)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="INFLOW">{t.finance.directions.INFLOW}</option>
              <option value="REFUND">{t.finance.directions.REFUND}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.payments.methodLabel}
            </label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER'] as const).map((m) => (
                <option key={m} value={m}>
                  {t.finance.methods[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.payments.amountLabel} ({selectedContract?.currency ?? 'DZD'}) *
            </label>
            <input
              type="number"
              required
              min={0.01}
              step="0.01"
              dir="ltr"
              value={amountMajor}
              onChange={(e) => setAmountMajor(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.payments.paymentDateLabel} *
            </label>
            <input
              type="date"
              required
              dir="ltr"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.payments.referenceLabel}
          </label>
          <input
            dir="ltr"
            value={paymentReference}
            onChange={(e) => setPaymentReference(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.payments.descriptionLabel}
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Receipt Preview & PDF Modal */}
      <PaymentReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />

      {/* Reverse Payment Confirmation */}
      <ConfirmDialog
        open={Boolean(reverseTarget)}
        onClose={() => {
          if (!submittingReverse) setReverseTarget(null);
        }}
        onConfirm={handleConfirmReverse}
        tone="danger"
        loading={submittingReverse}
        title={t.finance.payments.reverseTitle}
        description={
          reverseTarget
            ? `${reverseTarget.receiptNumber} · ${reverseTarget.customerName} · ${formatCurrencyMinor(
                reverseTarget.amountMinor,
                reverseTarget.currency,
                lang,
                numerals
              )}`
            : ''
        }
        warningText={t.finance.payments.reverseWarn}
        confirmLabel={t.finance.payments.reversePayment}
      >
        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.payments.reverseReason} *
          </label>
          <textarea
            rows={2}
            required
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
