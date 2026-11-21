import { Plus, Receipt, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { CurrencyCode, CustomerAdjustmentType } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type CustomerLedgerDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';

interface CustomerLedgerModalProps {
  customerId: number | null;
  onClose: () => void;
  onUpdated?: () => void | Promise<void>;
}

export function CustomerLedgerModal({ customerId, onClose, onUpdated }: CustomerLedgerModalProps) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [ledger, setLedger] = useState<CustomerLedgerDto | null>(null);
  const [loading, setLoading] = useState(false);

  // Adjustment sub-modal
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [submittingAdj, setSubmittingAdj] = useState(false);
  const [adjType, setAdjType] = useState<CustomerAdjustmentType>('CREDIT_NOTE');
  const [adjContractId, setAdjContractId] = useState('');
  const [adjAmountMajor, setAdjAmountMajor] = useState('');
  const [adjCurrency, setAdjCurrency] = useState<CurrencyCode>('DZD');
  const [adjDate, setAdjDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [adjReason, setAdjReason] = useState('');

  const canApproveAdjustment = hasPermission('finance:approve_adjustment');

  const loadLedger = useCallback(async () => {
    if (customerId == null) return;
    setLoading(true);
    try {
      const res = await erpClient.getCustomerFinancialLedger(customerId);
      setLedger(res);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
      onClose();
    } finally {
      setLoading(false);
    }
  }, [customerId, onClose, showError, t.common.error]);

  useEffect(() => {
    if (customerId != null) {
      void loadLedger();
    } else {
      setLedger(null);
    }
  }, [customerId, loadLedger]);

  const openAdjustModal = () => {
    setAdjType('CREDIT_NOTE');
    setAdjContractId('');
    setAdjAmountMajor('');
    setAdjCurrency('DZD');
    setAdjDate(new Date().toISOString().slice(0, 10));
    setAdjReason('');
    setShowAdjustModal(true);
  };

  const handleSubmitAdjustment = async (e: FormEvent) => {
    e.preventDefault();
    if (!ledger) return;
    setSubmittingAdj(true);
    try {
      const updated = await erpClient.createCustomerAdjustment({
        customerId: ledger.customer.id,
        contractId: adjContractId ? Number(adjContractId) : null,
        adjustmentType: adjType,
        amountMinor: toMinorUnits(Number(adjAmountMajor || 0)),
        currency: adjCurrency,
        adjustmentDate: adjDate,
        reason: adjReason.trim(),
      });
      setLedger(updated);
      setShowAdjustModal(false);
      showSuccess(t.common.save);
      if (onUpdated) await onUpdated();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingAdj(false);
    }
  };

  if (customerId == null) return null;

  return (
    <>
      <ModalDialog
        open={customerId != null}
        onClose={onClose}
        title={t.finance.accounts.ledgerTitle}
        subtitle={
          ledger
            ? `${
                ledger.customer.companyName
                  ? `${ledger.customer.companyName} · ${ledger.customer.fullName}`
                  : ledger.customer.fullName
              } · ${formatDigits(ledger.customer.phone, numerals)}`
            : t.common.loading
        }
        size="2xl"
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.common.close}
            </button>
            {canApproveAdjustment && ledger && (
              <button
                type="button"
                onClick={openAdjustModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.finance.accounts.newAdjustment}</span>
              </button>
            )}
          </>
        }
      >
        {loading || !ledger ? (
          <div className="py-10 text-center text-sm text-slate-500">{t.common.loading}</div>
        ) : (
          <div className="space-y-5">
            {/* Financial Account Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.customers.totalCharged}</div>
                <div className="text-sm font-bold font-mono-tabular mt-1">
                  {formatCurrencyMinor(ledger.metrics.totalChargedMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.customers.totalPaid}</div>
                <div className="text-sm font-bold font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
                  {formatCurrencyMinor(ledger.metrics.netPaidMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.finance.accounts.creditAdjustments}</div>
                <div className="text-sm font-bold font-mono-tabular text-blue-700 dark:text-blue-400 mt-1">
                  {formatCurrencyMinor(ledger.metrics.creditAndWriteOffMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.customers.outstanding}</div>
                <div className="text-sm font-bold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
                  {formatCurrencyMinor(ledger.metrics.outstandingBalanceMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500">{t.finance.accounts.overdueDebt}</div>
                <div className="text-sm font-bold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
                  {formatCurrencyMinor(ledger.metrics.overdueDebtMinor, 'DZD', lang, numerals)}
                </div>
              </div>
            </div>

            {/* Contracts Breakdown */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                {t.contracts.tabContracts} ({formatDigits(ledger.contracts.length, numerals)})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/60 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-start">{t.contracts.contractNumber}</th>
                      <th className="px-3 py-2 text-start">{t.nav.vehicles}</th>
                      <th className="px-3 py-2 text-start">{t.vehicles.statusLabel}</th>
                      <th className="px-3 py-2 text-end">{t.contracts.totalContract}</th>
                      <th className="px-3 py-2 text-end">{t.contracts.paidAmount}</th>
                      <th className="px-3 py-2 text-end">{t.contracts.remainingBalance}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {ledger.contracts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          —
                        </td>
                      </tr>
                    ) : (
                      ledger.contracts.map((c) => (
                        <tr key={c.id}>
                          <td className="px-3 py-2 font-mono-tabular font-medium">
                            <Link
                              to={`/contracts/${c.id}`}
                              onClick={onClose}
                              className="text-blue-700 dark:text-blue-400 hover:underline"
                            >
                              {c.contractNumber}
                            </Link>
                            {c.isOverdue && (
                              <span className="ms-1.5 px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                                {t.finance.accounts.overdueBadge}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">{c.vehicleLabel}</td>
                          <td className="px-3 py-2">{t.contracts.statuses[c.status]}</td>
                          <td className="px-3 py-2 text-end font-mono-tabular">
                            {formatCurrencyMinor(
                              c.totalContractAmountMinor + c.adjustmentNetMinor,
                              c.currency,
                              lang,
                              numerals
                            )}
                          </td>
                          <td className="px-3 py-2 text-end font-mono-tabular text-emerald-700 dark:text-emerald-400">
                            {formatCurrencyMinor(c.paidNetMinor, c.currency, lang, numerals)}
                          </td>
                          <td className="px-3 py-2 text-end font-mono-tabular font-semibold text-amber-700 dark:text-amber-400">
                            {formatCurrencyMinor(c.outstandingMinor, c.currency, lang, numerals)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Adjustments & Payments side-by-side / stacked */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center gap-2">
                  <Receipt className="w-3.5 h-3.5 text-slate-500" />
                  <span>{t.finance.tabs.payments}</span>
                </div>
                <div className="overflow-x-auto max-h-60">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {ledger.payments.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500">—</td>
                        </tr>
                      ) : (
                        ledger.payments.map((p) => (
                          <tr key={p.id}>
                            <td className="px-3 py-2 font-mono-tabular">
                              <div>{p.receiptNumber}</div>
                              <div className="text-[11px] text-slate-500">{p.paymentDate}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div>{p.contractNumber}</div>
                              <div className="text-[11px] text-slate-500">{t.finance.methods[p.method]}</div>
                            </td>
                            <td
                              className={`px-3 py-2 text-end font-mono-tabular font-semibold ${
                                p.direction === 'REFUND'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {p.direction === 'REFUND' ? '−' : '+'}
                              {formatCurrencyMinor(p.amountMinor, p.currency, lang, numerals)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                  {t.finance.accounts.adjustmentsHistory}
                </div>
                <div className="overflow-x-auto max-h-60">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {ledger.adjustments.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500">—</td>
                        </tr>
                      ) : (
                        ledger.adjustments.map((adj) => (
                          <tr key={adj.id}>
                            <td className="px-3 py-2 font-mono-tabular">
                              <div>{adj.adjustmentCode}</div>
                              <div className="text-[11px] text-slate-500">{adj.adjustmentDate}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium">
                                {t.finance.adjustmentTypes[adj.adjustmentType]}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {adj.reason} · {adj.authorizedByUsername}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-end font-mono-tabular font-semibold">
                              {formatCurrencyMinor(adj.amountMinor, adj.currency, lang, numerals)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Deposits Held Liability (Separate) */}
            {ledger.deposits.length > 0 && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>{t.finance.accounts.depositsHeldSection}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {ledger.deposits.map((dep) => (
                        <tr key={dep.id}>
                          <td className="px-3 py-2 font-mono-tabular">{dep.contractNumber}</td>
                          <td className="px-3 py-2">{t.finance.depositStatuses[dep.status]}</td>
                          <td className="px-3 py-2 font-mono-tabular">
                            {formatDateTimeAlgiers(dep.receivedDate, lang, numerals)}
                          </td>
                          <td className="px-3 py-2 text-end font-mono-tabular font-semibold">
                            {formatCurrencyMinor(dep.remainingHeldMinor, dep.currency, lang, numerals)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </ModalDialog>

      {/* Adjustment Modal */}
      <ModalDialog
        open={showAdjustModal}
        onClose={() => {
          if (!submittingAdj) setShowAdjustModal(false);
        }}
        title={t.finance.accounts.newAdjustment}
        subtitle={ledger?.customer.fullName}
        size="md"
        disableClose={submittingAdj}
        onSubmit={handleSubmitAdjustment}
        footer={
          <>
            <button
              type="button"
              disabled={submittingAdj}
              onClick={() => setShowAdjustModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submittingAdj}
              className="px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {submittingAdj ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.accounts.adjustmentType}
            </label>
            <select
              data-autofocus
              value={adjType}
              onChange={(e) => setAdjType(e.target.value as CustomerAdjustmentType)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="CREDIT_NOTE">{t.finance.adjustmentTypes.CREDIT_NOTE}</option>
              <option value="DEBIT_CHARGE">{t.finance.adjustmentTypes.DEBIT_CHARGE}</option>
              <option value="WRITE_OFF">{t.finance.adjustmentTypes.WRITE_OFF}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.accounts.contractScope}
            </label>
            <select
              value={adjContractId}
              onChange={(e) => setAdjContractId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="">{t.finance.accounts.allCustomerContracts}</option>
              {ledger?.contracts
                .filter((c) => c.status !== 'CANCELLED')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contractNumber} ({formatCurrencyMinor(c.outstandingMinor, c.currency, lang, numerals)})
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.accounts.adjustmentAmount} *
            </label>
            <input
              type="number"
              required
              min={0.01}
              step="0.01"
              dir="ltr"
              value={adjAmountMajor}
              onChange={(e) => setAdjAmountMajor(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.accounts.adjustmentDate} *
            </label>
            <input
              type="date"
              required
              dir="ltr"
              value={adjDate}
              onChange={(e) => setAdjDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.accounts.adjustmentReason} *
          </label>
          <textarea
            rows={3}
            required
            minLength={3}
            value={adjReason}
            onChange={(e) => setAdjReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>
    </>
  );
}
