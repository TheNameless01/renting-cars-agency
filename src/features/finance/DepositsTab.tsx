import { AlertCircle, FileText, Plus, Search, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { GeneratedDocument, Vehicle } from '../../../shared/types/domain.ts';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type ContractListItemDto,
  type CustomerListItemDto,
  type DepositListItemDto,
  type TrafficFineDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';
import { DepositSettleModal } from './DepositSettleModal.tsx';

export function DepositsTab() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [deposits, setDeposits] = useState<DepositListItemDto[]>([]);
  const [fines, setFines] = useState<TrafficFineDto[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<CustomerListItemDto[]>([]);
  const [contracts, setContracts] = useState<ContractListItemDto[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedDepositId, setSelectedDepositId] = useState<number | null>(null);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDocument | null>(null);
  const [generatedPdfBase64, setGeneratedPdfBase64] = useState<string | null>(null);

  // New traffic fine modal
  const [showFineModal, setShowFineModal] = useState(false);
  const [submittingFine, setSubmittingFine] = useState(false);
  const [fineVehicleId, setFineVehicleId] = useState('');
  const [fineCustomerId, setFineCustomerId] = useState('');
  const [fineContractId, setFineContractId] = useState('');
  const [fineType, setFineType] = useState<'TRAFFIC' | 'RADAR' | 'PARKING' | 'OTHER'>('TRAFFIC');
  const [fineRef, setFineRef] = useState('');
  const [fineDate, setFineDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fineAmountDzd, setFineAmountDzd] = useState('');
  const [fineNotes, setFineNotes] = useState('');

  const canManageDeposits = hasPermission('finance:manage_deposit');
  const canGenerateDoc = hasPermission('documents:generate');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [depRows, fineRows, vehRows, custRows, contRows] = await Promise.all([
        erpClient.listDeposits({
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          search: search.trim() || undefined,
        }),
        erpClient.listTrafficFines(),
        erpClient.listVehicles({ includeArchived: false }),
        erpClient.listCustomers({ includeArchived: false }),
        erpClient.listContracts(),
      ]);
      setDeposits(depRows);
      setFines(fineRows);
      setVehicles(vehRows);
      setCustomers(custRows);
      setContracts(contRows);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [search, showError, statusFilter, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const heldDzd = deposits
    .filter((d) => d.currency === 'DZD')
    .reduce((acc, d) => acc + d.remainingHeldMinor, 0);
  const heldEur = deposits
    .filter((d) => d.currency === 'EUR')
    .reduce((acc, d) => acc + d.remainingHeldMinor, 0);
  const totalDeductedDzd = deposits
    .filter((d) => d.currency === 'DZD')
    .reduce((acc, d) => acc + d.deductedAmountMinor, 0);
  const totalRefundedDzd = deposits
    .filter((d) => d.currency === 'DZD')
    .reduce((acc, d) => acc + d.refundedAmountMinor, 0);

  const openNewFineModal = () => {
    setFineVehicleId(vehicles[0] ? String(vehicles[0].id) : '');
    setFineCustomerId(customers[0] ? String(customers[0].id) : '');
    setFineContractId('');
    setFineType('TRAFFIC');
    setFineRef('');
    setFineDate(new Date().toISOString().slice(0, 10));
    setFineAmountDzd('');
    setFineNotes('');
    setShowFineModal(true);
  };

  const handleSubmitFine = async (e: FormEvent) => {
    e.preventDefault();
    if (!fineVehicleId || !fineCustomerId) return;
    setSubmittingFine(true);
    try {
      await erpClient.createTrafficFine({
        contractId: fineContractId ? Number(fineContractId) : null,
        vehicleId: Number(fineVehicleId),
        customerId: Number(fineCustomerId),
        fineType,
        referenceNumber: fineRef.trim() || null,
        incurredDate: fineDate,
        amountMinor: toMinorUnits(Number(fineAmountDzd || 0)),
        notes: fineNotes.trim() || null,
      });
      showSuccess(t.common.save);
      setShowFineModal(false);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingFine(false);
    }
  };

  const handleGenerateDepositDoc = async (
    depositId: number,
    kind: 'DEPOSIT_RECEIPT' | 'DEPOSIT_SETTLEMENT'
  ) => {
    setGeneratingDoc(true);
    try {
      const res = await erpClient.generateDocument({
        documentKind: kind,
        depositId,
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
      setGeneratingDoc(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Non-negotiable Accounting Rule Banner */}
      <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{t.finance.deposits.liabilityNotice}</span>
      </div>

      {/* Liability KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.deposits.heldDzdKpi}</div>
          <div className="text-xl font-bold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
            {formatCurrencyMinor(heldDzd, 'DZD', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.deposits.heldEurKpi}</div>
          <div className="text-xl font-bold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
            {formatCurrencyMinor(heldEur, 'EUR', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.deposits.totalDeductedKpi}</div>
          <div className="text-xl font-bold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
            {formatCurrencyMinor(totalDeductedDzd, 'DZD', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.deposits.totalRefundedKpi}</div>
          <div className="text-xl font-bold font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
            {formatCurrencyMinor(totalRefundedDzd, 'DZD', lang, numerals)}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="ALL">{t.contracts.filterAll}</option>
            {(['HELD', 'PARTIALLY_DEDUCTED', 'RETURNED', 'FULLY_DEDUCTED'] as const).map((st) => (
              <option key={st} value={st}>
                {t.finance.depositStatuses[st]}
              </option>
            ))}
          </select>
        </div>

        {canManageDeposits && (
          <button
            type="button"
            onClick={openNewFineModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.finance.deposits.newFineBtn}</span>
          </button>
        )}
      </div>

      {/* Deposits Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start">{t.contracts.contractNumber}</th>
                <th className="px-4 py-3 text-start">{t.nav.customers}</th>
                <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                <th className="px-4 py-3 text-end">{t.finance.deposits.receivedAmount}</th>
                <th className="px-4 py-3 text-end">{t.finance.deposits.deductedAmount}</th>
                <th className="px-4 py-3 text-end">{t.finance.deposits.refundedAmount}</th>
                <th className="px-4 py-3 text-end">{t.finance.deposits.remainingHeld}</th>
                <th className="px-4 py-3 text-end">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {t.common.loading}
                  </td>
                </tr>
              ) : deposits.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {t.finance.deposits.emptyDeposits}
                  </td>
                </tr>
              ) : (
                deposits.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3">
                      <Link
                        to={`/contracts/${d.contractId}`}
                        className="font-mono-tabular font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        {d.contractNumber}
                      </Link>
                      <div className="text-[11px] text-slate-500">{d.vehicleLabel}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/customers/${d.customerId}`} className="font-medium hover:underline">
                        {d.customerName}
                      </Link>
                      <div className="text-[11px] font-mono-tabular text-slate-500">
                        {formatDateTimeAlgiers(d.receivedDate, lang, numerals)}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {t.finance.depositStatuses[d.status]}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular">
                      {formatCurrencyMinor(d.amountMinor, d.currency, lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular text-rose-700 dark:text-rose-400">
                      {formatCurrencyMinor(d.deductedAmountMinor, d.currency, lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular text-emerald-700 dark:text-emerald-400">
                      {formatCurrencyMinor(d.refundedAmountMinor, d.currency, lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular font-bold text-amber-700 dark:text-amber-400">
                      {formatCurrencyMinor(d.remainingHeldMinor, d.currency, lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        {canGenerateDoc && (
                          <>
                            <button
                              type="button"
                              disabled={generatingDoc}
                              onClick={() => void handleGenerateDepositDoc(d.id, 'DEPOSIT_RECEIPT')}
                              title={t.documents.triggers.depositReceiptPdf}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              <FileText className="w-3 h-3 text-blue-700 dark:text-blue-400" />
                              <span>{t.documents.triggers.depositReceiptPdf}</span>
                            </button>
                            {(d.deductedAmountMinor > 0 ||
                              d.refundedAmountMinor > 0 ||
                              d.status !== 'HELD') && (
                              <button
                                type="button"
                                disabled={generatingDoc}
                                onClick={() =>
                                  void handleGenerateDepositDoc(d.id, 'DEPOSIT_SETTLEMENT')
                                }
                                title={t.documents.triggers.depositSettlementPdf}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                              >
                                <FileText className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
                                <span>{t.documents.triggers.depositSettlementPdf}</span>
                              </button>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedDepositId(d.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <ShieldCheck className="w-3 h-3" />
                          <span>
                            {d.remainingHeldMinor > 0 && canManageDeposits
                              ? t.finance.deposits.settleDeposit
                              : t.common.view}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Traffic Fines Ledger */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
          {t.finance.deposits.finesSectionTitle} ({formatDigits(fines.length, numerals)})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-start">{t.finance.deposits.fineDate}</th>
                <th className="px-4 py-2.5 text-start">{t.finance.deposits.fineType}</th>
                <th className="px-4 py-2.5 text-start">{t.finance.deposits.fineVehicle}</th>
                <th className="px-4 py-2.5 text-start">{t.finance.deposits.fineCustomer}</th>
                <th className="px-4 py-2.5 text-start">{t.vehicles.statusLabel}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.deposits.fineAmount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {fines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    {t.finance.deposits.emptyFines}
                  </td>
                </tr>
              ) : (
                fines.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2.5 font-mono-tabular">
                      <div>{formatDigits(f.incurredDate, numerals)}</div>
                      {f.referenceNumber && (
                        <div className="text-[11px] text-slate-500">{f.referenceNumber}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{t.finance.fineTypes[f.fineType]}</td>
                    <td className="px-4 py-2.5">{f.vehicleLabel}</td>
                    <td className="px-4 py-2.5">
                      <div>{f.customerName}</div>
                      {f.contractNumber && (
                        <div className="text-[11px] font-mono-tabular text-slate-500">
                          {f.contractNumber}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                          f.isPaidByCustomer
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                            : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                        }`}
                      >
                        {f.isPaidByCustomer
                          ? t.finance.deposits.paidStatus
                          : t.finance.deposits.unpaidStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular font-semibold">
                      {formatCurrencyMinor(f.amountMinor, 'DZD', lang, numerals)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settle / Inspect Deposit Modal */}
      <DepositSettleModal
        depositId={selectedDepositId}
        onClose={() => setSelectedDepositId(null)}
        onSettled={loadData}
      />

      {/* New Traffic Fine Modal */}
      <ModalDialog
        open={showFineModal}
        onClose={() => {
          if (!submittingFine) setShowFineModal(false);
        }}
        title={t.finance.deposits.newFineBtn}
        size="md"
        disableClose={submittingFine}
        onSubmit={handleSubmitFine}
        footer={
          <>
            <button
              type="button"
              disabled={submittingFine}
              onClick={() => setShowFineModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submittingFine}
              className="px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {submittingFine ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.finance.deposits.fineVehicle} *</label>
            <select
              required
              data-autofocus
              value={fineVehicleId}
              onChange={(e) => setFineVehicleId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.brand} {v.model} ({v.matricule})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.finance.deposits.fineCustomer} *</label>
            <select
              required
              value={fineCustomerId}
              onChange={(e) => setFineCustomerId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName ? `${c.companyName} (${c.fullName})` : c.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.finance.deposits.fineContract}</label>
            <select
              value={fineContractId}
              onChange={(e) => setFineContractId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="">—</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contractNumber} · {c.customerName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.finance.deposits.fineType}</label>
            <select
              value={fineType}
              onChange={(e) => setFineType(e.target.value as 'TRAFFIC' | 'RADAR' | 'PARKING' | 'OTHER')}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {(['TRAFFIC', 'RADAR', 'PARKING', 'OTHER'] as const).map((ft) => (
                <option key={ft} value={ft}>
                  {t.finance.fineTypes[ft]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.finance.deposits.fineDate} *</label>
            <input
              type="date"
              required
              dir="ltr"
              value={fineDate}
              onChange={(e) => setFineDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.finance.deposits.fineAmount} *</label>
            <input
              type="number"
              required
              min={1}
              step="0.01"
              dir="ltr"
              value={fineAmountDzd}
              onChange={(e) => setFineAmountDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.finance.deposits.fineRef}</label>
          <input
            dir="ltr"
            value={fineRef}
            onChange={(e) => setFineRef(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.vehicles.notes}</label>
          <textarea
            rows={2}
            value={fineNotes}
            onChange={(e) => setFineNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      <DocumentPreviewModal
        open={docPreviewOpen}
        onClose={() => setDocPreviewOpen(false)}
        initialDocument={generatedDoc}
        initialPdfBase64={generatedPdfBase64}
      />
    </div>
  );
}
