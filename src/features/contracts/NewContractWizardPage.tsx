import { AlertTriangle, ArrowLeft, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { CurrencyCode, MileageMode, PaymentMethod, Vehicle } from '../../../shared/types/domain.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type AvailabilityResultDto,
  type CustomerEligibilityDto,
  type CustomerListItemDto,
  type PriceCalculationDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';

function toLocalDateTimeInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function addDaysLocal(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return toLocalDateTimeInput(d);
}

export function NewContractWizardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const reservationIdParam = searchParams.get('reservationId');
  const reservationId = reservationIdParam ? Number(reservationIdParam) : null;
  const initialCustomerParam = searchParams.get('customerId') || '';
  const initialVehicleParam = searchParams.get('vehicleId') || '';

  const [customers, setCustomers] = useState<CustomerListItemDto[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [allowEurDeposit, setAllowEurDeposit] = useState(false);

  const [customerId, setCustomerId] = useState(initialCustomerParam);
  const [vehicleId, setVehicleId] = useState(initialVehicleParam);
  const [startDate, setStartDate] = useState(searchParams.get('startDate')?.slice(0, 16) || addDaysLocal(0));
  const [expectedReturnDate, setExpectedReturnDate] = useState(
    searchParams.get('endDate')?.slice(0, 16) || addDaysLocal(3)
  );
  const [initialStatus, setInitialStatus] = useState<'DRAFT' | 'CONFIRMED' | 'ACTIVE'>('CONFIRMED');
  const [departureOdometerKm, setDepartureOdometerKm] = useState('0');
  const [mileageMode, setMileageMode] = useState<MileageMode>('DAILY_ALLOWANCE');
  const [dailyAllowanceKm, setDailyAllowanceKm] = useState('300');
  const [includedTotalKm, setIncludedTotalKm] = useState('900');
  const [extraKmRateDzd, setExtraKmRateDzd] = useState('15');

  const [pricingTier, setPricingTier] = useState<'AUTO' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'>('AUTO');
  const [customDailyDzd, setCustomDailyDzd] = useState('');
  const [discountType, setDiscountType] = useState<'NONE' | 'FIXED' | 'PERCENT'>('NONE');
  const [discountValue, setDiscountValue] = useState('0');
  const [discountReason, setDiscountReason] = useState('');

  const [depositDzd, setDepositDzd] = useState('50000');
  const [depositCurrency, setDepositCurrency] = useState<CurrencyCode>('DZD');
  const [initialPaymentDzd, setInitialPaymentDzd] = useState('0');
  const [initialPaymentMethod, setInitialPaymentMethod] = useState<PaymentMethod>('CASH');
  const [initialPaymentRef, setInitialPaymentRef] = useState('');
  const [blacklistOverrideReason, setBlacklistOverrideReason] = useState('');
  const [notes, setNotes] = useState('');

  const [eligibility, setEligibility] = useState<CustomerEligibilityDto | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResultDto | null>(null);
  const [checkingAvail, setCheckingAvail] = useState(false);
  const [pricing, setPricing] = useState<PriceCalculationDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);

  const canOverrideBlacklist = hasPermission('customers:override_blacklist');
  const canApproveDiscount = hasPermission('finance:approve_adjustment');

  // Load customers, vehicles, and agency defaults ONCE on mount so user edits are never overwritten
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      erpClient.listCustomers({ includeArchived: false }),
      erpClient.listVehicles({ includeArchived: false }),
      erpClient.getAllSettings(),
    ])
      .then(([cList, vList, settings]) => {
        if (cancelled) return;
        setCustomers(cList);
        setVehicles(vList);
        setAllowEurDeposit(settings['business.allow_eur_deposits'] === 'true');
        if (settings['business.default_daily_mileage_km']) {
          setDailyAllowanceKm(settings['business.default_daily_mileage_km']);
        }
        if (settings['business.default_extra_km_rate_minor']) {
          setExtraKmRateDzd(String(fromMinorUnits(Number(settings['business.default_extra_km_rate_minor']))));
        }
        if (settings['business.default_deposit_minor']) {
          setDepositDzd(String(fromMinorUnits(Number(settings['business.default_deposit_minor']))));
        }
        setCustomerId((prev) => prev || (cList.length > 0 ? String(cList[0].id) : ''));
        setVehicleId((prev) => {
          const targetId = prev || (vList.length > 0 ? String(vList[0].id) : '');
          const matched = vList.find((v) => v.id === Number(targetId));
          if (matched) setDepartureOdometerKm(String(matched.currentOdometerKm));
          return targetId;
        });
      })
      .catch((err) => {
        if (!cancelled) showError(err instanceof Error ? err.message : t.common.error);
      });
    return () => {
      cancelled = true;
    };
  }, [showError, t.common.error]);

  // Update departure odometer whenever the selected vehicle changes
  useEffect(() => {
    const v = vehicles.find((item) => item.id === Number(vehicleId));
    if (v) {
      setDepartureOdometerKm(String(v.currentOdometerKm));
    }
  }, [vehicleId, vehicles]);

  // Live eligibility check
  useEffect(() => {
    if (!customerId || !expectedReturnDate) {
      setEligibility(null);
      return;
    }
    let cancelled = false;
    erpClient
      .checkCustomerEligibility(Number(customerId), expectedReturnDate)
      .then((res) => {
        if (!cancelled) setEligibility(res);
      })
      .catch(() => {
        if (!cancelled) setEligibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, expectedReturnDate]);

  const isDateRangeValid = Boolean(
    startDate &&
      expectedReturnDate &&
      !Number.isNaN(Date.parse(startDate)) &&
      !Number.isNaN(Date.parse(expectedReturnDate)) &&
      Date.parse(expectedReturnDate) > Date.parse(startDate)
  );

  // Live availability check
  useEffect(() => {
    if (!vehicleId || !isDateRangeValid) {
      setAvailability(null);
      setCheckingAvail(false);
      return;
    }
    let cancelled = false;
    setCheckingAvail(true);
    erpClient
      .checkVehicleAvailability({
        vehicleId: Number(vehicleId),
        startDate,
        endDate: expectedReturnDate,
        excludeReservationId: reservationId,
      })
      .then((res) => {
        if (!cancelled) setAvailability(res);
      })
      .catch(() => {
        if (!cancelled) setAvailability(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingAvail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, startDate, expectedReturnDate, reservationId, isDateRangeValid]);

  // Live pricing engine calculation
  const refreshPrice = useCallback(() => {
    if (!vehicleId || !isDateRangeValid) {
      setPricing(null);
      return;
    }
    const rawDiscountVal =
      discountType === 'FIXED' ? toMinorUnits(Number(discountValue || 0)) : Number(discountValue || 0);

    erpClient
      .calculateRentalPrice({
        vehicleId: Number(vehicleId),
        customerId: customerId ? Number(customerId) : null,
        startDate,
        endDate: expectedReturnDate,
        pricingTier,
        customDailyRateMinor:
          pricingTier === 'CUSTOM' && customDailyDzd ? toMinorUnits(Number(customDailyDzd)) : null,
        discountType,
        discountValue: rawDiscountVal,
      })
      .then(setPricing)
      .catch(() => setPricing(null));
  }, [
    vehicleId,
    customerId,
    startDate,
    expectedReturnDate,
    isDateRangeValid,
    pricingTier,
    customDailyDzd,
    discountType,
    discountValue,
  ]);

  useEffect(() => {
    refreshPrice();
  }, [refreshPrice]);

  const executeCreateContract = async () => {
    if (!customerId || !vehicleId || !pricing) return;
    setSubmitting(true);
    try {
      const created = await erpClient.createContract({
        reservationId,
        customerId: Number(customerId),
        vehicleId: Number(vehicleId),
        startDate,
        expectedReturnDate,
        departureOdometerKm: Number(departureOdometerKm),
        mileageMode,
        dailyMileageAllowanceKm: mileageMode === 'DAILY_ALLOWANCE' ? Number(dailyAllowanceKm) : null,
        includedTotalKm: mileageMode === 'CUSTOM_TOTAL' ? Number(includedTotalKm) : null,
        extraKmRateMinor: toMinorUnits(Number(extraKmRateDzd || 0)),
        currency: 'DZD',
        baseRentalTotalMinor: pricing.grossTotalMinor,
        discountMinor: pricing.discountMinor,
        depositAmountMinor: toMinorUnits(Number(depositDzd || 0)),
        depositCurrency,
        initialPaymentMinor: toMinorUnits(Number(initialPaymentDzd || 0)),
        initialPaymentMethod,
        initialPaymentReference: initialPaymentRef.trim() || null,
        blacklistOverrideReason: eligibility?.requiresBlacklistOverride
          ? blacklistOverrideReason.trim()
          : null,
        notes: notes.trim() || null,
        initialStatus,
        pricingTier,
        discountType,
        discountValue:
          discountType === 'FIXED' ? toMinorUnits(Number(discountValue || 0)) : Number(discountValue || 0),
        pricingBreakdownLabel: pricing.lineItems[0]?.label,
        discountAuthorizationReason: discountReason.trim() || null,
      });
      setShowConfirmSubmit(false);
      showSuccess(created.contract.contractNumber);
      navigate(`/contracts/${created.contract.id}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerId || !vehicleId || !pricing || !isDateRangeValid) return;

    const requiresConfirm =
      initialStatus === 'ACTIVE' || Boolean(eligibility?.requiresBlacklistOverride);
    if (requiresConfirm) {
      setShowConfirmSubmit(true);
      return;
    }

    await executeCreateContract();
  };

  const selectedCustomer = customers.find((c) => c.id === Number(customerId));
  const selectedVehicle = vehicles.find((v) => v.id === Number(vehicleId));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/contracts"
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
        </Link>
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t.contracts.wizard.title}
          </h2>
          {reservationId && (
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
              {t.planning.convertToContract} (#{reservationId})
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Step 1: Customer & Eligibility */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold">{t.contracts.wizard.step1}</h3>
            <div>
              <label className="block text-xs font-medium mb-1">{t.contracts.wizard.selectCustomer} *</label>
              <select
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              >
                <option value="">—</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName ? `${c.companyName} (${c.fullName})` : c.fullName} — {c.phone} [
                    {t.customers.riskLevels[c.riskStatus]}]
                  </option>
                ))}
              </select>
            </div>

            {eligibility && (
              <div
                className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                  eligibility.requiresBlacklistOverride || !eligibility.eligible
                    ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
                    : eligibility.warnings.length > 0
                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                      : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                }`}
              >
                {eligibility.warnings.length === 0 && eligibility.eligible ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{t.contracts.wizard.eligibleOk}</span>
                  </div>
                ) : (
                  eligibility.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))
                )}

                {eligibility.requiresBlacklistOverride && (
                  <div className="pt-2 border-t border-rose-200 dark:border-rose-800 space-y-2">
                    {!canOverrideBlacklist ? (
                      <div className="font-semibold flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4" />
                        <span>{t.contracts.wizard.adminBlacklistRequired}</span>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-semibold mb-1">
                          {t.contracts.blacklistOverride} *
                        </label>
                        <input
                          required
                          value={blacklistOverrideReason}
                          onChange={(e) => setBlacklistOverrideReason(e.target.value)}
                          placeholder={t.contracts.blacklistOverridePlaceholder}
                          className="w-full px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Vehicle & Dates / Availability */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold">{t.contracts.wizard.step2}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">{t.contracts.wizard.selectVehicle} *</label>
                <select
                  required
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="">—</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.brand} {v.model} ({v.matricule}) —{' '}
                      {formatCurrencyMinor(v.defaultDailyRateMinor, 'DZD', lang, numerals)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.wizard.startDate} *</label>
                <input
                  type="datetime-local"
                  dir="ltr"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.wizard.endDate} *</label>
                <input
                  type="datetime-local"
                  dir="ltr"
                  required
                  value={expectedReturnDate}
                  onChange={(e) => setExpectedReturnDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
            </div>

            {!isDateRangeValid && startDate && expectedReturnDate && (
              <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-300">
                {t.dialogs.invalidDateRange}
              </div>
            )}

            {checkingAvail && isDateRangeValid && (
              <div className="text-xs text-slate-500">{t.dialogs.checkingAvailability}</div>
            )}

            {isDateRangeValid && availability && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  availability.available
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                    : 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
                }`}
              >
                {availability.available ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{t.planning.availableMsg}</span>
                  </div>
                ) : (
                  <div>
                    <div className="font-semibold">{t.planning.conflictMsg}</div>
                    {availability.conflicts.map((c, idx) => (
                      <div key={idx} className="mt-0.5">
                        · {c.reference}: {c.details}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Mileage & Pricing Tier */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold">{t.contracts.wizard.step3}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.departureKm} *</label>
                <input
                  type="number"
                  min={0}
                  required
                  dir="ltr"
                  value={departureOdometerKm}
                  onChange={(e) => setDepartureOdometerKm(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.mileageMode}</label>
                <select
                  value={mileageMode}
                  onChange={(e) => setMileageMode(e.target.value as MileageMode)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="DAILY_ALLOWANCE">{t.contracts.dailyAllowance}</option>
                  <option value="UNLIMITED">{t.contracts.unlimited}</option>
                  <option value="CUSTOM_TOTAL">{t.contracts.customTotal}</option>
                </select>
              </div>
              {mileageMode === 'DAILY_ALLOWANCE' && (
                <div>
                  <label className="block text-xs font-medium mb-1">{t.contracts.dailyAllowanceKm}</label>
                  <input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={dailyAllowanceKm}
                    onChange={(e) => setDailyAllowanceKm(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
              )}
              {mileageMode === 'CUSTOM_TOTAL' && (
                <div>
                  <label className="block text-xs font-medium mb-1">{t.contracts.includedTotalKm}</label>
                  <input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={includedTotalKm}
                    onChange={(e) => setIncludedTotalKm(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
              )}
              {mileageMode !== 'UNLIMITED' && (
                <div>
                  <label className="block text-xs font-medium mb-1">{t.contracts.extraKmRate}</label>
                  <input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={extraKmRateDzd}
                    onChange={(e) => setExtraKmRateDzd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">{t.contracts.wizard.pricingTier}</label>
                <select
                  value={pricingTier}
                  onChange={(e) => setPricingTier(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="AUTO">{t.contracts.wizard.tierAuto}</option>
                  <option value="DAILY">{t.contracts.wizard.tierDaily}</option>
                  <option value="WEEKLY">{t.contracts.wizard.tierWeekly}</option>
                  <option value="MONTHLY">{t.contracts.wizard.tierMonthly}</option>
                  <option value="CUSTOM">{t.contracts.wizard.tierCustom}</option>
                </select>
              </div>
              {pricingTier === 'CUSTOM' && (
                <div>
                  <label className="block text-xs font-medium mb-1">{t.contracts.wizard.customDailyRate}</label>
                  <input
                    type="number"
                    min={0}
                    required
                    dir="ltr"
                    value={customDailyDzd}
                    onChange={(e) => setCustomDailyDzd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.wizard.discountType}</label>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="NONE">{t.contracts.wizard.discountNone}</option>
                  <option value="PERCENT">{t.contracts.wizard.discountPercent}</option>
                  <option value="FIXED">{t.contracts.wizard.discountFixed}</option>
                </select>
              </div>
              {discountType !== 'NONE' && (
                <>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t.contracts.wizard.discountValue}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      dir="ltr"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t.contracts.discount}</label>
                    <input
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      placeholder={t.contracts.discountReasonPlaceholder}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Step 4: Deposit, Payment & Initial Status */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold">{t.contracts.wizard.step4}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.depositAmount}</label>
                <input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={depositDzd}
                  onChange={(e) => setDepositDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.depositCurrency}</label>
                <select
                  value={depositCurrency}
                  onChange={(e) => setDepositCurrency(e.target.value as CurrencyCode)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="DZD">DZD</option>
                  {allowEurDeposit && <option value="EUR">EUR</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.wizard.initialStatusLabel}</label>
                <select
                  value={initialStatus}
                  onChange={(e) => setInitialStatus(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="CONFIRMED">{t.contracts.wizard.statusConfirmed}</option>
                  <option value="ACTIVE">{t.contracts.wizard.statusActive}</option>
                  <option value="DRAFT">{t.contracts.wizard.statusDraft}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.initialPayment} (DZD)</label>
                <input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={initialPaymentDzd}
                  onChange={(e) => setInitialPaymentDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.paymentMethod}</label>
                <select
                  value={initialPaymentMethod}
                  onChange={(e) => setInitialPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="CASH">Espèces (CASH)</option>
                  <option value="CCP">CCP</option>
                  <option value="BARIDIMOB">BaridiMob</option>
                  <option value="BANK_TRANSFER">Virement bancaire</option>
                  <option value="OTHER">Autre</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.contracts.paymentReference}</label>
                <input
                  dir="ltr"
                  value={initialPaymentRef}
                  onChange={(e) => setInitialPaymentRef(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t.vehicles.notes}</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Sticky Live Pricing Summary */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 h-fit lg:sticky lg:top-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t.contracts.detailTabs.summary}</h3>
            <button
              type="button"
              onClick={refreshPrice}
              className="text-xs text-blue-700 dark:text-blue-400 hover:underline"
            >
              {t.contracts.wizard.recalculate}
            </button>
          </div>

          {!isDateRangeValid ? (
            <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-300">
              {t.dialogs.invalidDateRange}
            </div>
          ) : pricing ? (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-slate-500">
                {formatDigits(pricing.days, numerals)} {t.common.days} · {pricing.appliedRuleSource}
              </div>

              <div className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
                {pricing.lineItems.map((item, idx) => (
                  <div key={idx} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <span>{item.label}</span>
                    <span className="font-mono-tabular font-medium">
                      {formatCurrencyMinor(item.totalMinor, 'DZD', lang, numerals)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-base font-semibold pt-1">
                <span>{t.contracts.totalContract}</span>
                <span className="font-mono-tabular">
                  {formatCurrencyMinor(pricing.netTotalMinor, 'DZD', lang, numerals)}
                </span>
              </div>

              {pricing.requiresAdminDiscountOverride && !canApproveDiscount && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                  {t.contracts.wizard.adminDiscountRequired}
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 flex justify-between">
                <span>{t.contracts.depositLabel}</span>
                <span className="font-mono-tabular">
                  {formatCurrencyMinor(toMinorUnits(Number(depositDzd || 0)), depositCurrency, lang, numerals)}
                </span>
              </div>

              <button
                type="submit"
                disabled={
                  submitting ||
                  !availability?.available ||
                  (eligibility?.requiresBlacklistOverride && !canOverrideBlacklist) ||
                  (pricing.requiresAdminDiscountOverride && !canApproveDiscount)
                }
                className="w-full py-2.5 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
              >
                {submitting ? t.common.loading : t.contracts.wizard.submitContract}
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-500 py-4">{t.common.loading}</div>
          )}
        </div>
      </form>

      {/* Handover / Blacklist Override Confirmation */}
      <ConfirmDialog
        open={showConfirmSubmit}
        onClose={() => {
          if (!submitting) setShowConfirmSubmit(false);
        }}
        onConfirm={executeCreateContract}
        tone={eligibility?.requiresBlacklistOverride ? 'danger' : 'warning'}
        loading={submitting}
        title={t.contracts.wizard.submitContract}
        description={
          <span>
            {selectedCustomer ? selectedCustomer.fullName : ''} —{' '}
            {selectedVehicle ? `${selectedVehicle.brand} ${selectedVehicle.model} (${selectedVehicle.matricule})` : ''}
            {pricing
              ? ` · ${formatCurrencyMinor(pricing.netTotalMinor, 'DZD', lang, numerals)}`
              : ''}
          </span>
        }
        warningText={
          <div className="space-y-1.5">
            {initialStatus === 'ACTIVE' && <div>{t.dialogs.contractConfirmActiveDesc}</div>}
            {eligibility?.requiresBlacklistOverride && (
              <div className="font-semibold">{t.dialogs.contractBlacklistWarning}</div>
            )}
          </div>
        }
        confirmLabel={t.contracts.wizard.submitContract}
      />
    </div>
  );
}
