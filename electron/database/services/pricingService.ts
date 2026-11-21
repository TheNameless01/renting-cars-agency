import type Database from 'better-sqlite3';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';

export interface PriceCalculationInput {
  vehicleId: number;
  customerId?: number | null;
  startDate: string;
  endDate: string;
  pricingTier?: 'AUTO' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  customDailyRateMinor?: number | null;
  customTotalMinor?: number | null;
  discountType?: 'NONE' | 'FIXED' | 'PERCENT';
  discountValue?: number;
}

export interface PriceLineItem {
  itemType: 'DAILY_RATE' | 'WEEKLY_RATE' | 'MONTHLY_RATE' | 'SEASONAL_RATE' | 'CUSTOM_RATE' | 'FIXED_DISCOUNT' | 'PERCENT_DISCOUNT';
  label: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface PriceCalculationResult {
  days: number;
  appliedTier: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SEASONAL' | 'CUSTOMER_CUSTOM' | 'CUSTOM';
  appliedRuleSource: string;
  unitDailyRateMinor: number;
  grossTotalMinor: number;
  discountMinor: number;
  netTotalMinor: number;
  discountPercentEffective: number;
  maxAgentDiscountPercent: number;
  requiresAdminDiscountOverride: boolean;
  lineItems: PriceLineItem[];
}

export function calculateRentalPrice(
  db: Database.Database,
  input: PriceCalculationInput
): PriceCalculationResult {
  const startMs = Date.parse(input.startDate);
  const endMs = Date.parse(input.endDate);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new AuthError('VALIDATION_ERROR', 'Plage de dates invalide pour le calcul tarifaire');
  }

  const vehicle = db.prepare<[number], any>('SELECT * FROM vehicles WHERE id = ?').get(input.vehicleId);
  if (!vehicle) throw new AuthError('NOT_FOUND', 'Véhicule introuvable');

