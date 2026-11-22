import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Pencil,
  Plus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type AvailabilityResultDto,
  type CustomerListItemDto,
  type PlanningCalendarDto,
  type ReservationListItemDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';

type ViewMode = 'day' | 'week' | 'month';

function todayLocalDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(baseIsoDate: string, offset: number): string {
  const d = new Date(`${baseIsoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function PlanningPage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [anchorDate, setAnchorDate] = useState(() => todayLocalDateStr());
  const [calendar, setCalendar] = useState<PlanningCalendarDto | null>(null);
  const [reservations, setReservations] = useState<ReservationListItemDto[]>([]);
  const [customers, setCustomers] = useState<CustomerListItemDto[]>([]);
  const [resStatusFilter, setResStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // Availability checker
  const [checkVehicleId, setCheckVehicleId] = useState('');
  const [checkStart, setCheckStart] = useState(() => `${todayLocalDateStr()}T09:00`);
  const [checkEnd, setCheckEnd] = useState(() => `${addDays(todayLocalDateStr(), 3)}T18:00`);
  const [availResult, setAvailResult] = useState<AvailabilityResultDto | null>(null);

  // New reservation modal
  const [showResModal, setShowResModal] = useState(false);
  const [resSubmitting, setResSubmitting] = useState(false);
  const [resCustomerId, setResCustomerId] = useState('');
  const [resVehicleId, setResVehicleId] = useState('');
  const [resStart, setResStart] = useState(() => `${todayLocalDateStr()}T09:00`);
  const [resEnd, setResEnd] = useState(() => `${addDays(todayLocalDateStr(), 3)}T18:00`);
  const [resStatus, setResStatus] = useState<'PENDING' | 'CONFIRMED'>('CONFIRMED');
  const [resEstimatedDzd, setResEstimatedDzd] = useState('0');
  const [resNotes, setResNotes] = useState('');
  const [resAvailability, setResAvailability] = useState<AvailabilityResultDto | null>(null);

  // Edit reservation modal
  const [editingReservation, setEditingReservation] = useState<ReservationListItemDto | null>(null);
  const [editResStatus, setEditResStatus] = useState<'PENDING' | 'CONFIRMED'>('CONFIRMED');
  const [editResNotes, setEditResNotes] = useState('');
  const [editResSaving, setEditResSaving] = useState(false);

  // Confirm destructive reservation action (Cancel / No-Show)
  const [pendingAction, setPendingAction] = useState<{
    reservation: ReservationListItemDto;
    status: 'CANCELLED' | 'NO_SHOW';
  } | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);

  const canWrite = hasPermission('contracts:write');

  const dayCount = viewMode === 'day' ? 1 : viewMode === 'week' ? 7 : 30;
  const daysList = useMemo(
    () => Array.from({ length: dayCount }, (_, idx) => addDays(anchorDate, idx)),
    [anchorDate, dayCount]
  );

  const rangeStartIso = `${daysList[0]}T00:00:00Z`;
  const rangeEndIso = `${daysList[daysList.length - 1]}T23:59:59Z`;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cal, resList, custList] = await Promise.all([
        erpClient.getPlanningCalendar(rangeStartIso, rangeEndIso),
        erpClient.listReservations(resStatusFilter),
        erpClient.listCustomers({ includeArchived: false }),
      ]);
      setCalendar(cal);
      setReservations(resList);
      setCustomers(custList);
      if (!checkVehicleId && cal.vehicles.length > 0) {
        setCheckVehicleId(String(cal.vehicles[0].id));
        setResVehicleId(String(cal.vehicles[0].id));
      }
      if (!resCustomerId && custList.length > 0) {
        setResCustomerId(String(custList[0].id));
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [rangeStartIso, rangeEndIso, resStatusFilter, checkVehicleId, resCustomerId, showError, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resDateRangeValid = Boolean(resStart && resEnd && Date.parse(resEnd) > Date.parse(resStart));

  // Auto-estimate price and live availability inside Create Reservation modal
  useEffect(() => {
    if (!showResModal || !resVehicleId || !resDateRangeValid) {
      setResAvailability(null);
      return;
    }

    let cancelled = false;
    Promise.all([
      erpClient.checkVehicleAvailability({
        vehicleId: Number(resVehicleId),
        startDate: resStart,
        endDate: resEnd,
      }),
      erpClient.calculateRentalPrice({
        vehicleId: Number(resVehicleId),
        customerId: resCustomerId ? Number(resCustomerId) : null,
        startDate: resStart,
        endDate: resEnd,
        pricingTier: 'AUTO',
      }),
    ])
      .then(([avail, calc]) => {
        if (cancelled) return;
        setResAvailability(avail);
        setResEstimatedDzd(String(calc.netTotalMinor / 100));
      })
      .catch(() => {
        if (!cancelled) setResAvailability(null);
      });

    return () => {
      cancelled = true;
    };
  }, [showResModal, resVehicleId, resCustomerId, resStart, resEnd, resDateRangeValid]);

  const openNewReservationModal = () => {
    const today = todayLocalDateStr();
    setResStart(`${today}T09:00`);
    setResEnd(`${addDays(today, 3)}T18:00`);
    setResStatus('CONFIRMED');
    setResNotes('');
    setResAvailability(null);
    if (!resVehicleId && calendar?.vehicles.length) {
      setResVehicleId(String(calendar.vehicles[0].id));
    }
    if (!resCustomerId && customers.length) {
      setResCustomerId(String(customers[0].id));
    }
    setShowResModal(true);
  };

  const handleCheckAvailability = async (e: FormEvent) => {
    e.preventDefault();
    if (!checkVehicleId) return;
    if (!checkStart || !checkEnd || Date.parse(checkEnd) <= Date.parse(checkStart)) {
      showError(t.dialogs.invalidDateRange);
      return;
    }
    try {
      const res = await erpClient.checkVehicleAvailability({
        vehicleId: Number(checkVehicleId),
        startDate: checkStart,
        endDate: checkEnd,
      });
      setAvailResult(res);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleCreateReservation = async (e: FormEvent) => {
    e.preventDefault();
    if (!resDateRangeValid) {
      showError(t.dialogs.invalidDateRange);
      return;
    }
    setResSubmitting(true);
    try {
      await erpClient.createReservation({
        customerId: Number(resCustomerId),
        vehicleId: Number(resVehicleId),
        startDate: resStart,
        expectedReturnDate: resEnd,
        estimatedTotalMinor: toMinorUnits(Number(resEstimatedDzd || 0)),
        status: resStatus,
        notes: resNotes.trim() || null,
      });
      showSuccess(t.planning.newReservation);
      setShowResModal(false);
      setResNotes('');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setResSubmitting(false);
    }
  };

  const handleConfirmPendingReservation = async (reservationId: number) => {
    try {
      await erpClient.updateReservationStatus({ reservationId, status: 'CONFIRMED' });
      showSuccess(t.planning.reservationStatus.CONFIRMED);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleExecuteConfirmedAction = async () => {
    if (!pendingAction) return;
    setConfirmingAction(true);
    try {
      await erpClient.updateReservationStatus({
        reservationId: pendingAction.reservation.id,
        status: pendingAction.status,
      });
      showSuccess(t.planning.reservationStatus[pendingAction.status]);
      setPendingAction(null);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setConfirmingAction(false);
    }
  };

  const openEditReservation = (r: ReservationListItemDto) => {
    setEditingReservation(r);
    setEditResStatus(r.status === 'PENDING' ? 'PENDING' : 'CONFIRMED');
    setEditResNotes(r.notes ?? '');
  };

  const handleSaveReservationEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingReservation) return;
    setEditResSaving(true);
    try {
      await erpClient.updateReservationStatus({
        reservationId: editingReservation.id,
        status: editResStatus,
        notes: editResNotes.trim() || null,
      });
      showSuccess(t.common.save);
      setEditingReservation(null);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setEditResSaving(false);
    }
  };

  const stepDays = viewMode === 'day' ? 1 : viewMode === 'week' ? 7 : 30;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t.planning.title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.planning.subtitle}</p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openNewReservationModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{t.planning.newReservation}</span>
          </button>
        )}
      </div>

      {/* Availability Checker Strip */}
      <form
        onSubmit={handleCheckAvailability}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1">{t.nav.vehicles}</label>
            <select
              value={checkVehicleId}
              onChange={(e) => setCheckVehicleId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {(calendar?.vehicles ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.brand} {v.model} ({v.matricule})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.startDate}</label>
            <input
              type="datetime-local"
              dir="ltr"
              value={checkStart}
              onChange={(e) => setCheckStart(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.endDate}</label>
            <input
              type="datetime-local"
              dir="ltr"
              value={checkEnd}
              onChange={(e) => setCheckEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium whitespace-nowrap"
          >
            {t.planning.checkAvailability}
          </button>
        </div>

        {availResult && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
              availResult.available
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                : 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
            }`}
          >
            {availResult.available ? (
              <>
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t.planning.availableMsg}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">{t.planning.conflictMsg}</div>
                  <ul className="list-disc ps-4 mt-1 space-y-0.5">
                    {availResult.conflicts.map((c, idx) => (
                      <li key={idx}>
                        {c.reference} — {c.details}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </form>

      {/* Calendar Controls & Matrix */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAnchorDate((d) => addDays(d, -stepDays))}
              className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              title={t.planning.previous}
            >
              <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(todayLocalDateStr())}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.planning.today}
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate((d) => addDays(d, stepDays))}
              className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              title={t.planning.next}
            >
              <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </button>
            <span className="text-xs font-mono-tabular text-slate-600 dark:text-slate-400 ms-2">
              {formatDigits(daysList[0], numerals)} → {formatDigits(daysList[daysList.length - 1], numerals)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="text-blue-700 dark:text-blue-400 font-medium">■ {t.planning.legendContract}</span>
            <span className="text-amber-700 dark:text-amber-400 font-medium">■ {t.planning.legendReservation}</span>
            <span className="text-orange-700 dark:text-orange-400 font-medium">■ {t.planning.legendMaintenance}</span>
            <span className="text-rose-700 dark:text-rose-400 font-medium">■ {t.planning.legendBlock}</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-lg">
            {(['day', 'week', 'month'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                  viewMode === mode
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {mode === 'day' ? t.planning.viewDay : mode === 'week' ? t.planning.viewWeek : t.planning.viewMonth}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
                <th className="px-3 py-2.5 text-start min-w-[200px] sticky start-0 bg-slate-50 dark:bg-slate-950 z-10 border-e border-slate-200 dark:border-slate-800">
                  {t.nav.vehicles}
                </th>
                {daysList.map((day) => (
                  <th
                    key={day}
                    className="px-2 py-2.5 text-center font-mono-tabular min-w-[68px] border-e border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                  >
                    {formatDigits(day.slice(5), numerals)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading || !calendar ? (
                <tr>
                  <td colSpan={daysList.length + 1} className="px-4 py-8 text-center text-slate-500">
                    {t.common.loading}
                  </td>
                </tr>
              ) : calendar.vehicles.length === 0 ? (
                <tr>
                  <td colSpan={daysList.length + 1} className="px-4 py-8 text-center text-slate-500">
                    <CalendarDays className="w-5 h-5 mx-auto mb-1 opacity-50" />
                    {t.vehicles.empty}
                  </td>
                </tr>
              ) : (
                calendar.vehicles.map((v) => {
                  const vehicleEvents = calendar.events.filter((ev) => ev.vehicleId === v.id);
                  return (
                    <tr key={v.id}>
                      <td className="px-3 py-2.5 sticky start-0 bg-white dark:bg-slate-900 z-10 border-e border-slate-200 dark:border-slate-800">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {v.brand} {v.model}
                        </div>
                        <div className="font-mono-tabular text-[11px] text-slate-500">{v.matricule}</div>
                      </td>
                      {daysList.map((day) => {
                        const dayStart = `${day}T00:00`;
                        const dayEnd = `${day}T23:59`;
                        const matching = vehicleEvents.find((ev) => {
                          const evEnd = ev.actualReturnDate ?? ev.endDate;
                          return ev.startDate <= dayEnd && evEnd >= dayStart;
                        });
                        let cellBg = '';
                        let label = '';
                        if (matching) {
                          if (matching.eventType === 'CONTRACT') {
                            cellBg = 'bg-blue-100 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200';
                            label = matching.reference;
                          } else if (matching.eventType === 'RESERVATION') {
                            cellBg = 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200';
                            label = matching.reference;
                          } else if (matching.eventType === 'MAINTENANCE') {
                            cellBg = 'bg-orange-100 dark:bg-orange-950/60 text-orange-900 dark:text-orange-200';
                            label = matching.reference;
                          } else {
                            cellBg = 'bg-rose-100 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200';
                            label = matching.status;
                          }
                        } else if (v.status === 'MAINTENANCE') {
                          cellBg = 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400';
                          label = 'MAINT';
                        }
                        return (
                          <td
                            key={day}
                            title={
                              matching
                                ? `${matching.reference}${matching.customerName ? ` · ${matching.customerName}` : ''}`
                                : ''
                            }
                            className={`px-1 py-2 text-center border-e border-slate-200 dark:border-slate-800 font-mono-tabular text-[10px] ${cellBg}`}
                          >
                            {label ? <span className="truncate block max-w-[64px] mx-auto">{label}</span> : ''}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reservations List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t.planning.reservationsList}</h3>
          <select
            value={resStatusFilter}
            onChange={(e) => setResStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="ALL">{t.planning.filterAll}</option>
            <option value="PENDING">{t.planning.reservationStatus.PENDING}</option>
            <option value="CONFIRMED">{t.planning.reservationStatus.CONFIRMED}</option>
            <option value="CONVERTED">{t.planning.reservationStatus.CONVERTED}</option>
            <option value="CANCELLED">{t.planning.reservationStatus.CANCELLED}</option>
            <option value="NO_SHOW">{t.planning.reservationStatus.NO_SHOW}</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start">N°</th>
                <th className="px-4 py-3 text-start">{t.nav.customers}</th>
                <th className="px-4 py-3 text-start">{t.nav.vehicles}</th>
                <th className="px-4 py-3 text-start">
                  {t.vehicles.blocks.startDate} → {t.vehicles.blocks.endDate}
                </th>
                <th className="px-4 py-3 text-start">{t.planning.estimatedTotal}</th>
                <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                <th className="px-4 py-3 text-end">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {reservations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {t.planning.emptyReservations}
                  </td>
                </tr>
              ) : (
                reservations.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-mono-tabular font-medium text-xs">{r.reservationNumber}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.customerName}</div>
                      <div className="text-xs font-mono-tabular text-slate-500">{r.customerPhone}</div>
                      {r.notes && <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs">{r.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">{r.vehicleLabel}</td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">
                      {formatDateTimeAlgiers(r.startDate, lang, numerals)} →{' '}
                      {formatDateTimeAlgiers(r.expectedReturnDate, lang, numerals)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs font-medium">
                      {formatCurrencyMinor(r.estimatedTotalMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      {t.planning.reservationStatus[r.status]}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {canWrite && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditReservation(r)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                            title={t.dialogs.editAction}
                          >
                            <Pencil className="w-3 h-3" />
                            <span>{t.dialogs.editAction}</span>
                          </button>
                          {r.status === 'PENDING' && (
                            <button
                              type="button"
                              onClick={() => void handleConfirmPendingReservation(r.id)}
                              className="px-2 py-1 rounded border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs"
                            >
                              {t.planning.confirmReservation}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/contracts/new?reservationId=${r.id}&customerId=${r.customerId}&vehicleId=${r.vehicleId}&startDate=${encodeURIComponent(
                                  r.startDate
                                )}&endDate=${encodeURIComponent(r.expectedReturnDate)}`
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
                          >
                            <FilePlus2 className="w-3.5 h-3.5" />
                            <span>{t.planning.convertToContract}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingAction({ reservation: r, status: 'CANCELLED' })}
                            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {t.planning.cancelReservation}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingAction({ reservation: r, status: 'NO_SHOW' })}
                            className="px-2 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          >
                            {t.planning.markNoShow}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Reservation Modal */}
      <ModalDialog
        open={showResModal}
        onClose={() => {
          if (!resSubmitting) setShowResModal(false);
        }}
        title={t.planning.newReservation}
        size="md"
        disableClose={resSubmitting}
        onSubmit={handleCreateReservation}
        footer={
          <>
            <button
              type="button"
              disabled={resSubmitting}
              onClick={() => setShowResModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={resSubmitting || !resDateRangeValid || resAvailability?.available === false}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {resSubmitting ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.nav.customers} *</label>
          <select
            required
            data-autofocus
            value={resCustomerId}
            onChange={(e) => setResCustomerId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            <option value="">—</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName ? `${c.companyName} (${c.fullName})` : c.fullName} ({c.phone})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">{t.nav.vehicles} *</label>
          <select
            required
            value={resVehicleId}
            onChange={(e) => setResVehicleId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            <option value="">—</option>
            {(calendar?.vehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.brand} {v.model} ({v.matricule})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.startDate} *</label>
            <input
              type="datetime-local"
              dir="ltr"
              required
              value={resStart}
              onChange={(e) => setResStart(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.blocks.endDate} *</label>
            <input
              type="datetime-local"
              dir="ltr"
              required
              value={resEnd}
              onChange={(e) => setResEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>

        {!resDateRangeValid && resStart && resEnd && (
          <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{t.dialogs.invalidDateRange}</span>
          </div>
        )}

        {resDateRangeValid && resAvailability && (
          <div
            className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
              resAvailability.available
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                : 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
            }`}
          >
            {resAvailability.available ? (
              <>
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t.planning.availableMsg}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">{t.planning.conflictMsg}</div>
                  {resAvailability.conflicts.map((c, idx) => (
                    <div key={idx} className="mt-0.5">
                      · {c.reference} — {c.details}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.vehicles.statusLabel}</label>
            <select
              value={resStatus}
              onChange={(e) => setResStatus(e.target.value as 'PENDING' | 'CONFIRMED')}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="CONFIRMED">{t.planning.reservationStatus.CONFIRMED}</option>
              <option value="PENDING">{t.planning.reservationStatus.PENDING}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.planning.estimatedTotal}</label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={resEstimatedDzd}
              onChange={(e) => setResEstimatedDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">{t.vehicles.notes}</label>
          <textarea
            rows={2}
            value={resNotes}
            onChange={(e) => setResNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Edit Reservation Status & Notes Modal */}
      <ModalDialog
        open={editingReservation !== null}
        onClose={() => {
          if (!editResSaving) setEditingReservation(null);
        }}
        title={t.dialogs.editReservationTitle}
        subtitle={
          editingReservation
            ? `${editingReservation.reservationNumber} · ${editingReservation.customerName} · ${editingReservation.vehicleLabel}`
            : undefined
        }
        size="md"
        disableClose={editResSaving}
        onSubmit={handleSaveReservationEdit}
        footer={
          <>
            <button
              type="button"
              disabled={editResSaving}
              onClick={() => setEditingReservation(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={editResSaving}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {editResSaving ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.vehicles.statusLabel}</label>
          <select
            data-autofocus
            value={editResStatus}
            onChange={(e) => setEditResStatus(e.target.value as 'PENDING' | 'CONFIRMED')}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            <option value="PENDING">{t.planning.reservationStatus.PENDING}</option>
            <option value="CONFIRMED">{t.planning.reservationStatus.CONFIRMED}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.dialogs.reservationNotes}</label>
          <textarea
            rows={3}
            value={editResNotes}
            onChange={(e) => setEditResNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Confirm Cancel / No-Show Dialog */}
      <ConfirmDialog
        open={pendingAction !== null}
        onClose={() => {
          if (!confirmingAction) setPendingAction(null);
        }}
        onConfirm={handleExecuteConfirmedAction}
        tone={pendingAction?.status === 'NO_SHOW' ? 'danger' : 'warning'}
        loading={confirmingAction}
        title={
          pendingAction?.status === 'NO_SHOW'
            ? t.dialogs.markNoShowTitle
            : t.dialogs.cancelReservationTitle
        }
        description={
          pendingAction
            ? `${pendingAction.reservation.reservationNumber} — ${pendingAction.reservation.customerName} (${pendingAction.reservation.vehicleLabel})`
            : ''
        }
        warningText={
          pendingAction?.status === 'NO_SHOW'
            ? t.dialogs.markNoShowDesc
            : t.dialogs.cancelReservationDesc
        }
        confirmLabel={
          pendingAction?.status === 'NO_SHOW'
            ? t.planning.markNoShow
            : t.planning.cancelReservation
        }
      />
    </div>
  );
}
