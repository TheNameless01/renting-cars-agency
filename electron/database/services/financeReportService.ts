import type Database from 'better-sqlite3';
import type { CurrencyCode, ExpenseCategory, PaymentMethod } from '../../../shared/types/domain.ts';
import { getCurrentCashSession } from './cashRegisterService.ts';
import { listExpenses } from './expenseService.ts';

function getDefaultDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return {
    dateFrom: `${year}-${month}-01`,
    dateTo: `${year}-${month}-${day}`,
  };
}

function escapeCsvCell(val: string | number | null | undefined): string {
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  let s = val == null ? '' : String(val);
  if (/^[\t\r ]*[=+\-@]/.test(s) || s.startsWith('\t') || s.startsWith('\r')) {
    s = `'${s}`;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function getVehicleProfitabilityReport(
  db: Database.Database,
  params?: { dateFrom?: string; dateTo?: string; includeArchived?: boolean }
) {
  const dateFrom = params?.dateFrom?.slice(0, 10) || null;
  const dateTo = params?.dateTo?.slice(0, 10) || null;

  const vehicles = db
    .prepare<[], any>(
      `SELECT * FROM vehicles ${params?.includeArchived ? '' : 'WHERE is_archived = 0'} ORDER BY id DESC`
    )
    .all();

  const contractDateFilter =
    dateFrom && dateTo
      ? 'AND substr(rc.start_date, 1, 10) >= ? AND substr(rc.start_date, 1, 10) <= ?'
      : '';
  const paymentDateFilter =
    dateFrom && dateTo
      ? 'AND substr(cp.payment_date, 1, 10) >= ? AND substr(cp.payment_date, 1, 10) <= ?'
      : '';
  const expenseDateFilter =
    dateFrom && dateTo
      ? 'AND substr(e.expense_date, 1, 10) >= ? AND substr(e.expense_date, 1, 10) <= ?'
      : '';

  const rangeArgs = dateFrom && dateTo ? [dateFrom, dateTo] : [];

  return vehicles.map((v) => {
    const revRow = db
      .prepare<Array<string | number>, any>(
        `SELECT COUNT(*) AS contract_count,
                COALESCE(SUM(rc.total_contract_amount_minor), 0) AS rental_revenue_minor,
                COALESCE(SUM(MAX(1, CAST(ROUND((julianday(COALESCE(rc.actual_return_date, rc.expected_return_date)) - julianday(rc.start_date))) AS INTEGER))), 0) AS rented_days
         FROM rental_contracts rc
         WHERE rc.vehicle_id = ? AND rc.status != 'CANCELLED' ${contractDateFilter}`
      )
      .get(v.id, ...rangeArgs);

    const colRow = db
      .prepare<Array<string | number>, { collected_net_minor: number }>(
        `SELECT COALESCE(SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END), 0) AS collected_net_minor
         FROM contract_payments cp
         JOIN rental_contracts rc ON rc.id = cp.contract_id
         WHERE rc.vehicle_id = ? ${paymentDateFilter}`
      )
      .get(v.id, ...rangeArgs);

    const expRow = db
      .prepare<Array<string | number>, { expenses_minor: number }>(
        `SELECT COALESCE(SUM(e.amount_minor), 0) AS expenses_minor
         FROM expenses e
         WHERE e.vehicle_id = ? AND e.status = 'POSTED' ${expenseDateFilter}`
      )
      .get(v.id, ...rangeArgs);

    const rentalRevenueMinor = Number(revRow?.rental_revenue_minor ?? 0);
    const collectedMinor = Number(colRow?.collected_net_minor ?? 0);
    const expensesMinor = Number(expRow?.expenses_minor ?? 0);
    const netProfitMinor = rentalRevenueMinor - expensesMinor;
    const acquisitionCostMinor = v.acquisition_cost_minor != null ? Number(v.acquisition_cost_minor) : null;
    const roiPercent =
      acquisitionCostMinor && acquisitionCostMinor > 0
        ? Number(((netProfitMinor / acquisitionCostMinor) * 100).toFixed(1))
        : null;

    return {
      vehicleId: v.id as number,
      internalCode: v.internal_code as string,
      matricule: v.matricule as string,
      brand: v.brand as string,
      model: v.model as string,
      category: v.category as string,
      contractCount: Number(revRow?.contract_count ?? 0),
      rentedDays: Number(revRow?.rented_days ?? 0),
      rentalRevenueMinor,
      collectedMinor,
      expensesMinor,
      netProfitMinor,
      acquisitionCostMinor,
      roiPercent,
    };
  });
}

export function getVehicleFinanceSummary(db: Database.Database, vehicleId: number) {
  const expenses = listExpenses(db, { vehicleId });
  const profit = getVehicleProfitabilityReport(db, { includeArchived: true }).find(
    (p) => p.vehicleId === vehicleId
  );

  const fineRow = db
    .prepare<[number], { total_fines_minor: number; unpaid_fines_minor: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total_fines_minor,
              COALESCE(SUM(CASE WHEN is_paid_by_customer = 0 THEN amount_minor ELSE 0 END), 0) AS unpaid_fines_minor
       FROM traffic_fines
       WHERE vehicle_id = ?`
    )
    .get(vehicleId);

  return {
    vehicleId,
    expenses,
    profitability: profit ?? {
      vehicleId,
      internalCode: '',
      matricule: '',
      brand: '',
      model: '',
      category: '',
      contractCount: 0,
      rentedDays: 0,
      rentalRevenueMinor: 0,
      collectedMinor: 0,
      expensesMinor: 0,
      netProfitMinor: 0,
      acquisitionCostMinor: null,
      roiPercent: null,
    },
    totalFinesMinor: Number(fineRow?.total_fines_minor ?? 0),
    unpaidFinesMinor: Number(fineRow?.unpaid_fines_minor ?? 0),
  };
}

export function getFinancialDashboardReports(
  db: Database.Database,
  params?: { dateFrom?: string; dateTo?: string }
) {
  const defaults = getDefaultDateRange();
  const dateFrom = (params?.dateFrom || defaults.dateFrom).slice(0, 10);
  const dateTo = (params?.dateTo || defaults.dateTo).slice(0, 10);
  const nowIso = new Date().toISOString();

  // 1. Period Rental Revenue (from non-cancelled contracts + customer adjustments; deposits NEVER included; payments NOT double-counted)
  const periodContractRevRow = db
    .prepare<[string, string], { total_rev_minor: number; contract_count: number }>(
      `SELECT COALESCE(SUM(total_contract_amount_minor), 0) AS total_rev_minor,
              COUNT(*) AS contract_count
       FROM rental_contracts
       WHERE status != 'CANCELLED'
         AND substr(start_date, 1, 10) >= ?
         AND substr(start_date, 1, 10) <= ?`
    )
    .get(dateFrom, dateTo);

  const periodAdjRevRow = db
    .prepare<[string, string], { adj_net_minor: number }>(
      `SELECT COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor
                                WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -amount_minor
                                ELSE 0 END), 0) AS adj_net_minor
       FROM customer_financial_adjustments
       WHERE substr(adjustment_date, 1, 10) >= ?
         AND substr(adjustment_date, 1, 10) <= ?`
    )
    .get(dateFrom, dateTo);

  const periodContractRevenueMinor = Number(periodContractRevRow?.total_rev_minor ?? 0);
  const periodAdjustmentsNetMinor = Number(periodAdjRevRow?.adj_net_minor ?? 0);
  const periodTotalRevenueMinor = Math.max(0, periodContractRevenueMinor + periodAdjustmentsNetMinor);

  // 2. Period Collected Payments vs Rental Refunds (strictly cashflow, distinct from accrued revenue)
  const paymentRowsInRange = db
    .prepare<[string, string], { direction: string; method: PaymentMethod; total_minor: number }>(
      `SELECT direction, method, COALESCE(SUM(amount_minor), 0) AS total_minor
       FROM contract_payments
       WHERE substr(payment_date, 1, 10) >= ?
         AND substr(payment_date, 1, 10) <= ?
       GROUP BY direction, method`
    )
    .all(dateFrom, dateTo);

  let periodPaymentInflowsMinor = 0;
  let periodPaymentRefundsMinor = 0;
  const collectedByMethod: Record<PaymentMethod, number> = {
    CASH: 0,
    CCP: 0,
    BARIDIMOB: 0,
    BANK_TRANSFER: 0,
    OTHER: 0,
  };

  for (const r of paymentRowsInRange) {
    const amt = Number(r.total_minor ?? 0);
    if (r.direction === 'INFLOW') {
      periodPaymentInflowsMinor += amt;
      collectedByMethod[r.method] = (collectedByMethod[r.method] ?? 0) + amt;
    } else {
      periodPaymentRefundsMinor += amt;
      collectedByMethod[r.method] = (collectedByMethod[r.method] ?? 0) - amt;
    }
  }
  const periodCollectedNetMinor = periodPaymentInflowsMinor - periodPaymentRefundsMinor;

  // 3. Portfolio-wide Billed vs Collected vs Outstanding vs Overdue
  const portfolioContracts = db
    .prepare<[], any>(
      `SELECT rc.id, rc.status, rc.expected_return_date, rc.total_contract_amount_minor,
              COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                        FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor
       FROM rental_contracts rc
       WHERE rc.status != 'CANCELLED'`
    )
    .all();

  const allAdjRow = db
    .prepare<[], { adj_net_minor: number }>(
      `SELECT COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor
                                WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -amount_minor
                                ELSE 0 END), 0) AS adj_net_minor
       FROM customer_financial_adjustments`
    )
    .get();

  const portfolioContractsBilledMinor = portfolioContracts.reduce(
    (s, c) => s + Number(c.total_contract_amount_minor ?? 0),
    0
  );
  const portfolioBilledMinor = Math.max(0, portfolioContractsBilledMinor + Number(allAdjRow?.adj_net_minor ?? 0));
  const portfolioCollectedNetMinor = portfolioContracts.reduce(
    (s, c) => s + Number(c.paid_net_minor ?? 0),
    0
  );
  const portfolioOutstandingMinor = Math.max(0, portfolioBilledMinor - portfolioCollectedNetMinor);
  const portfolioOverdueMinor = Math.min(
    portfolioOutstandingMinor,
    portfolioContracts.reduce((s, c) => {
      const rem = Math.max(0, Number(c.total_contract_amount_minor ?? 0) - Number(c.paid_net_minor ?? 0));
      if (rem > 0 && (c.status === 'COMPLETED' || String(c.expected_return_date) < nowIso)) {
        return s + rem;
      }
      return s;
    }, 0)
  );

  // 4. Expenses in period (only POSTED expenses)
  const expByCatRows = db
    .prepare<[string, string], { category: ExpenseCategory; vehicle_minor: number; agency_minor: number; total_minor: number }>(
      `SELECT category,
              COALESCE(SUM(CASE WHEN vehicle_id IS NOT NULL THEN amount_minor ELSE 0 END), 0) AS vehicle_minor,
              COALESCE(SUM(CASE WHEN vehicle_id IS NULL THEN amount_minor ELSE 0 END), 0) AS agency_minor,
              COALESCE(SUM(amount_minor), 0) AS total_minor
       FROM expenses
       WHERE status = 'POSTED'
         AND substr(expense_date, 1, 10) >= ?
         AND substr(expense_date, 1, 10) <= ?
       GROUP BY category
       ORDER BY total_minor DESC`
    )
    .all(dateFrom, dateTo);

  let periodExpensesMinor = 0;
  let vehicleExpensesMinor = 0;
  let agencyExpensesMinor = 0;
  const expensesByCategory = expByCatRows.map((r) => {
    const t = Number(r.total_minor ?? 0);
    const vm = Number(r.vehicle_minor ?? 0);
    const am = Number(r.agency_minor ?? 0);
    periodExpensesMinor += t;
    vehicleExpensesMinor += vm;
    agencyExpensesMinor += am;
    return {
      category: r.category,
      vehicleMinor: vm,
      agencyMinor: am,
      totalMinor: t,
    };
  });

  // 5. Security Deposits Liability (ALWAYS separate from rental revenue)
  const depLiabilityRow = db
    .prepare<[], any>(
      `SELECT COUNT(CASE WHEN (amount_minor - deducted_amount_minor - refunded_amount_minor) > 0 THEN 1 END) AS held_count,
              COALESCE(SUM(MAX(0, amount_minor - deducted_amount_minor - refunded_amount_minor)), 0) AS currently_held_dzd_minor
       FROM deposits
       WHERE currency = 'DZD'`
    )
    .get();

  const depEurLiabilityRow = db
    .prepare<[], { currently_held_eur_minor: number }>(
      `SELECT COALESCE(SUM(MAX(0, amount_minor - deducted_amount_minor - refunded_amount_minor)), 0) AS currently_held_eur_minor
       FROM deposits
       WHERE currency = 'EUR'`
    )
    .get();

  const depMovInRange = db
    .prepare<[string, string], { movement_type: string; total_minor: number }>(
      `SELECT dm.movement_type, COALESCE(SUM(dm.amount_minor), 0) AS total_minor
       FROM deposit_movements dm
       JOIN deposits d ON d.id = dm.deposit_id
       WHERE d.currency = 'DZD'
         AND substr(dm.created_at, 1, 10) >= ?
         AND substr(dm.created_at, 1, 10) <= ?
       GROUP BY dm.movement_type`
    )
    .all(dateFrom, dateTo);

  let periodDepositsReceivedMinor = 0;
  let periodDepositsDeductedMinor = 0;
  let periodDepositsRefundedMinor = 0;
  for (const m of depMovInRange) {
    const amt = Number(m.total_minor ?? 0);
    if (m.movement_type === 'RECEIVED') periodDepositsReceivedMinor += amt;
    if (m.movement_type === 'DEDUCTED') periodDepositsDeductedMinor += amt;
    if (m.movement_type === 'REFUNDED') periodDepositsRefundedMinor += amt;
  }

  // 6. Cash Position
  const currentCash = getCurrentCashSession(db);
  const cumulativeCashRow = db
    .prepare<[], { cash_in_payments: number }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0) AS cash_in_payments
       FROM contract_payments
       WHERE method = 'CASH' AND currency = 'DZD'`
    )
    .get();
  const cumulativeCashExpensesRow = db
    .prepare<[], { cash_expenses: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS cash_expenses
       FROM expenses
       WHERE payment_method = 'CASH' AND currency = 'DZD' AND status = 'POSTED'`
    )
    .get();

  const agencyOperatingCashNetMinor =
    Number(cumulativeCashRow?.cash_in_payments ?? 0) - Number(cumulativeCashExpensesRow?.cash_expenses ?? 0);

  // 7. Daily & Monthly Revenue Series in [dateFrom, dateTo]
  const dailyMap = new Map<
    string,
    {
      date: string;
      contractRevenueMinor: number;
      adjustmentsNetMinor: number;
      totalRevenueMinor: number;
      collectedMinor: number;
      expensesMinor: number;
    }
  >();

  const ensureDay = (d: string) => {
    let entry = dailyMap.get(d);
    if (!entry) {
      entry = {
        date: d,
        contractRevenueMinor: 0,
        adjustmentsNetMinor: 0,
        totalRevenueMinor: 0,
        collectedMinor: 0,
        expensesMinor: 0,
      };
      dailyMap.set(d, entry);
    }
    return entry;
  };

  db.prepare<[string, string], { day: string; amt: number }>(
    `SELECT substr(start_date, 1, 10) AS day, COALESCE(SUM(total_contract_amount_minor), 0) AS amt
     FROM rental_contracts
     WHERE status != 'CANCELLED' AND substr(start_date, 1, 10) >= ? AND substr(start_date, 1, 10) <= ?
     GROUP BY day`
  )
    .all(dateFrom, dateTo)
    .forEach((r) => {
      const e = ensureDay(r.day);
      e.contractRevenueMinor += Number(r.amt);
    });

  db.prepare<[string, string], { day: string; amt: number }>(
    `SELECT substr(adjustment_date, 1, 10) AS day,
            COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor
                              WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -amount_minor
                              ELSE 0 END), 0) AS amt
     FROM customer_financial_adjustments
     WHERE substr(adjustment_date, 1, 10) >= ? AND substr(adjustment_date, 1, 10) <= ?
     GROUP BY day`
  )
    .all(dateFrom, dateTo)
    .forEach((r) => {
      const e = ensureDay(r.day);
      e.adjustmentsNetMinor += Number(r.amt);
    });

  db.prepare<[string, string], { day: string; amt: number }>(
    `SELECT substr(payment_date, 1, 10) AS day,
            COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0) AS amt
     FROM contract_payments
     WHERE substr(payment_date, 1, 10) >= ? AND substr(payment_date, 1, 10) <= ?
     GROUP BY day`
  )
    .all(dateFrom, dateTo)
    .forEach((r) => {
      const e = ensureDay(r.day);
      e.collectedMinor += Number(r.amt);
    });

  db.prepare<[string, string], { day: string; amt: number }>(
    `SELECT substr(expense_date, 1, 10) AS day, COALESCE(SUM(amount_minor), 0) AS amt
     FROM expenses
     WHERE status = 'POSTED' AND substr(expense_date, 1, 10) >= ? AND substr(expense_date, 1, 10) <= ?
     GROUP BY day`
  )
    .all(dateFrom, dateTo)
    .forEach((r) => {
      const e = ensureDay(r.day);
      e.expensesMinor += Number(r.amt);
    });

  const dailyRevenue = Array.from(dailyMap.values())
    .map((d) => ({
      ...d,
      totalRevenueMinor: Math.max(0, d.contractRevenueMinor + d.adjustmentsNetMinor),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthlyMap = new Map<
    string,
    {
      month: string;
      contractRevenueMinor: number;
      adjustmentsNetMinor: number;
      totalRevenueMinor: number;
      collectedMinor: number;
      expensesMinor: number;
    }
  >();

  for (const d of dailyRevenue) {
    const m = d.date.slice(0, 7);
    const cur = monthlyMap.get(m) ?? {
      month: m,
      contractRevenueMinor: 0,
      adjustmentsNetMinor: 0,
      totalRevenueMinor: 0,
      collectedMinor: 0,
      expensesMinor: 0,
    };
    cur.contractRevenueMinor += d.contractRevenueMinor;
    cur.adjustmentsNetMinor += d.adjustmentsNetMinor;
    cur.totalRevenueMinor += d.totalRevenueMinor;
    cur.collectedMinor += d.collectedMinor;
    cur.expensesMinor += d.expensesMinor;
    monthlyMap.set(m, cur);
  }
  const monthlyRevenue = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // 8. Vehicle Rental Profitability
  const vehicleProfitability = getVehicleProfitabilityReport(db, { dateFrom, dateTo });

  return {
    dateFrom,
    dateTo,
    currency: 'DZD' as CurrencyCode,
    summary: {
      contractCount: Number(periodContractRevRow?.contract_count ?? 0),
      rentalRevenueMinor: periodTotalRevenueMinor,
      collectedNetMinor: periodCollectedNetMinor,
      paymentInflowsMinor: periodPaymentInflowsMinor,
      paymentRefundsMinor: periodPaymentRefundsMinor,
      expensesMinor: periodExpensesMinor,
      vehicleExpensesMinor,
      agencyExpensesMinor,
      netOperatingIncomeMinor: periodTotalRevenueMinor - periodExpensesMinor,
      portfolioBilledMinor,
      portfolioCollectedNetMinor,
      portfolioOutstandingMinor,
      portfolioOverdueMinor,
      depositsCurrentlyHeldDzdMinor: Number(depLiabilityRow?.currently_held_dzd_minor ?? 0),
      depositsCurrentlyHeldEurMinor: Number(depEurLiabilityRow?.currently_held_eur_minor ?? 0),
      depositsHeldCount: Number(depLiabilityRow?.held_count ?? 0),
      periodDepositsReceivedMinor,
      periodDepositsDeductedMinor,
      periodDepositsRefundedMinor,
      totalRefundsMinor: periodPaymentRefundsMinor + periodDepositsRefundedMinor,
      openCashSessionBalanceMinor: currentCash.session ? currentCash.session.expectedClosingMinor : null,
      openCashSessionDate: currentCash.session ? currentCash.session.sessionDate : null,
      lastClosedCashBalanceMinor: currentCash.suggestedOpeningBalanceMinor,
      agencyOperatingCashNetMinor,
    },
    collectedByMethod,
    expensesByCategory,
    dailyRevenue,
    monthlyRevenue,
    vehicleProfitability,
  };
}

export function buildFinancialReportCsv(
  report: ReturnType<typeof getFinancialDashboardReports>,
  lang: 'fr' | 'ar' = 'fr'
): string {
  const lines: string[] = [];
  const toDzd = (minor: number) => (minor / 100).toFixed(2);

  lines.push(
    lang === 'ar'
      ? `التقرير المالي (${report.dateFrom} -> ${report.dateTo})`
      : `Rapport Financier (${report.dateFrom} -> ${report.dateTo})`
  );
  lines.push('');

  lines.push(lang === 'ar' ? 'المؤشر,القيمة (دج)' : 'Indicateur,Montant (DZD)');
  const s = report.summary;
  const kpis: Array<[string, string]> =
    lang === 'ar'
      ? [
          ['إيرادات الكراء (دون الكفالات)', toDzd(s.rentalRevenueMinor)],
          ['المبالغ المحصلة الصافية', toDzd(s.collectedNetMinor)],
          ['المستحقات غير المدفوعة (المحفظة)', toDzd(s.portfolioOutstandingMinor)],
          ['الديون المتأخرة', toDzd(s.portfolioOverdueMinor)],
          ['إجمالي المصاريف المعتمدة', toDzd(s.expensesMinor)],
          ['صافي نتيجة الاستغلال', toDzd(s.netOperatingIncomeMinor)],
          ['الكفالات المحتجزة (التزام مالي)', toDzd(s.depositsCurrentlyHeldDzdMinor)],
          ['المبالغ المستردة (كراء + كفالات)', toDzd(s.totalRefundsMinor)],
          ['وضعية الصندوق المفتوح', s.openCashSessionBalanceMinor != null ? toDzd(s.openCashSessionBalanceMinor) : 'مغلق'],
        ]
      : [
          ['Chiffre d’affaires locatif (hors cautions)', toDzd(s.rentalRevenueMinor)],
          ['Encaissements nets de location', toDzd(s.collectedNetMinor)],
          ['Solde restant à encaisser (Portefeuille)', toDzd(s.portfolioOutstandingMinor)],
          ['Créances échues / en retard', toDzd(s.portfolioOverdueMinor)],
          ['Dépenses validées', toDzd(s.expensesMinor)],
          ['Résultat net d’exploitation', toDzd(s.netOperatingIncomeMinor)],
          ['Cautions détenues (Passif / Dette)', toDzd(s.depositsCurrentlyHeldDzdMinor)],
          ['Remboursements (Location + Cautions)', toDzd(s.totalRefundsMinor)],
          ['Solde caisse ouverte', s.openCashSessionBalanceMinor != null ? toDzd(s.openCashSessionBalanceMinor) : 'Fermée'],
        ];

  for (const [k, v] of kpis) {
    lines.push(`${escapeCsvCell(k)},${escapeCsvCell(v)}`);
  }

  lines.push('');
  lines.push(
    lang === 'ar'
      ? 'التاريخ,إيرادات الكراء,المحصّل الصافي,المصاريف'
      : 'Date,Revenu locatif (DZD),Encaissement net (DZD),Dépenses (DZD)'
  );
  for (const d of report.dailyRevenue) {
    lines.push(
      [
        escapeCsvCell(d.date),
        escapeCsvCell(toDzd(d.totalRevenueMinor)),
        escapeCsvCell(toDzd(d.collectedMinor)),
        escapeCsvCell(toDzd(d.expensesMinor)),
      ].join(',')
    );
  }

  lines.push('');
  lines.push(
    lang === 'ar'
      ? 'المركبة,الترقيم,العقود,الأيام,إيرادات الكراء,المصاريف,صافي الربح,العائد %'
      : 'Véhicule,Matricule,Contrats,Jours loués,Revenu locatif (DZD),Dépenses (DZD),Marge nette (DZD),ROI (%)'
  );
  for (const vp of report.vehicleProfitability) {
    lines.push(
      [
        escapeCsvCell(`${vp.brand} ${vp.model}`),
        escapeCsvCell(vp.matricule),
        escapeCsvCell(vp.contractCount),
        escapeCsvCell(vp.rentedDays),
        escapeCsvCell(toDzd(vp.rentalRevenueMinor)),
        escapeCsvCell(toDzd(vp.expensesMinor)),
        escapeCsvCell(toDzd(vp.netProfitMinor)),
        escapeCsvCell(vp.roiPercent != null ? `${vp.roiPercent}%` : '—'),
      ].join(',')
    );
  }

  // UTF-8 BOM ensures Excel opens French & Arabic characters properly
  return `\uFEFF${lines.join('\r\n')}`;
}