  const days = Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)));
  const startDay = input.startDate.slice(0, 10);
  const endDay = input.endDate.slice(0, 10);

  const maxDiscountSetting = db
    .prepare<[], { setting_value: string }>(
      "SELECT setting_value FROM application_settings WHERE setting_key = 'business.max_agent_discount_percent'"
    )
    .get();
  const maxAgentDiscountPercent = Number(maxDiscountSetting?.setting_value ?? 10);

  // Determine applicable rate
  let dailyRate = Number(vehicle.default_daily_rate_minor);
  let weeklyRate: number | null = vehicle.default_weekly_rate_minor != null ? Number(vehicle.default_weekly_rate_minor) : null;
  let monthlyRate: number | null = vehicle.default_monthly_rate_minor != null ? Number(vehicle.default_monthly_rate_minor) : null;
  let customerDefaultDiscountPct = 0;

  let appliedTier: PriceCalculationResult['appliedTier'] = 'DAILY';
  let appliedRuleSource = `${vehicle.brand} ${vehicle.model} (Tarif véhicule)`;
  let grossTotalMinor = 0;
  let lineItemType: PriceLineItem['itemType'] = 'DAILY_RATE';

  const tier = input.pricingTier ?? 'AUTO';

  if (tier === 'CUSTOM' && input.customTotalMinor != null) {
    appliedTier = 'CUSTOM';
    appliedRuleSource = 'Tarif contractuel personnalisé';
    grossTotalMinor = Math.round(input.customTotalMinor);
    dailyRate = Math.round(grossTotalMinor / days);
    lineItemType = 'CUSTOM_RATE';
  } else if (tier === 'CUSTOM' && input.customDailyRateMinor != null) {
    appliedTier = 'CUSTOM';
    appliedRuleSource = 'Tarif journalier personnalisé';
    dailyRate = Math.round(input.customDailyRateMinor);
    grossTotalMinor = dailyRate * days;
    lineItemType = 'CUSTOM_RATE';
  } else {
    // Check seasonal rate matching vehicle or category overlapping rental window
    const seasonal = db
      .prepare<[string, string, number, string], any>(
        `SELECT * FROM seasonal_rates
         WHERE is_active = 1
           AND start_date <= ?
           AND end_date >= ?
           AND (vehicle_id = ? OR vehicle_category = ? OR (vehicle_id IS NULL AND vehicle_category IS NULL))
         ORDER BY
           CASE WHEN vehicle_id IS NOT NULL THEN 0 WHEN vehicle_category IS NOT NULL THEN 1 ELSE 2 END,
           id DESC
         LIMIT 1`
      )
      .get(endDay, startDay, vehicle.id, vehicle.category);

    if (seasonal) {
      dailyRate = Number(seasonal.daily_rate_minor);
      weeklyRate = seasonal.weekly_rate_minor != null ? Number(seasonal.weekly_rate_minor) : weeklyRate;
      monthlyRate = seasonal.monthly_rate_minor != null ? Number(seasonal.monthly_rate_minor) : monthlyRate;
      appliedTier = 'SEASONAL';
      appliedRuleSource = `Saison: ${seasonal.name}`;
      lineItemType = 'SEASONAL_RATE';
    }

    // Check customer-specific rate (takes precedence over vehicle/seasonal unless explicit CUSTOM)
    if (input.customerId) {
      const custRate = db
        .prepare<[number, number, string], any>(
          `SELECT * FROM customer_custom_rates
           WHERE customer_id = ?
             AND is_active = 1
             AND (vehicle_id = ? OR vehicle_category = ? OR (vehicle_id IS NULL AND vehicle_category IS NULL))
           ORDER BY
             CASE WHEN vehicle_id IS NOT NULL THEN 0 WHEN vehicle_category IS NOT NULL THEN 1 ELSE 2 END,
             id DESC
           LIMIT 1`
        )
        .get(input.customerId, vehicle.id, vehicle.category);

      if (custRate) {
        if (custRate.daily_rate_minor != null) dailyRate = Number(custRate.daily_rate_minor);
        if (custRate.weekly_rate_minor != null) weeklyRate = Number(custRate.weekly_rate_minor);
        if (custRate.monthly_rate_minor != null) monthlyRate = Number(custRate.monthly_rate_minor);
        customerDefaultDiscountPct = Number(custRate.default_discount_percent ?? 0);
        appliedTier = 'CUSTOMER_CUSTOM';
        appliedRuleSource = 'Tarif spécifique client';
      }
    }

    // Tier selection (MONTHLY >= 30d, WEEKLY >= 7d, or explicit tier)
    if (tier === 'MONTHLY' || (tier === 'AUTO' && days >= 30 && monthlyRate != null)) {
      const effMonthly = monthlyRate ?? dailyRate * 30;
      const months = Math.floor(days / 30);
      const remDays = days % 30;
      const effRemDaily = Math.round(effMonthly / 30);
      grossTotalMinor = months > 0 ? months * effMonthly + remDays * effRemDaily : days * effRemDaily;
      if (appliedTier === 'DAILY') appliedTier = 'MONTHLY';
      lineItemType = 'MONTHLY_RATE';
      dailyRate = Math.round(grossTotalMinor / days);
    } else if (tier === 'WEEKLY' || (tier === 'AUTO' && days >= 7 && weeklyRate != null)) {
      const effWeekly = weeklyRate ?? dailyRate * 7;
      const weeks = Math.floor(days / 7);
      const remDays = days % 7;
      const effRemDaily = Math.round(effWeekly / 7);
      grossTotalMinor = weeks > 0 ? weeks * effWeekly + remDays * effRemDaily : days * effRemDaily;
      if (appliedTier === 'DAILY') appliedTier = 'WEEKLY';
      lineItemType = 'WEEKLY_RATE';
      dailyRate = Math.round(grossTotalMinor / days);
    } else {
      grossTotalMinor = dailyRate * days;
    }
  }

  const lineItems: PriceLineItem[] = [
    {
      itemType: lineItemType,
      label: `${appliedRuleSource} (${days} j)`,
      quantity: days,
      unitPriceMinor: dailyRate,
      totalMinor: grossTotalMinor,
    },
  ];

  // Explicit discount application (never silent)
  const discountType =
    input.discountType && input.discountType !== 'NONE'
      ? input.discountType
      : customerDefaultDiscountPct > 0
        ? 'PERCENT'
        : 'NONE';
  const discountVal =
    input.discountType && input.discountType !== 'NONE'
      ? input.discountValue ?? 0
      : customerDefaultDiscountPct;

  let discountMinor = 0;
  if (discountType === 'FIXED' && discountVal > 0) {
    discountMinor = Math.min(grossTotalMinor, Math.round(discountVal));
    lineItems.push({
      itemType: 'FIXED_DISCOUNT',
      label: 'Remise fixe accordée',
      quantity: 1,
      unitPriceMinor: -discountMinor,
      totalMinor: -discountMinor,
    });
  } else if (discountType === 'PERCENT' && discountVal > 0) {
    const pct = Math.min(100, Math.max(0, discountVal));
    discountMinor = Math.min(grossTotalMinor, Math.round((grossTotalMinor * pct) / 100));
    lineItems.push({
      itemType: 'PERCENT_DISCOUNT',
      label: `Remise (${pct}%)`,
      quantity: pct,
      unitPriceMinor: 0,
      totalMinor: -discountMinor,
    });
  }

  const netTotalMinor = Math.max(0, grossTotalMinor - discountMinor);
  const discountPercentEffective =
    grossTotalMinor > 0 ? Number(((discountMinor / grossTotalMinor) * 100).toFixed(2)) : 0;

  return {
    days,
    appliedTier,
    appliedRuleSource,
    unitDailyRateMinor: dailyRate,
    grossTotalMinor,
    discountMinor,
    netTotalMinor,
    discountPercentEffective,
    maxAgentDiscountPercent,
    requiresAdminDiscountOverride: discountPercentEffective > maxAgentDiscountPercent,
    lineItems,
  };
}

