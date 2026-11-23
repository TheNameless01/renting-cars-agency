import { Eye, FileText, LockKeyhole, PlusCircle, SlidersHorizontal, Vault } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { DocumentFormat, GeneratedDocument } from '../../../shared/types/domain.ts';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type CashCurrentResponseDto,
  type CashSessionDetailDto,
  type CashSessionSummaryDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';

export function CashRegisterTab() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [current, setCurrent] = useState<CashCurrentResponseDto | null>(null);
  const [history, setHistory] = useState<CashSessionSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);

  // Open session modal
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openDate, setOpenDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openBalanceMajor, setOpenBalanceMajor] = useState('0');
  const [openNotes, setOpenNotes] = useState('');
  const [submittingOpen, setSubmittingOpen] = useState(false);

  // Close & reconcile modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [actualClosingMajor, setActualClosingMajor] = useState('0');
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');
  const [submittingClose, setSubmittingClose] = useState(false);

  // Cash adjustment modal (Admin / approve_adjustment)
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjDeltaMajor, setAdjDeltaMajor] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [submittingAdj, setSubmittingAdj] = useState(false);

  // Inspect historical session modal (strictly read-only)
  const [inspectedSession, setInspectedSession] = useState<CashSessionDetailDto | null>(null);
  const [closingPdfFormat, setClosingPdfFormat] = useState<DocumentFormat>('A4_PDF');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDocument | null>(null);
  const [generatedPdfBase64, setGeneratedPdfBase64] = useState<string | null>(null);

  const canOperateCash = hasPermission('finance:cash_register');
  const canAdjustCash = hasPermission('finance:approve_adjustment');
  const canGenerateDoc = hasPermission('documents:generate');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cur, hist] = await Promise.all([
        erpClient.getCurrentCashSession(),
        erpClient.listCashSessions(60),
      ]);
      setCurrent(cur);
      setHistory(hist);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [showError, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenSessionModal = () => {
    setOpenDate(new Date().toISOString().slice(0, 10));
    setOpenBalanceMajor(String(fromMinorUnits(current?.suggestedOpeningBalanceMinor ?? 0)));
    setOpenNotes('');
    setShowOpenModal(true);
  };

  const handleSubmitOpen = async (e: FormEvent) => {
    e.preventDefault();
    setSubmittingOpen(true);
    try {
      await erpClient.openCashSession({
        sessionDate: openDate,
        openingBalanceMinor: toMinorUnits(Number(openBalanceMajor || 0)),
        openingNotes: openNotes.trim() || null,
      });
      showSuccess(t.finance.cash.activeSessionBadge);
      setShowOpenModal(false);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingOpen(false);
    }
  };

  const handleOpenCloseModal = () => {
    if (!current?.session) return;
    setActualClosingMajor(String(fromMinorUnits(current.session.expectedClosingMinor)));
    setDiscrepancyNotes('');
    setShowCloseModal(true);
  };

  const handleSubmitClose = async (e: FormEvent) => {
    e.preventDefault();
    if (!current?.session) return;
    setSubmittingClose(true);
    try {
      await erpClient.closeCashSession({
        sessionId: current.session.id,
        actualClosingMinor: toMinorUnits(Number(actualClosingMajor || 0)),
        discrepancyNotes: discrepancyNotes.trim() || null,
      });
      showSuccess(t.finance.cash.closedSessionBadge);
      setShowCloseModal(false);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingClose(false);
    }
  };

  const handleSubmitAdjustment = async (e: FormEvent) => {
    e.preventDefault();
    if (!current?.session) return;
    setSubmittingAdj(true);
    try {
      await erpClient.recordCashAdjustment({
        sessionId: current.session.id,
        amountDeltaMinor: toMinorUnits(Number(adjDeltaMajor || 0)),
        reason: adjReason.trim(),
      });
      showSuccess(t.common.save);
      setShowAdjModal(false);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingAdj(false);
    }
  };

  const handleInspect = async (sessionId: number) => {
    try {
      const res = await erpClient.getCashSessionDetail(sessionId);
      setInspectedSession(res);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleGenerateClosingPdf = async (sessionId: number, format: DocumentFormat = closingPdfFormat) => {
    setGeneratingPdf(true);
    try {
      const res = await erpClient.generateDocument({
        documentKind: 'CASH_REGISTER_CLOSING',
        cashSessionId: sessionId,
        format,
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

  if (loading || !current) {
    return <div className="py-12 text-center text-sm text-slate-500">{t.common.loading}</div>;
  }

  const active = current.session;
  const actualMinorInput = toMinorUnits(Number(actualClosingMajor || 0));
  const liveDiscrepancyMinor = active ? actualMinorInput - active.expectedClosingMinor : 0;

  return (
    <div className="space-y-6">
      {/* Active Session or Open Action */}
      {!active ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              <Vault className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t.finance.cash.noOpenSession}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {t.finance.cash.suggestedCarryForward}:{' '}
                <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
                  {formatCurrencyMinor(current.suggestedOpeningBalanceMinor, 'DZD', lang, numerals)}
                </span>
                {current.lastClosedDate ? ` (${formatDigits(current.lastClosedDate, numerals)})` : ''}
              </p>
            </div>
          </div>
          {canOperateCash && (
            <button
              type="button"
              onClick={handleOpenSessionModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium shrink-0"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{t.finance.cash.openSessionBtn}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">
                  {t.finance.cash.activeSessionBadge}
                </span>
                <span className="text-sm font-bold font-mono-tabular">
                  {formatDigits(active.sessionDate, numerals)}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {t.finance.cash.openedBy}: {active.openedByUsername || `#${active.openedByUserId}`} ·{' '}
                {formatDateTimeAlgiers(active.openedAt, lang, numerals)}
                {active.openingNotes ? ` · ${active.openingNotes}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {canGenerateDoc && (
                <button
                  type="button"
                  disabled={generatingPdf}
                  onClick={() => void handleGenerateClosingPdf(active.id, closingPdfFormat)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
                  <span>{t.documents.triggers.cashClosingPdf}</span>
                </button>
              )}
              {canAdjustCash && (
                <button
                  type="button"
                  onClick={() => {
                    setAdjDeltaMajor('');
                    setAdjReason('');
                    setShowAdjModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>{t.finance.cash.recordAdjustmentBtn}</span>
                </button>
              )}
              {canOperateCash && (
                <button
                  type="button"
                  onClick={handleOpenCloseModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 text-xs font-medium"
                >
                  <LockKeyhole className="w-3.5 h-3.5" />
                  <span>{t.finance.cash.closeSessionBtn}</span>
                </button>
              )}
            </div>
          </div>

          {/* 6-Metric Reconciliation Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-slate-500">{t.finance.cash.openingAmount}</div>
              <div className="text-sm font-bold font-mono-tabular mt-1">
                {formatCurrencyMinor(active.openingBalanceMinor, 'DZD', lang, numerals)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-slate-500">{t.finance.cash.cashInflows}</div>
              <div className="text-sm font-bold font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
                +{formatCurrencyMinor(active.cashReceivedMinor, 'DZD', lang, numerals)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-slate-500">{t.finance.cash.cashRefunds}</div>
              <div className="text-sm font-bold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
                −{formatCurrencyMinor(active.cashRefundedMinor, 'DZD', lang, numerals)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-slate-500">{t.finance.cash.cashExpenses}</div>
              <div className="text-sm font-bold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
                −{formatCurrencyMinor(active.cashExpensesMinor, 'DZD', lang, numerals)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-slate-500">{t.finance.cash.adjustments}</div>
              <div className="text-sm font-bold font-mono-tabular text-blue-700 dark:text-blue-400 mt-1">
                {formatCurrencyMinor(active.cashAdjustmentsMinor ?? 0, 'DZD', lang, numerals)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900 rounded-xl p-3.5">
              <div className="text-blue-800 dark:text-blue-300 font-medium">
                {t.finance.cash.expectedBalance}
              </div>
              <div className="text-base font-bold font-mono-tabular text-slate-900 dark:text-slate-100 mt-1">
                {formatCurrencyMinor(active.expectedClosingMinor, 'DZD', lang, numerals)}
              </div>
            </div>
          </div>

          {/* Live Movements Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
              {t.finance.cash.movementsTitle} ({formatDigits(current.movements.length, numerals)})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-start">{t.settings.audit.timestamp}</th>
                    <th className="px-4 py-2.5 text-start">{t.settings.audit.operation}</th>
                    <th className="px-4 py-2.5 text-start">{t.finance.payments.descriptionLabel}</th>
                    <th className="px-4 py-2.5 text-start">{t.users.username}</th>
                    <th className="px-4 py-2.5 text-end">{t.finance.payments.amountLabel}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {current.movements.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        {t.finance.cash.noMovements}
                      </td>
                    </tr>
                  ) : (
                    current.movements.map((mv) => {
                      const isPositive =
                        mv.movementType === 'PAYMENT_INFLOW' ||
                        mv.movementType === 'DEPOSIT_INFLOW' ||
                        (mv.movementType === 'ADJUSTMENT' && mv.amountMinor >= 0);
                      return (
                        <tr key={mv.id}>
                          <td className="px-4 py-2.5 font-mono-tabular whitespace-nowrap">
                            {formatDateTimeAlgiers(mv.createdAt, lang, numerals)}
                          </td>
                          <td className="px-4 py-2.5 font-medium">
                            {t.finance.cashMovementTypes[mv.movementType]}
                            {mv.referenceCode ? (
                              <span className="ms-1.5 font-mono-tabular text-slate-500">
                                ({mv.referenceCode})
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                            {mv.description || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{mv.recordedByUsername || '—'}</td>
                          <td
                            className={`px-4 py-2.5 text-end font-mono-tabular font-semibold ${
                              isPositive
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {isPositive && mv.amountMinor > 0 ? '+' : ''}
                            {formatCurrencyMinor(mv.amountMinor, 'DZD', lang, numerals)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Session History */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
          {t.finance.cash.historyTitle}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-start">{t.finance.cash.sessionDate}</th>
                <th className="px-4 py-2.5 text-start">{t.vehicles.statusLabel}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.cash.openingAmount}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.cash.expectedBalance}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.cash.actualClosingBalance}</th>
                <th className="px-4 py-2.5 text-end">{t.finance.cash.discrepancy}</th>
                <th className="px-4 py-2.5 text-end">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    —
                  </td>
                </tr>
              ) : (
                history.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 font-mono-tabular font-medium">
                      {formatDigits(s.sessionDate, numerals)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          s.status === 'OPEN'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular">
                      {formatCurrencyMinor(s.openingBalanceMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular">
                      {formatCurrencyMinor(s.expectedClosingMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono-tabular">
                      {s.actualClosingMinor != null
                        ? formatCurrencyMinor(s.actualClosingMinor, 'DZD', lang, numerals)
                        : '—'}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-end font-mono-tabular font-semibold ${
                        (s.discrepancyMinor ?? 0) === 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : (s.discrepancyMinor ?? 0) > 0
                            ? 'text-blue-700 dark:text-blue-400'
                            : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {s.status === 'CLOSED' && s.discrepancyMinor != null
                        ? formatCurrencyMinor(s.discrepancyMinor, 'DZD', lang, numerals)
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        {canGenerateDoc && (
                          <button
                            type="button"
                            disabled={generatingPdf}
                            onClick={() => void handleGenerateClosingPdf(s.id, closingPdfFormat)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <FileText className="w-3 h-3 text-blue-700 dark:text-blue-400" />
                            <span>{t.documents.triggers.cashClosingPdf}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleInspect(s.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <Eye className="w-3 h-3" />
                          <span>{t.finance.cash.inspectSession}</span>
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

      {/* Open Session Modal */}
      <ModalDialog
        open={showOpenModal}
        onClose={() => {
          if (!submittingOpen) setShowOpenModal(false);
        }}
        title={t.finance.cash.openSessionTitle}
        size="sm"
        disableClose={submittingOpen}
        onSubmit={handleSubmitOpen}
        footer={
          <>
            <button
              type="button"
              disabled={submittingOpen}
              onClick={() => setShowOpenModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submittingOpen}
              className="px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {submittingOpen ? t.common.loading : t.finance.cash.openSessionBtn}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.finance.cash.sessionDate} *</label>
          <input
            type="date"
            required
            dir="ltr"
            value={openDate}
            onChange={(e) => setOpenDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.finance.cash.openingBalance} *</label>
          <input
            type="number"
            min={0}
            step="0.01"
            required
            dir="ltr"
            data-autofocus
            value={openBalanceMajor}
            onChange={(e) => setOpenBalanceMajor(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.finance.cash.openingNotes}</label>
          <textarea
            rows={2}
            value={openNotes}
            onChange={(e) => setOpenNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Close & Reconcile Modal */}
      <ModalDialog
        open={showCloseModal && Boolean(active)}
        onClose={() => {
          if (!submittingClose) setShowCloseModal(false);
        }}
        title={t.finance.cash.closeSessionBtn}
        subtitle={active ? formatDigits(active.sessionDate, numerals) : undefined}
        size="md"
        disableClose={submittingClose}
        onSubmit={handleSubmitClose}
        footer={
          <>
            <button
              type="button"
              disabled={submittingClose}
              onClick={() => setShowCloseModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submittingClose}
              className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium disabled:opacity-50"
            >
              {submittingClose ? t.common.loading : t.finance.cash.closeSessionBtn}
            </button>
          </>
        }
      >
        {active && (
          <>
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-between items-center text-xs">
              <span className="text-slate-500">{t.finance.cash.expectedBalance}:</span>
              <span className="text-base font-bold font-mono-tabular">
                {formatCurrencyMinor(active.expectedClosingMinor, 'DZD', lang, numerals)}
              </span>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {t.finance.cash.actualClosingBalance} *
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                dir="ltr"
                data-autofocus
                value={actualClosingMajor}
                onChange={(e) => setActualClosingMajor(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
              />
            </div>
            <div
              className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                liveDiscrepancyMinor === 0
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                  : liveDiscrepancyMinor > 0
                    ? 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300'
                    : 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
              }`}
            >
              <span className="font-medium">
                {t.finance.cash.discrepancy} (
                {liveDiscrepancyMinor === 0
                  ? t.finance.cash.discrepancyBalanced
                  : liveDiscrepancyMinor > 0
                    ? t.finance.cash.discrepancySurplus
                    : t.finance.cash.discrepancyShortage}
                )
              </span>
              <span className="font-mono-tabular font-bold">
                {formatCurrencyMinor(liveDiscrepancyMinor, 'DZD', lang, numerals)}
              </span>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {t.finance.cash.discrepancyNotes} {liveDiscrepancyMinor !== 0 ? '*' : ''}
              </label>
              <textarea
                rows={2}
                required={liveDiscrepancyMinor !== 0}
                value={discrepancyNotes}
                onChange={(e) => setDiscrepancyNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
          </>
        )}
      </ModalDialog>

      {/* Cash Adjustment Modal */}
      <ModalDialog
        open={showAdjModal && Boolean(active)}
        onClose={() => {
          if (!submittingAdj) setShowAdjModal(false);
        }}
        title={t.finance.cash.recordAdjustmentBtn}
        size="sm"
        disableClose={submittingAdj}
        onSubmit={handleSubmitAdjustment}
        footer={
          <>
            <button
              type="button"
              disabled={submittingAdj}
              onClick={() => setShowAdjModal(false)}
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
        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.cash.adjustmentDelta} *
          </label>
          <input
            type="number"
            step="0.01"
            required
            dir="ltr"
            data-autofocus
            value={adjDeltaMajor}
            onChange={(e) => setAdjDeltaMajor(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.cash.adjustmentReason} *
          </label>
          <textarea
            rows={2}
            required
            minLength={3}
            value={adjReason}
            onChange={(e) => setAdjReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Historical Session Read-Only Inspection */}
      <ModalDialog
        open={Boolean(inspectedSession)}
        onClose={() => setInspectedSession(null)}
        title={
          inspectedSession
            ? `${formatDigits(inspectedSession.session.sessionDate, numerals)} · ${
                inspectedSession.session.status === 'CLOSED'
                  ? t.finance.cash.closedSessionBadge
                  : t.finance.cash.activeSessionBadge
              }`
            : ''
        }
        subtitle={
          inspectedSession?.session.status === 'CLOSED'
            ? t.finance.cash.closedImmutableNotice
            : undefined
        }
        size="xl"
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            {inspectedSession && canGenerateDoc ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={closingPdfFormat}
                  onChange={(e) => setClosingPdfFormat(e.target.value as DocumentFormat)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  <option value="A4_PDF">{t.documents.formats.A4_PDF}</option>
                  <option value="THERMAL_80MM">{t.documents.formats.THERMAL_80MM}</option>
                  <option value="THERMAL_58MM">{t.documents.formats.THERMAL_58MM}</option>
                </select>
                <button
                  type="button"
                  disabled={generatingPdf}
                  onClick={() =>
                    void handleGenerateClosingPdf(inspectedSession.session.id, closingPdfFormat)
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{generatingPdf ? t.common.loading : t.documents.triggers.cashClosingPdf}</span>
                </button>
              </div>
            ) : (
              <div />
            )}
            <button
              type="button"
              onClick={() => setInspectedSession(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium whitespace-nowrap shrink-0"
            >
              {t.common.close}
            </button>
          </div>
        }
      >
        {inspectedSession && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">{t.finance.cash.openingAmount}</div>
                <div className="font-mono-tabular font-bold mt-1">
                  {formatCurrencyMinor(inspectedSession.session.openingBalanceMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">{t.finance.cash.expectedBalance}</div>
                <div className="font-mono-tabular font-bold mt-1">
                  {formatCurrencyMinor(inspectedSession.session.expectedClosingMinor, 'DZD', lang, numerals)}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">{t.finance.cash.actualClosingBalance}</div>
                <div className="font-mono-tabular font-bold mt-1">
                  {inspectedSession.session.actualClosingMinor != null
                    ? formatCurrencyMinor(inspectedSession.session.actualClosingMinor, 'DZD', lang, numerals)
                    : '—'}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">{t.finance.cash.discrepancy}</div>
                <div className="font-mono-tabular font-bold mt-1">
                  {inspectedSession.session.discrepancyMinor != null
                    ? formatCurrencyMinor(inspectedSession.session.discrepancyMinor, 'DZD', lang, numerals)
                    : '—'}
                </div>
              </div>
            </div>
            {inspectedSession.session.discrepancyNotes && (
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <strong>{t.finance.cash.discrepancyNotes}:</strong>{' '}
                {inspectedSession.session.discrepancyNotes}
              </div>
            )}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-start">{t.settings.audit.timestamp}</th>
                    <th className="px-3 py-2 text-start">{t.settings.audit.operation}</th>
                    <th className="px-3 py-2 text-start">{t.finance.payments.descriptionLabel}</th>
                    <th className="px-3 py-2 text-end">{t.finance.payments.amountLabel}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {inspectedSession.movements.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                        {t.finance.cash.noMovements}
                      </td>
                    </tr>
                  ) : (
                    inspectedSession.movements.map((mv) => (
                      <tr key={mv.id}>
                        <td className="px-3 py-2 font-mono-tabular">
                          {formatDateTimeAlgiers(mv.createdAt, lang, numerals)}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {t.finance.cashMovementTypes[mv.movementType]}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          {mv.description || '—'}
                        </td>
                        <td className="px-3 py-2 text-end font-mono-tabular font-semibold">
                          {formatCurrencyMinor(mv.amountMinor, 'DZD', lang, numerals)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
