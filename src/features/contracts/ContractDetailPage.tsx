import { AlertCircle, ArrowLeft, CalendarPlus, CheckCircle2, Play, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type AvailabilityResultDto, type ContractDetailDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';

type DetailTab = 'summary' | 'extensions' | 'payments';

function toLocalDateTimeInput(input: Date | string): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input) && !input.endsWith('Z')) {
    return input.slice(0, 16);
  }
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [detail, setDetail] = useState<ContractDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>('summary');

  // Activate Handover confirmation
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [activating, setActivating] = useState(false);

  // Extend modal
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extNewReturnDate, setExtNewReturnDate] = useState('');
  const [extAdditionalDzd, setExtAdditionalDzd] = useState('0');
  const [extAdditionalKm, setExtAdditionalKm] = useState('0');
  const [extNotes, setExtNotes] = useState('');
  const [extAvailability, setExtAvailability] = useState<AvailabilityResultDto | null>(null);

  // Complete modal
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [compReturnDate, setCompReturnDate] = useState(() => toLocalDateTimeInput(new Date()));
  const [compOdometerKm, setCompOdometerKm] = useState('0');
  const [compOdoReason, setCompOdoReason] = useState('');
  const [compLateFeeDzd, setCompLateFeeDzd] = useState('0');
  const [compDamageDzd, setCompDamageDzd] = useState('0');
  const [compOtherDzd, setCompOtherDzd] = useState('0');
  const [compNotes, setCompNotes] = useState('');

  // Cancel modal
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const canWrite = hasPermission('contracts:write');
  const canExtend = hasPermission('contracts:extend');
  const canCancel = hasPermission('contracts:cancel');

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await erpClient.getContractDetail(Number(id));
      setDetail(data);
      const nextDayMs = Date.parse(data.contract.expectedReturnDate) + 24 * 60 * 60 * 1000;
      setExtNewReturnDate(toLocalDateTimeInput(new Date(nextDayMs)));
      setCompOdometerKm(String(data.contract.departureOdometerKm));
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [id, showError, t.common.error]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const extDateValid = Boolean(
    detail &&
      extNewReturnDate &&
      !Number.isNaN(Date.parse(extNewReturnDate)) &&
      Date.parse(extNewReturnDate) > Date.parse(detail.contract.expectedReturnDate)
  );

  // Live availability & automatic pricing suggestion inside Extend Modal
  useEffect(() => {
    if (!showExtendModal || !detail || !extDateValid) {
      setExtAvailability(null);
      return;
    }

    let cancelled = false;
    Promise.all([
      erpClient.checkVehicleAvailability({
        vehicleId: detail.contract.vehicleId,
        startDate: detail.contract.expectedReturnDate,
        endDate: extNewReturnDate,
        excludeContractId: detail.contract.id,
      }),
      erpClient.calculateRentalPrice({
        vehicleId: detail.contract.vehicleId,
        customerId: detail.contract.customerId,
        startDate: detail.contract.expectedReturnDate,
        endDate: extNewReturnDate,
        pricingTier: 'AUTO',
      }),
    ])
      .then(([avail, res]) => {
        if (cancelled) return;
        setExtAvailability(avail);
        setExtAdditionalDzd(String(res.netTotalMinor / 100));
        if (detail.contract.mileageMode === 'DAILY_ALLOWANCE' && detail.contract.dailyMileageAllowanceKm) {
          setExtAdditionalKm(String(res.days * detail.contract.dailyMileageAllowanceKm));
        }
      })
      .catch(() => {
        if (!cancelled) setExtAvailability(null);
      });

    return () => {
      cancelled = true;
    };
  }, [showExtendModal, detail, extNewReturnDate, extDateValid]);

  const openExtendModal = () => {
    if (!detail) return;
    const nextDayMs = Date.parse(detail.contract.expectedReturnDate) + 24 * 60 * 60 * 1000;
    setExtNewReturnDate(toLocalDateTimeInput(new Date(nextDayMs)));
    setExtAdditionalDzd('0');
    setExtAdditionalKm('0');
    setExtNotes('');
    setExtAvailability(null);
    setShowExtendModal(true);
  };

  const openCompleteModal = () => {
    if (!detail) return;
    setCompReturnDate(toLocalDateTimeInput(new Date()));
    setCompOdometerKm(String(detail.contract.departureOdometerKm));
    setCompOdoReason('');
    setCompLateFeeDzd('0');
    setCompDamageDzd('0');
    setCompOtherDzd('0');
    setCompNotes('');
    setShowCompleteModal(true);
  };

  const openCancelModal = () => {
    setCancelReason('');
    setShowCancelModal(true);
  };

  const handleActivate = async () => {
    if (!detail) return;
    setActivating(true);
    try {
      await erpClient.activateContract(detail.contract.id);
      showSuccess(t.contracts.statuses.ACTIVE);
      setConfirmActivate(false);
      await loadDetail();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setActivating(false);
    }
  };

  const handleExtendSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail || !extDateValid) return;
    setExtending(true);
    try {
      await erpClient.extendContract({
        contractId: detail.contract.id,
        newReturnDate: extNewReturnDate,
        additionalAmountMinor: toMinorUnits(Number(extAdditionalDzd || 0)),
        additionalKmAllowance: Number(extAdditionalKm || 0),
        notes: extNotes.trim() || null,
      });
      showSuccess(t.contracts.statuses.EXTENDED);
      setShowExtendModal(false);
      setExtNotes('');
      await loadDetail();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setExtending(false);
    }
  };

  const handleCompleteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setCompleting(true);
    try {
      await erpClient.completeContract({
        contractId: detail.contract.id,
        actualReturnDate: compReturnDate,
        returnOdometerKm: Number(compOdometerKm),
        odometerCorrectionReason: compOdoReason.trim() || null,
        lateFeeMinor: toMinorUnits(Number(compLateFeeDzd || 0)),
        damageChargeMinor: toMinorUnits(Number(compDamageDzd || 0)),
        otherChargesMinor: toMinorUnits(Number(compOtherDzd || 0)),
        notes: compNotes.trim() || null,
      });
      showSuccess(t.contracts.statuses.COMPLETED);
      setShowCompleteModal(false);
      await loadDetail();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setCompleting(false);
    }
  };

  const handleCancelSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setCancelling(true);
    try {
      await erpClient.cancelContract(detail.contract.id, cancelReason.trim());
      showSuccess(t.contracts.statuses.CANCELLED);
      setShowCancelModal(false);
      await loadDetail();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setCancelling(false);
    }
  };

  if (loading || !detail) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">{t.common.loading}</div>
    );
  }

  const { contract: c, pricingItems, extensions, payments, deposit } = detail;
  const drivenKm = Math.max(0, Number(compOdometerKm || 0) - c.departureOdometerKm);
  const includedKmAllowance = c.includedTotalKm ?? 0;
  const estimatedExtraKm =
    c.mileageMode !== 'UNLIMITED' && includedKmAllowance > 0
      ? Math.max(0, drivenKm - includedKmAllowance)
      : 0;
  const estimatedExtraKmFeeMinor = estimatedExtraKm * c.extraKmRateMinor;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/contracts"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          </Link>
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 font-mono-tabular">
              {c.contractNumber} ·{' '}
              <span className="font-sans text-base font-semibold text-blue-800 dark:text-blue-400">
                {t.contracts.statuses[c.status]}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <Link to={`/customers/${c.customerId}`} className="hover:underline font-medium">
                {c.customerName}
              </Link>{' '}
              ·{' '}
              <Link to={`/vehicles/${c.vehicleId}`} className="hover:underline font-medium">
                {c.vehicleLabel}
              </Link>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canWrite && (c.status === 'DRAFT' || c.status === 'CONFIRMED') && (
            <button
              type="button"
              onClick={() => setConfirmActivate(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{t.contracts.activateHandover}</span>
            </button>
          )}
          {canExtend && (c.status === 'CONFIRMED' || c.status === 'ACTIVE' || c.status === 'EXTENDED') && (
            <button
              type="button"
              onClick={openExtendModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              <span>{t.contracts.extendContract}</span>
            </button>
          )}
          {canWrite && (c.status === 'ACTIVE' || c.status === 'EXTENDED') && (
            <button
              type="button"
              onClick={openCompleteModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t.contracts.completeContract}</span>
            </button>
          )}
          {canCancel && c.status !== 'COMPLETED' && c.status !== 'CANCELLED' && (
            <button
              type="button"
              onClick={openCancelModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs font-medium whitespace-nowrap"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>{t.contracts.cancelContract}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.contracts.totalContract}</div>
          <div className="text-xl font-semibold font-mono-tabular mt-1">
            {formatCurrencyMinor(c.totalContractAmountMinor, c.currency, lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.contracts.paidAmount}</div>
          <div className="text-xl font-semibold font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
            {formatCurrencyMinor(c.paidNetMinor, c.currency, lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.contracts.remainingBalance}</div>
          <div className="text-xl font-semibold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
            {formatCurrencyMinor(c.outstandingMinor, c.currency, lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.contracts.depositLabel}</div>
          <div className="text-xl font-semibold font-mono-tabular mt-1">
            {deposit ? formatCurrencyMinor(deposit.amountMinor, deposit.currency, lang, numerals) : '—'}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto">
        {(['summary', 'extensions', 'payments'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300'
                : 'border-transparent text-slate-600 dark:text-slate-400'
            }`}
          >
            {t.contracts.detailTabs[tab]}
            {tab === 'extensions' && extensions.length > 0 ? ` (${extensions.length})` : ''}
          </button>
        ))}
      </div>

      {activeTab === 'summary' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
            <div>
              <div className="text-xs text-slate-500">{t.contracts.wizard.startDate}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {formatDateTimeAlgiers(c.startDate, lang, numerals)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.contracts.originalEndDate}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {formatDateTimeAlgiers(c.originalEndDate, lang, numerals)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.contracts.expectedReturnDate}</div>
              <div className="font-mono-tabular font-semibold text-blue-800 dark:text-blue-400 mt-0.5">
                {formatDateTimeAlgiers(c.expectedReturnDate, lang, numerals)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.contracts.actualReturnDate}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {formatDateTimeAlgiers(c.actualReturnDate, lang, numerals)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {t.contracts.departureKm} / {t.contracts.returnKm}
              </div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {formatDigits(c.departureOdometerKm.toLocaleString(), numerals)} km →{' '}
                {c.returnOdometerKm != null
                  ? `${formatDigits(c.returnOdometerKm.toLocaleString(), numerals)} km`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.contracts.mileageMode}</div>
              <div className="font-mono-tabular font-medium mt-0.5">
                {c.mileageMode === 'UNLIMITED'
                  ? t.contracts.unlimited
                  : `${formatDigits(c.includedTotalKm ?? 0, numerals)} km (+${formatCurrencyMinor(
                      c.extraKmRateMinor,
                      c.currency,
                      lang,
                      numerals
                    )}/km)`}
              </div>
            </div>
            {c.blacklistOverrideReason && (
              <div className="sm:col-span-2 lg:col-span-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs">
                <strong>{t.contracts.blacklistOverride}:</strong> {c.blacklistOverrideReason}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">Ligne</th>
                    <th className="px-4 py-3 text-end">Qté</th>
                    <th className="px-4 py-3 text-end">PU</th>
                    <th className="px-4 py-3 text-end">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {pricingItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3">{item.label}</td>
                      <td className="px-4 py-3 text-end font-mono-tabular">{formatDigits(item.quantity, numerals)}</td>
                      <td className="px-4 py-3 text-end font-mono-tabular">
                        {formatCurrencyMinor(item.unitPriceMinor, c.currency, lang, numerals)}
                      </td>
                      <td className="px-4 py-3 text-end font-mono-tabular font-semibold">
                        {formatCurrencyMinor(item.totalMinor, c.currency, lang, numerals)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'extensions' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-start">Date précédente → Nouvelle date</th>
                  <th className="px-4 py-3 text-end">+ {t.common.days}</th>
                  <th className="px-4 py-3 text-end">+ Km</th>
                  <th className="px-4 py-3 text-end">{t.contracts.extendModal.additionalAmount}</th>
                  <th className="px-4 py-3 text-start">{t.users.username}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {extensions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      —
                    </td>
                  </tr>
                ) : (
                  extensions.map((ext) => (
                    <tr key={ext.id}>
                      <td className="px-4 py-3 font-mono-tabular text-xs">
                        {formatDateTimeAlgiers(ext.previousReturnDate, lang, numerals)} →{' '}
                        <strong>{formatDateTimeAlgiers(ext.newReturnDate, lang, numerals)}</strong>
                        {ext.notes && <div className="text-slate-500 font-sans mt-0.5">{ext.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-end font-mono-tabular">{formatDigits(ext.addedDays, numerals)}</td>
                      <td className="px-4 py-3 text-end font-mono-tabular">
                        {formatDigits(ext.additionalKmAllowance, numerals)} km
                      </td>
                      <td className="px-4 py-3 text-end font-mono-tabular font-semibold">
                        {formatCurrencyMinor(ext.additionalAmountMinor, c.currency, lang, numerals)}
                      </td>
                      <td className="px-4 py-3 text-xs">{ext.createdByUsername}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">Code / Reçu</th>
                    <th className="px-4 py-3 text-start">Date</th>
                    <th className="px-4 py-3 text-start">{t.contracts.paymentMethod}</th>
                    <th className="px-4 py-3 text-end">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        —
                      </td>
                    </tr>
                  ) : (
                    payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-3 font-mono-tabular text-xs">
                          {p.transactionCode} · {p.receiptNumber}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-xs">{p.paymentDate}</td>
                        <td className="px-4 py-3 text-xs">
                          {p.method} {p.paymentReference ? `(${p.paymentReference})` : ''}
                        </td>
                        <td className="px-4 py-3 text-end font-mono-tabular font-semibold">
                          {formatCurrencyMinor(p.amountMinor, p.currency, lang, numerals)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-xs text-slate-500">
            {t.vehicles.phaseFutureNotice}
          </div>
        </div>
      )}

      {/* Activate Handover Confirmation */}
      <ConfirmDialog
        open={confirmActivate}
        onClose={() => {
          if (!activating) setConfirmActivate(false);
        }}
        onConfirm={handleActivate}
        tone="info"
        loading={activating}
        title={t.dialogs.activateHandoverTitle}
        description={`${c.contractNumber} — ${c.customerName} (${c.vehicleLabel})`}
        warningText={t.dialogs.activateHandoverDesc}
        confirmLabel={t.contracts.activateHandover}
      />

      {/* Extend Modal */}
      <ModalDialog
        open={showExtendModal}
        onClose={() => {
          if (!extending) setShowExtendModal(false);
        }}
        title={t.contracts.extendModal.title}
        subtitle={t.contracts.extendModal.preserveNotice}
        size="md"
        disableClose={extending}
        onSubmit={handleExtendSubmit}
        footer={
          <>
            <button
              type="button"
              disabled={extending}
              onClick={() => setShowExtendModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={extending || !extDateValid || extAvailability?.available === false}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {extending ? t.common.loading : t.contracts.extendModal.submit}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.contracts.extendModal.newReturnDate} *</label>
          <input
            type="datetime-local"
            dir="ltr"
            required
            data-autofocus
            value={extNewReturnDate}
            onChange={(e) => setExtNewReturnDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>

        {!extDateValid && extNewReturnDate && (
          <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{t.dialogs.invalidDateRange}</span>
          </div>
        )}

        {extDateValid && extAvailability && (
          <div
            className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
              extAvailability.available
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                : 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
            }`}
          >
            {extAvailability.available ? (
              <>
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t.planning.availableMsg}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">{t.planning.conflictMsg}</div>
                  {extAvailability.conflicts.map((conf, idx) => (
                    <div key={idx} className="mt-0.5">
                      · {conf.reference} — {conf.details}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium mb-1">{t.contracts.extendModal.additionalAmount} *</label>
          <input
            type="number"
            min={0}
            required
            dir="ltr"
            value={extAdditionalDzd}
            onChange={(e) => setExtAdditionalDzd(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>

        {c.mileageMode !== 'UNLIMITED' && (
          <div>
            <label className="block text-xs font-medium mb-1">{t.contracts.extendModal.additionalKm}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={extAdditionalKm}
              onChange={(e) => setExtAdditionalKm(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium mb-1">{t.contracts.extendModal.notes}</label>
          <textarea
            rows={2}
            value={extNotes}
            onChange={(e) => setExtNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Complete Modal */}
      <ModalDialog
        open={showCompleteModal}
        onClose={() => {
          if (!completing) setShowCompleteModal(false);
        }}
        title={t.contracts.completeModal.title}
        subtitle={`${c.contractNumber} · ${c.vehicleLabel}`}
        size="md"
        disableClose={completing}
        onSubmit={handleCompleteSubmit}
        footer={
          <>
            <button
              type="button"
              disabled={completing}
              onClick={() => setShowCompleteModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={completing}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 text-xs font-medium disabled:opacity-50"
            >
              {completing ? t.common.loading : t.contracts.completeModal.submit}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">
            {t.contracts.completeModal.actualReturnDate} *
          </label>
          <input
            type="datetime-local"
            dir="ltr"
            required
            data-autofocus
            value={compReturnDate}
            onChange={(e) => setCompReturnDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            {t.contracts.completeModal.returnOdometerKm} * ({t.contracts.departureKm}:{' '}
            {formatDigits(c.departureOdometerKm, numerals)})
          </label>
          <input
            type="number"
            min={0}
            required
            dir="ltr"
            value={compOdometerKm}
            onChange={(e) => setCompOdometerKm(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>

        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">{t.dialogs.drivenKmPreview}:</span>
            <span className="font-mono-tabular font-semibold">{formatDigits(drivenKm, numerals)} km</span>
          </div>
          {c.mileageMode !== 'UNLIMITED' && (
            <div className="flex justify-between">
              <span className="text-slate-500">{t.dialogs.estimatedExtraKmCharge}:</span>
              <span className="font-mono-tabular font-semibold">
                {formatDigits(estimatedExtraKm, numerals)} km ·{' '}
                {formatCurrencyMinor(estimatedExtraKmFeeMinor, c.currency, lang, numerals)}
              </span>
            </div>
          )}
        </div>

        {Number(compOdometerKm) < c.departureOdometerKm && (
          <div>
            <label className="block text-xs font-medium mb-1 text-rose-600 dark:text-rose-400">
              {t.contracts.completeModal.odometerReason} *
            </label>
            <input
              required
              value={compOdoReason}
              onChange={(e) => setCompOdoReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-medium mb-1">{t.contracts.completeModal.lateFee}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={compLateFeeDzd}
              onChange={(e) => setCompLateFeeDzd(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.contracts.completeModal.damageCharge}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={compDamageDzd}
              onChange={(e) => setCompDamageDzd(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.contracts.completeModal.otherCharges}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={compOtherDzd}
              onChange={(e) => setCompOtherDzd(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">{t.vehicles.notes}</label>
          <textarea
            rows={2}
            value={compNotes}
            onChange={(e) => setCompNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Cancel Modal */}
      <ModalDialog
        open={showCancelModal}
        onClose={() => {
          if (!cancelling) setShowCancelModal(false);
        }}
        title={t.contracts.cancelContract}
        subtitle={`${c.contractNumber} · ${c.customerName}`}
        size="sm"
        disableClose={cancelling}
        onSubmit={handleCancelSubmit}
        footer={
          <>
            <button
              type="button"
              disabled={cancelling}
              onClick={() => setShowCancelModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={cancelling}
              className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-medium disabled:opacity-50"
            >
              {cancelling ? t.common.loading : t.contracts.cancelContract}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.contracts.cancelReasonPrompt} *</label>
          <textarea
            rows={3}
            required
            minLength={3}
            data-autofocus
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>
    </div>
  );
}