export function listPricingRules(db: Database.Database) {
  const seasonalRates = db
    .prepare<[], any>(
      `SELECT sr.*, v.matricule, v.brand, v.model
       FROM seasonal_rates sr
       LEFT JOIN vehicles v ON v.id = sr.vehicle_id
       ORDER BY sr.start_date DESC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      vehicleCategory: r.vehicle_category,
      vehicleId: r.vehicle_id,
      vehicleLabel: r.vehicle_id ? `${r.brand} ${r.model} (${r.matricule})` : null,
      startDate: r.start_date,
      endDate: r.end_date,
      dailyRateMinor: r.daily_rate_minor,
      weeklyRateMinor: r.weekly_rate_minor,
      monthlyRateMinor: r.monthly_rate_minor,
      isActive: r.is_active === 1,
    }));

  const customerRates = db
    .prepare<[], any>(
      `SELECT cr.*, c.full_name AS customer_name, v.matricule, v.brand, v.model
       FROM customer_custom_rates cr
       JOIN customers c ON c.id = cr.customer_id
       LEFT JOIN vehicles v ON v.id = cr.vehicle_id
       WHERE cr.is_active = 1
       ORDER BY cr.id DESC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      vehicleCategory: r.vehicle_category,
      vehicleId: r.vehicle_id,
      vehicleLabel: r.vehicle_id ? `${r.brand} ${r.model} (${r.matricule})` : null,
      dailyRateMinor: r.daily_rate_minor,
      weeklyRateMinor: r.weekly_rate_minor,
      monthlyRateMinor: r.monthly_rate_minor,
      defaultDiscountPercent: r.default_discount_percent,
      notes: r.notes,
    }));

  return { seasonalRates, customerRates };
}

export function createSeasonalRate(
  db: Database.Database,
  actor: { id: number; username: string },
  input: any
) {
  const res = db
    .prepare(
      `INSERT INTO seasonal_rates (
        name, vehicle_category, vehicle_id, start_date, end_date,
        daily_rate_minor, weekly_rate_minor, monthly_rate_minor, is_active, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      input.name.trim(),
      input.vehicleCategory || null,
      input.vehicleId ?? null,
      input.startDate,
      input.endDate,
      input.dailyRateMinor,
      input.weeklyRateMinor ?? null,
      input.monthlyRateMinor ?? null,
      actor.id
    );
  const id = Number(res.lastInsertRowid);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'SEASONAL_RATE_CREATED',
    entityType: 'seasonal_rates',
    entityId: id,
    newValue: input,
  });
  return { id, ...input };
}

export function deleteSeasonalRate(
  db: Database.Database,
  actor: { id: number; username: string },
  id: number
) {
  db.prepare('DELETE FROM seasonal_rates WHERE id = ?').run(id);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'SEASONAL_RATE_DELETED',
    entityType: 'seasonal_rates',
    entityId: id,
  });
}

export function upsertCustomerCustomRate(
  db: Database.Database,
  actor: { id: number; username: string },
  input: any
) {
  const res = db
    .prepare(
      `INSERT INTO customer_custom_rates (
        customer_id, vehicle_category, vehicle_id, daily_rate_minor,
        weekly_rate_minor, monthly_rate_minor, default_discount_percent, notes, is_active, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      input.customerId,
      input.vehicleCategory || null,
      input.vehicleId ?? null,
      input.dailyRateMinor ?? null,
      input.weeklyRateMinor ?? null,
      input.monthlyRateMinor ?? null,
      input.defaultDiscountPercent ?? 0,
      input.notes || null,
      actor.id
    );
  const id = Number(res.lastInsertRowid);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'CUSTOMER_RATE_CREATED',
    entityType: 'customer_custom_rates',
    entityId: id,
    newValue: input,
  });
  return { id, ...input };
}
