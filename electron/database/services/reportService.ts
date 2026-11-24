import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import type {
  AppLanguage,
  ReportDataset,
  ReportFilter,
} from '../../../shared/types/domain.ts';
import { getVehicleMaintenanceDueSummary } from './alertService.ts';
import { listCustomerFinancialAccounts } from './customerFinanceService.ts';
import { getFinancialDashboardReports, getVehicleProfitabilityReport } from './financeReportService.ts';
import { applyNumeralPreference, formatDateForDoc, formatMoneyForDoc } from '../../documents/arabicText.ts';

function defaultRange() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return { dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${d}` };
}

/**
 * Prevents spreadsheet formula injection (CWE-1236) in CSV and string XLSX cells.
 */
export function sanitizeSpreadsheetText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const str = String(raw).replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
  if (/^[\t\r ]*[=+\-@]/.test(str) || str.startsWith('\t') || str.startsWith('\r')) {
    return `'${str}`;
  }
  return str;
}

export function escapeSafeCsvCell(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  const safe = sanitizeSpreadsheetText(raw);
  if (safe.includes(',') || safe.includes('"') || safe.includes(';') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function generateReportDataset(
  db: Database.Database,
  rawFilter: ReportFilter
): ReportDataset {
  const defaults = defaultRange();
  const dateFrom = (rawFilter.dateFrom || defaults.dateFrom).slice(0, 10);
  const dateTo = (rawFilter.dateTo || defaults.dateTo).slice(0, 10);
  const lang: AppLanguage = rawFilter.language ?? 'fr';
  const filter: ReportFilter = {
    ...rawFilter,
    dateFrom,
    dateTo,
    language: lang,
  };

  const disclosuresFr = [
    'Les cautions (dépôts de garantie) sont des dettes fiduciaires et sont STRICTEMENT EXCLUES du chiffre d’affaires locatif.',
    'Le chiffre d’affaires contracté (valeur totale des contrats), les encaissements effectifs et le reste à recouvrer sont présentés séparément.',
    'Les pièces de rechange consommées en maintenance sont suivies sans double comptabilisation avec les dépenses de maintenance liées.',
    'La rentabilité par véhicule reflète les flux opérationnels de la période (loyers moins charges/maintenance directes) et n’intègre ni amortissement comptable ni financement.',
  ];
  const disclosuresAr = [
    'مبالغ الضمان (الكفالات) تُعد أمانة مستردة وهي مستبعدة تماماً من رقم أعمال الكراء.',
    'يتم فصل رقم الأعمال المتعاقد عليه عن التحصيلات النقدية/البنكية الفعلية وعن الذمم المتبقية لدى الزبائن.',
    'قطع الغيار المستهلكة في الصيانة لا يتم احتسابها مرتين مع مصاريف الصيانة المرتبطة.',
    'مؤشر مردودية المركبة يعكس التدفقات التشغيلية للفترة المحددة فقط ولا يشمل الاستهلاك المحاسبي أو تكاليف التمويل.',
  ];

  const today = new Date().toISOString().slice(0, 10);
  const kpis: ReportDataset['kpis'] = [];
  const sections: ReportDataset['sections'] = [];

  const wantSection = (key: string): boolean => {
    if (filter.category !== 'CUSTOM') return true;
    const picked = filter.includeSections ?? [];
    return picked.length === 0 || picked.includes(key);
  };

  // Shared helpers
  const contractClauses: string[] = [
    "rc.status != 'CANCELLED'",
    'substr(rc.start_date, 1, 10) >= ?',
    'substr(rc.start_date, 1, 10) <= ?',
  ];
  const contractArgs: Array<string | number> = [dateFrom, dateTo];
  if (filter.customerId) {
    contractClauses.push('rc.customer_id = ?');
    contractArgs.push(filter.customerId);
  }
  if (filter.vehicleId) {
    contractClauses.push('rc.vehicle_id = ?');
    contractArgs.push(filter.vehicleId);
  }
  if (filter.userId) {
    contractClauses.push('rc.created_by_user_id = ?');
    contractArgs.push(filter.userId);
  }
  if (filter.status) {
    contractClauses.push('rc.status = ?');
    contractArgs.push(filter.status);
  }

  // ==================== FINANCIAL & CUSTOM FINANCIAL SECTIONS ====================
  if (filter.category === 'FINANCIAL' || filter.category === 'CUSTOM') {
    const dash = getFinancialDashboardReports(db, { dateFrom, dateTo });

    // Filtered payments
    const payClauses: string[] = [
      'substr(cp.payment_date, 1, 10) >= ?',
      'substr(cp.payment_date, 1, 10) <= ?',
    ];
    const payArgs: Array<string | number> = [dateFrom, dateTo];
    if (filter.customerId) {
      payClauses.push('rc.customer_id = ?');
      payArgs.push(filter.customerId);
    }
    if (filter.vehicleId) {
      payClauses.push('rc.vehicle_id = ?');
      payArgs.push(filter.vehicleId);
    }
    if (filter.userId) {
      payClauses.push('cp.recorded_by_user_id = ?');
      payArgs.push(filter.userId);
    }
    if (filter.transactionType && ['INFLOW', 'REFUND'].includes(filter.transactionType)) {
      payClauses.push('cp.direction = ?');
      payArgs.push(filter.transactionType);
    }

    const paymentRows = db
      .prepare<Array<string | number>, any>(
        `SELECT cp.*, rc.contract_number, c.full_name AS customer_name,
                v.matricule, u.username AS recorded_by_username
         FROM contract_payments cp
         JOIN rental_contracts rc ON rc.id = cp.contract_id
         JOIN customers c ON c.id = rc.customer_id
         JOIN vehicles v ON v.id = rc.vehicle_id
         LEFT JOIN users u ON u.id = cp.recorded_by_user_id
         WHERE ${payClauses.join(' AND ')}
         ORDER BY cp.payment_date DESC, cp.id DESC`
      )
      .all(...payArgs);

    let totalInflowMinor = 0;
    let totalRefundMinor = 0;
    const byMethod = new Map<string, { method: string; inflows: number; refunds: number; count: number }>();
    for (const p of paymentRows) {
      const amt = Number(p.amount_minor ?? 0);
      const cur = byMethod.get(p.method) ?? { method: p.method, inflows: 0, refunds: 0, count: 0 };
      cur.count += 1;
      if (p.direction === 'INFLOW') {
        totalInflowMinor += amt;
        cur.inflows += amt;
      } else {
        totalRefundMinor += amt;
        cur.refunds += amt;
      }
      byMethod.set(p.method, cur);
    }
    const netCollectedMinor = totalInflowMinor - totalRefundMinor;

    // Filtered expenses
    const expClauses: string[] = [
      "e.status = 'POSTED'",
      'substr(e.expense_date, 1, 10) >= ?',
      'substr(e.expense_date, 1, 10) <= ?',
    ];
    const expArgs: Array<string | number> = [dateFrom, dateTo];
    if (filter.vehicleId) {
      expClauses.push('e.vehicle_id = ?');
      expArgs.push(filter.vehicleId);
    }
    if (filter.userId) {
      expClauses.push('e.recorded_by_user_id = ?');
      expArgs.push(filter.userId);
    }
    if (filter.expenseCategory) {
      expClauses.push('e.category = ?');
      expArgs.push(filter.expenseCategory);
    }

    const expenseRows = db
      .prepare<Array<string | number>, any>(
        `SELECT e.*, v.matricule, s.name AS supplier_name, u.username AS recorded_by_username
         FROM expenses e
         LEFT JOIN vehicles v ON v.id = e.vehicle_id
         LEFT JOIN suppliers s ON s.id = e.supplier_id
         LEFT JOIN users u ON u.id = e.recorded_by_user_id
         WHERE ${expClauses.join(' AND ')}
         ORDER BY e.expense_date DESC, e.id DESC`
      )
      .all(...expArgs);

    const totalExpensesMinor = expenseRows.reduce((s, r) => s + Number(r.amount_minor ?? 0), 0);

    // Filtered contracted revenue
    const contractedRow = db
      .prepare<Array<string | number>, { total_minor: number; cnt: number }>(
        `SELECT COALESCE(SUM(rc.total_contract_amount_minor), 0) AS total_minor, COUNT(*) AS cnt
         FROM rental_contracts rc
         WHERE ${contractClauses.join(' AND ')}`
      )
      .get(...contractArgs);

    const contractedMinor = Number(contractedRow?.total_minor ?? 0);

    if (filter.category === 'FINANCIAL') {
      kpis.push(
        {
          key: 'contracted_revenue',
          labelFr: 'Revenus locatifs contractés',
          labelAr: 'الإيرادات المتعاقد عليها',
          valueDisplay: formatMoneyForDoc(contractedMinor, 'DZD', lang),
          numericValue: contractedMinor / 100,
          unit: 'DZD',
          tone: 'neutral',
          noteFr: `${Number(contractedRow?.cnt ?? 0)} contrat(s) hors annulés (hors cautions)`,
          noteAr: `${Number(contractedRow?.cnt ?? 0)} عقد (باستثناء الكفالات)`,
        },
        {
          key: 'net_collected',
          labelFr: 'Encaissements nets perçus',
          labelAr: 'التحصيلات الصافية المستلمة',
          valueDisplay: formatMoneyForDoc(netCollectedMinor, 'DZD', lang),
          numericValue: netCollectedMinor / 100,
          unit: 'DZD',
          tone: 'positive',
        },
        {
          key: 'total_expenses',
          labelFr: 'Dépenses comptabilisées',
          labelAr: 'المصاريف المسجلة',
          valueDisplay: formatMoneyForDoc(totalExpensesMinor, 'DZD', lang),
          numericValue: totalExpensesMinor / 100,
          unit: 'DZD',
          tone: 'warning',
        },
        {
          key: 'net_cash_flow',
          labelFr: 'Flux net (Encaissé - Dépenses)',
          labelAr: 'التدفق الصافي (المحصل - المصاريف)',
          valueDisplay: formatMoneyForDoc(netCollectedMinor - totalExpensesMinor, 'DZD', lang),
          numericValue: (netCollectedMinor - totalExpensesMinor) / 100,
          unit: 'DZD',
          tone: netCollectedMinor - totalExpensesMinor >= 0 ? 'positive' : 'danger',
        },
        {
          key: 'receivables_total',
          labelFr: 'Créances clients impayées',
          labelAr: 'مستحقات الزبائن غير المسددة',
          valueDisplay: formatMoneyForDoc(dash.summary.portfolioOutstandingMinor, 'DZD', lang),
          numericValue: dash.summary.portfolioOutstandingMinor / 100,
          unit: 'DZD',
          tone: dash.summary.portfolioOutstandingMinor > 0 ? 'danger' : 'neutral',
        },
        {
          key: 'deposits_held',
          labelFr: 'Cautions actuellement détenues (Hors CA)',
          labelAr: 'الكفالات المحتجزة حالياً (خارج رقم الأعمال)',
          valueDisplay: formatMoneyForDoc(dash.summary.depositsCurrentlyHeldDzdMinor, 'DZD', lang),
          numericValue: dash.summary.depositsCurrentlyHeldDzdMinor / 100,
          unit: 'DZD',
          tone: 'neutral',
        }
      );
    }

    if (wantSection('revenue_payments')) {
      sections.push({
        id: 'payments_by_method',
        titleFr: 'Encaissements & remboursements par moyen de paiement',
        titleAr: 'التحصيلات والمبالغ المسترجعة حسب وسيلة الدفع',
        columns: [
          { key: 'method', labelFr: 'Moyen', labelAr: 'الوسيلة', type: 'text' },
          { key: 'count', labelFr: 'Opérations', labelAr: 'العمليات', type: 'number' },
          { key: 'inflowsMinor', labelFr: 'Encaissé (DZD)', labelAr: 'المحصل (دج)', type: 'currency_minor' },
          { key: 'refundsMinor', labelFr: 'Remboursé (DZD)', labelAr: 'المسترجع (دج)', type: 'currency_minor' },
          { key: 'netMinor', labelFr: 'Net (DZD)', labelAr: 'الصافي (دج)', type: 'currency_minor' },
        ],
        rows: Array.from(byMethod.values()).map((m) => ({
          method: m.method,
          count: m.count,
          inflowsMinor: m.inflows,
          refundsMinor: m.refunds,
          netMinor: m.inflows - m.refunds,
        })),
        totalsRow: {
          method: lang === 'ar' ? 'المجموع' : 'Total',
          count: paymentRows.length,
          inflowsMinor: totalInflowMinor,
          refundsMinor: totalRefundMinor,
          netMinor: netCollectedMinor,
        },
      });

      sections.push({
        id: 'revenue_payments',
        titleFr: 'Journal détaillé des paiements',
        titleAr: 'سجل المدفوعات التفصيلي',
        columns: [
          { key: 'receiptNumber', labelFr: 'Reçu', labelAr: 'الوصل', type: 'text' },
          { key: 'paymentDate', labelFr: 'Date', labelAr: 'التاريخ', type: 'date' },
          { key: 'contractNumber', labelFr: 'Contrat', labelAr: 'العقد', type: 'text' },
          { key: 'customerName', labelFr: 'Client', labelAr: 'الزبون', type: 'text' },
          { key: 'direction', labelFr: 'Sens', labelAr: 'النوع', type: 'text' },
          { key: 'method', labelFr: 'Moyen', labelAr: 'الوسيلة', type: 'text' },
          { key: 'amountMinor', labelFr: 'Montant (DZD)', labelAr: 'المبلغ (دج)', type: 'currency_minor' },
        ],
        rows: paymentRows.map((p) => ({
          receiptNumber: p.receipt_number,
          paymentDate: p.payment_date.slice(0, 10),
          contractNumber: p.contract_number,
          customerName: p.customer_name,
          direction: p.direction,
          method: p.method,
          amountMinor: Number(p.amount_minor ?? 0),
        })),
      });
    }

    if (wantSection('expenses')) {
      sections.push({
        id: 'expenses',
        titleFr: 'Dépenses par poste et véhicule',
        titleAr: 'المصاريف حسب الفئة والمركبة',
        columns: [
          { key: 'expenseNumber', labelFr: 'Réf.', labelAr: 'المرجع', type: 'text' },
          { key: 'expenseDate', labelFr: 'Date', labelAr: 'التاريخ', type: 'date' },
          { key: 'category', labelFr: 'Catégorie', labelAr: 'الفئة', type: 'text' },
          { key: 'vehicleMatricule', labelFr: 'Véhicule', labelAr: 'المركبة', type: 'text' },
          { key: 'supplierName', labelFr: 'Fournisseur', labelAr: 'المورد', type: 'text' },
          { key: 'paymentMethod', labelFr: 'Paiement', labelAr: 'الدفع', type: 'text' },
          { key: 'description', labelFr: 'Libellé', labelAr: 'البيان', type: 'text' },
          { key: 'amountMinor', labelFr: 'Montant (DZD)', labelAr: 'المبلغ (دج)', type: 'currency_minor' },
        ],
        rows: expenseRows.map((e) => ({
          expenseNumber: e.expense_number,
          expenseDate: e.expense_date.slice(0, 10),
          category: e.category,
          vehicleMatricule: e.matricule ?? (lang === 'ar' ? 'عام' : 'Agence'),
          supplierName: e.supplier_name ?? '—',
          paymentMethod: e.payment_method,
          description: e.description,
          amountMinor: Number(e.amount_minor ?? 0),
        })),
        totalsRow: {
          expenseNumber: lang === 'ar' ? 'المجموع' : 'Total',
          amountMinor: totalExpensesMinor,
        },
      });
    }

    if (wantSection('deposits')) {
      const depClauses = ['1=1'];
      const depArgs: Array<string | number> = [];
      if (filter.customerId) {
        depClauses.push('rc.customer_id = ?');
        depArgs.push(filter.customerId);
      }
      if (filter.vehicleId) {
        depClauses.push('rc.vehicle_id = ?');
        depArgs.push(filter.vehicleId);
      }
      if (filter.status && ['HELD', 'PARTIALLY_DEDUCTED', 'FULLY_DEDUCTED', 'RETURNED'].includes(filter.status)) {
        depClauses.push('d.status = ?');
        depArgs.push(filter.status);
      }
      const deposits = db
        .prepare<Array<string | number>, any>(
          `SELECT d.*, rc.contract_number, c.full_name AS customer_name, v.matricule
           FROM deposits d
           JOIN rental_contracts rc ON rc.id = d.contract_id
           JOIN customers c ON c.id = rc.customer_id
           JOIN vehicles v ON v.id = rc.vehicle_id
           WHERE ${depClauses.join(' AND ')}
           ORDER BY d.id DESC`
        )
        .all(...depArgs);

      sections.push({
        id: 'deposits',
        titleFr: 'Suivi des cautions (Hors chiffre d’affaires)',
        titleAr: 'متابعة الكفالات (خارج رقم الأعمال)',
        columns: [
          { key: 'contractNumber', labelFr: 'Contrat', labelAr: 'العقد', type: 'text' },
          { key: 'customerName', labelFr: 'Client', labelAr: 'الزبون', type: 'text' },
          { key: 'vehicleMatricule', labelFr: 'Véhicule', labelAr: 'المركبة', type: 'text' },
          { key: 'status', labelFr: 'Statut', labelAr: 'الحالة', type: 'text' },
          { key: 'amountMinor', labelFr: 'Initial (DZD)', labelAr: 'المبلغ الأولي (دج)', type: 'currency_minor' },
          { key: 'deductedAmountMinor', labelFr: 'Retenu (DZD)', labelAr: 'المقتطع (دج)', type: 'currency_minor' },
          { key: 'refundedAmountMinor', labelFr: 'Restitué (DZD)', labelAr: 'المسترجع (دج)', type: 'currency_minor' },
        ],
        rows: deposits.map((d) => ({
          contractNumber: d.contract_number,
          customerName: d.customer_name,
          vehicleMatricule: d.matricule,
          status: d.status,
          amountMinor: Number(d.amount_minor ?? 0),
          deductedAmountMinor: Number(d.deducted_amount_minor ?? 0),
          refundedAmountMinor: Number(d.refunded_amount_minor ?? 0),
        })),
      });
    }

    if (wantSection('customer_balances')) {
      let accounts = listCustomerFinancialAccounts(db);
      if (filter.customerId) {
        accounts = accounts.filter((a) => a.customerId === filter.customerId);
      }
      sections.push({
        id: 'customer_balances',
        titleFr: 'Soldes financiers clients & créances échues',
        titleAr: 'أرصدة حسابات الزبائن والذمم المتأخرة',
        columns: [
          { key: 'fullName', labelFr: 'Client', labelAr: 'الزبون', type: 'text' },
          { key: 'phone', labelFr: 'Téléphone', labelAr: 'الهاتف', type: 'text' },
          { key: 'totalContractedMinor', labelFr: 'Facturé (DZD)', labelAr: 'المستحق (دج)', type: 'currency_minor' },
          { key: 'netPaidMinor', labelFr: 'Payé net (DZD)', labelAr: 'المدفوع الصافي (دج)', type: 'currency_minor' },
          { key: 'outstandingBalanceMinor', labelFr: 'Solde dû (DZD)', labelAr: 'الرصيد المتبقي (دج)', type: 'currency_minor' },
          { key: 'overdueBalanceMinor', labelFr: 'Dont échu (DZD)', labelAr: 'منها المتأخر (دج)', type: 'currency_minor' },
        ],
        rows: accounts.map((a) => ({
          fullName: a.fullName,
          phone: a.phone,
          totalContractedMinor: a.totalChargedMinor,
          netPaidMinor: a.netPaidMinor,
          outstandingBalanceMinor: a.outstandingBalanceMinor,
          overdueBalanceMinor: a.overdueDebtMinor,
        })),
      });
    }

    if (wantSection('cash_sessions')) {
      const cashSessions = db
        .prepare<[string, string], any>(
          `SELECT cs.*, uo.username AS opened_by_username, uc.username AS closed_by_username
           FROM cash_register_sessions cs
           LEFT JOIN users uo ON uo.id = cs.opened_by_user_id
           LEFT JOIN users uc ON uc.id = cs.closed_by_user_id
           WHERE substr(cs.session_date, 1, 10) >= ? AND substr(cs.session_date, 1, 10) <= ?
           ORDER BY cs.session_date DESC, cs.id DESC`
        )
        .all(dateFrom, dateTo);

      sections.push({
        id: 'cash_sessions',
        titleFr: 'Sessions de caisse & rapprochements',
        titleAr: 'جلسات الصندوق والمطابقة',
        columns: [
          { key: 'sessionDate', labelFr: 'Date', labelAr: 'التاريخ', type: 'date' },
          { key: 'status', labelFr: 'Statut', labelAr: 'الحالة', type: 'text' },
          { key: 'openingBalanceMinor', labelFr: 'Ouverture', labelAr: 'الافتتاح', type: 'currency_minor' },
          { key: 'cashReceivedMinor', labelFr: 'Recettes', labelAr: 'المداخيل', type: 'currency_minor' },
          { key: 'cashExpensesMinor', labelFr: 'Dépenses', labelAr: 'المصاريف', type: 'currency_minor' },
          { key: 'expectedClosingMinor', labelFr: 'Attendu', labelAr: 'المتوقع', type: 'currency_minor' },
          { key: 'actualClosingMinor', labelFr: 'Réel', labelAr: 'الفعلي', type: 'currency_minor' },
          { key: 'discrepancyMinor', labelFr: 'Écart', labelAr: 'الفارق', type: 'currency_minor' },
        ],
        rows: cashSessions.map((cs) => ({
          sessionDate: cs.session_date,
          status: cs.status,
          openingBalanceMinor: Number(cs.opening_balance_minor ?? 0),
          cashReceivedMinor: Number(cs.cash_received_minor ?? 0),
          cashExpensesMinor: Number(cs.cash_expenses_minor ?? 0),
          expectedClosingMinor: Number(cs.expected_closing_minor ?? 0),
          actualClosingMinor: cs.actual_closing_minor != null ? Number(cs.actual_closing_minor) : null,
          discrepancyMinor: cs.discrepancy_minor != null ? Number(cs.discrepancy_minor) : null,
        })),
      });
    }
  }

  // ==================== FLEET & CUSTOM FLEET SECTIONS ====================
  if (filter.category === 'FLEET' || filter.category === 'CUSTOM') {
    let profitability = getVehicleProfitabilityReport(db, { dateFrom, dateTo, includeArchived: false });
    if (filter.vehicleId) {
      profitability = profitability.filter((p) => p.vehicleId === filter.vehicleId);
    }

    const totalFleetCount = db
      .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM vehicles WHERE is_archived = 0')
      .get()?.c ?? 0;
    const rentedCount = db
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM vehicles WHERE is_archived = 0 AND status = 'RENTED'")
      .get()?.c ?? 0;
    const maintCount = db
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM vehicles WHERE is_archived = 0 AND status = 'MAINTENANCE'")
      .get()?.c ?? 0;

    const maintClauses = [
      'substr(mr.performed_date, 1, 10) >= ?',
      'substr(mr.performed_date, 1, 10) <= ?',
      "mr.status != 'CANCELLED'",
    ];
    const maintArgs: Array<string | number> = [dateFrom, dateTo];
    if (filter.vehicleId) {
      maintClauses.push('mr.vehicle_id = ?');
      maintArgs.push(filter.vehicleId);
    }
    const maintRows = db
      .prepare<Array<string | number>, any>(
        `SELECT mr.*, v.matricule, v.brand, v.model, mt.name_fr AS type_name_fr, mt.name_ar AS type_name_ar
         FROM maintenance_records mr
         JOIN vehicles v ON v.id = mr.vehicle_id
         JOIN maintenance_types mt ON mt.id = mr.maintenance_type_id
         WHERE ${maintClauses.join(' AND ')}
         ORDER BY mr.performed_date DESC, mr.id DESC`
      )
      .all(...maintArgs);

    const totalMaintCostMinor = maintRows.reduce((s, r) => s + Number(r.total_cost_minor ?? 0), 0);

    const invParts = db
      .prepare<[], any>('SELECT * FROM inventory_parts WHERE COALESCE(is_archived, 0) = 0 ORDER BY part_name ASC')
      .all();
    const totalStockValueMinor = invParts.reduce(
      (s, p) => s + Number(p.quantity_available ?? 0) * Number(p.unit_purchase_price_minor ?? 0),
      0
    );
    const lowStockCount = invParts.filter((p) => Number(p.quantity_available) <= Number(p.minimum_stock)).length;

    if (filter.category === 'FLEET') {
      kpis.push(
        {
          key: 'fleet_active',
          labelFr: 'Véhicules actifs / En location',
          labelAr: 'المركبات النشطة / المؤجرة',
          valueDisplay: `${totalFleetCount} (${rentedCount})`,
          numericValue: totalFleetCount,
          tone: 'neutral',
        },
        {
          key: 'fleet_maintenance',
          labelFr: 'Véhicules en maintenance',
          labelAr: 'المركبات في الصيانة',
          valueDisplay: String(maintCount),
          numericValue: maintCount,
          tone: maintCount > 0 ? 'warning' : 'positive',
        },
        {
          key: 'maint_period_cost',
          labelFr: 'Coût interventions maintenance (période)',
          labelAr: 'تكلفة الصيانة (الفترة)',
          valueDisplay: formatMoneyForDoc(totalMaintCostMinor, 'DZD', lang),
          numericValue: totalMaintCostMinor / 100,
          unit: 'DZD',
          tone: 'warning',
        },
        {
          key: 'inventory_value',
          labelFr: 'Valeur stock pièces détachées',
          labelAr: 'قيمة مخزون قطع الغيار',
          valueDisplay: formatMoneyForDoc(totalStockValueMinor, 'DZD', lang),
          numericValue: totalStockValueMinor / 100,
          unit: 'DZD',
          tone: lowStockCount > 0 ? 'warning' : 'neutral',
          noteFr: `${lowStockCount} référence(s) sous seuil`,
          noteAr: `${lowStockCount} صنف تحت الحد الأدنى`,
        }
      );
    }

    if (wantSection('fleet_utilization')) {
      sections.push({
        id: 'fleet_utilization',
        titleFr: 'Utilisation & performance opérationnelle par véhicule',
        titleAr: 'استخدام المركبات والأداء التشغيلي',
        columns: [
          { key: 'matricule', labelFr: 'Matricule', labelAr: 'الترقيم', type: 'text' },
          { key: 'vehicle', labelFr: 'Véhicule', labelAr: 'المركبة', type: 'text' },
          { key: 'contractCount', labelFr: 'Contrats', labelAr: 'العقود', type: 'number' },
          { key: 'rentedDays', labelFr: 'Jours loués', labelAr: 'أيام الكراء', type: 'number' },
          { key: 'rentalRevenueMinor', labelFr: 'Contracté (DZD)', labelAr: 'المتعاقد (دج)', type: 'currency_minor' },
          { key: 'collectedMinor', labelFr: 'Encaissé (DZD)', labelAr: 'المحصل (دج)', type: 'currency_minor' },
          { key: 'expensesMinor', labelFr: 'Dépenses directes', labelAr: 'المصاريف المباشرة', type: 'currency_minor' },
          { key: 'netProfitMinor', labelFr: 'Marge opér.', labelAr: 'الهامش التشغيلي', type: 'currency_minor' },
        ],
        rows: profitability.map((p) => ({
          matricule: p.matricule,
          vehicle: `${p.brand} ${p.model}`,
          contractCount: p.contractCount,
          rentedDays: p.rentedDays,
          rentalRevenueMinor: p.rentalRevenueMinor,
          collectedMinor: p.collectedMinor,
          expensesMinor: p.expensesMinor,
          netProfitMinor: p.netProfitMinor,
        })),
      });
    }

    if (wantSection('maintenance')) {
      sections.push({
        id: 'maintenance',
        titleFr: 'Historique et coûts de maintenance',
        titleAr: 'سجل وتكاليف الصيانة',
        columns: [
          { key: 'recordNumber', labelFr: 'N°', labelAr: 'الرقم', type: 'text' },
          { key: 'performedDate', labelFr: 'Date', labelAr: 'التاريخ', type: 'date' },
          { key: 'matricule', labelFr: 'Véhicule', labelAr: 'المركبة', type: 'text' },
          { key: 'type', labelFr: 'Type', labelAr: 'النوع', type: 'text' },
          { key: 'status', labelFr: 'Statut', labelAr: 'الحالة', type: 'text' },
          { key: 'odometerKm', labelFr: 'Kilométrage', labelAr: 'العداد', type: 'number' },
          { key: 'laborCostMinor', labelFr: 'Main d’œuvre', labelAr: 'اليد العاملة', type: 'currency_minor' },
          { key: 'partsCostMinor', labelFr: 'Pièces', labelAr: 'القطع', type: 'currency_minor' },
          { key: 'totalCostMinor', labelFr: 'Total (DZD)', labelAr: 'الإجمالي (دج)', type: 'currency_minor' },
        ],
        rows: maintRows.map((m) => ({
          recordNumber: m.record_number || `MNT-${m.id}`,
          performedDate: String(m.performed_date).slice(0, 10),
          matricule: m.matricule,
          type: lang === 'ar' ? m.type_name_ar : m.type_name_fr,
          status: m.status,
          odometerKm: Number(m.odometer_km ?? 0),
          laborCostMinor: Number(m.labor_cost_minor ?? 0),
          partsCostMinor: Number(m.parts_cost_minor ?? 0),
          totalCostMinor: Number(m.total_cost_minor ?? 0),
        })),
      });

      // Upcoming / overdue maintenance & expiring vehicle documents
      const vehiclesForDue = db
        .prepare<Array<string | number>, any>(
          `SELECT id, brand, model, matricule, current_odometer_km FROM vehicles WHERE is_archived = 0 ${filter.vehicleId ? 'AND id = ?' : ''}`
        )
        .all(...(filter.vehicleId ? [filter.vehicleId] : []));
      const dueAlerts: Array<Record<string, string | number | null>> = [];
      for (const v of vehiclesForDue) {
        const items = getVehicleMaintenanceDueSummary(db, v.id, today);
        for (const it of items) {
          if (it.alertState !== 'OK') {
            dueAlerts.push({
              matricule: v.matricule,
              item: lang === 'ar' ? it.nameAr : it.nameFr,
              alertState: it.alertState,
              remainingKm: it.remainingKm,
              remainingDays: it.remainingDays,
              nextDueDate: it.nextDueDate,
            });
          }
        }
      }
      sections.push({
        id: 'maintenance_due',
        titleFr: 'Échéances de maintenance préventive & alertes',
        titleAr: 'استحقاقات الصيانة الوقائية والتنبيهات',
        columns: [
          { key: 'matricule', labelFr: 'Véhicule', labelAr: 'المركبة', type: 'text' },
          { key: 'item', labelFr: 'Opération', labelAr: 'العملية', type: 'text' },
          { key: 'alertState', labelFr: 'État', labelAr: 'الحالة', type: 'text' },
          { key: 'remainingKm', labelFr: 'Km restants', labelAr: 'كم متبقي', type: 'number' },
          { key: 'remainingDays', labelFr: 'Jours restants', labelAr: 'أيام متبقية', type: 'number' },
          { key: 'nextDueDate', labelFr: 'Échéance', labelAr: 'تاريخ الاستحقاق', type: 'date' },
        ],
        rows: dueAlerts,
      });
    }

    if (wantSection('inventory')) {
      sections.push({
        id: 'inventory',
        titleFr: 'État du stock de pièces détachées',
        titleAr: 'وضعية مخزون قطع الغيار',
        columns: [
          { key: 'partCode', labelFr: 'Réf.', labelAr: 'الرمز', type: 'text' },
          { key: 'partName', labelFr: 'Désignation', labelAr: 'التسمية', type: 'text' },
          { key: 'category', labelFr: 'Catégorie', labelAr: 'الفئة', type: 'text' },
          { key: 'quantityAvailable', labelFr: 'Stock', labelAr: 'المتوفر', type: 'number' },
          { key: 'minimumStock', labelFr: 'Seuil min.', labelAr: 'الحد الأدنى', type: 'number' },
          { key: 'unitPurchasePriceMinor', labelFr: 'Prix unit.', labelAr: 'سعر الوحدة', type: 'currency_minor' },
          { key: 'stockValueMinor', labelFr: 'Valeur (DZD)', labelAr: 'القيمة (دج)', type: 'currency_minor' },
        ],
        rows: invParts.map((p) => ({
          partCode: p.part_code,
          partName: p.part_name,
          category: p.category,
          quantityAvailable: Number(p.quantity_available ?? 0),
          minimumStock: Number(p.minimum_stock ?? 0),
          unitPurchasePriceMinor: Number(p.unit_purchase_price_minor ?? 0),
          stockValueMinor: Number(p.quantity_available ?? 0) * Number(p.unit_purchase_price_minor ?? 0),
        })),
      });
    }
  }

  // ==================== OPERATIONAL & CUSTOM OPERATIONAL SECTIONS ====================
  if (filter.category === 'OPERATIONAL' || filter.category === 'CUSTOM') {
    const contracts = db
      .prepare<Array<string | number>, any>(
        `SELECT rc.*, c.full_name AS customer_name, v.matricule, v.brand, v.model
         FROM rental_contracts rc
         JOIN customers c ON c.id = rc.customer_id
         JOIN vehicles v ON v.id = rc.vehicle_id
         WHERE ${contractClauses.join(' AND ')}
         ORDER BY rc.start_date DESC, rc.id DESC`
      )
      .all(...contractArgs);

    const inspClauses = [
      'substr(vi.inspected_at, 1, 10) >= ?',
      'substr(vi.inspected_at, 1, 10) <= ?',
    ];
    const inspArgs: Array<string | number> = [dateFrom, dateTo];
    if (filter.vehicleId) {
      inspClauses.push('vi.vehicle_id = ?');
      inspArgs.push(filter.vehicleId);
    }
    if (filter.customerId) {
      inspClauses.push('rc.customer_id = ?');
      inspArgs.push(filter.customerId);
    }
    const inspections = db
      .prepare<Array<string | number>, any>(
        `SELECT vi.*, rc.contract_number, c.full_name AS customer_name, v.matricule
         FROM vehicle_inspections vi
         JOIN rental_contracts rc ON rc.id = vi.contract_id
         JOIN customers c ON c.id = rc.customer_id
         JOIN vehicles v ON v.id = vi.vehicle_id
         WHERE ${inspClauses.join(' AND ')}
         ORDER BY vi.inspected_at DESC, vi.id DESC`
      )
      .all(...inspArgs);

    const dmgClauses = ['1=1'];
    const dmgArgs: Array<string | number> = [];
    if (filter.vehicleId) {
      dmgClauses.push('vd.vehicle_id = ?');
      dmgArgs.push(filter.vehicleId);
    }
    const damages = db
      .prepare<Array<string | number>, any>(
        `SELECT vd.*, v.matricule, rc.contract_number
         FROM vehicle_damages vd
         JOIN vehicles v ON v.id = vd.vehicle_id
         LEFT JOIN rental_contracts rc ON rc.id = vd.contract_id
         WHERE ${dmgClauses.join(' AND ')}
         ORDER BY vd.reported_at DESC, vd.id DESC`
      )
      .all(...dmgArgs);

    const overdueContracts = contracts.filter(
      (c) => ['ACTIVE', 'EXTENDED'].includes(c.status) && String(c.expected_return_date).slice(0, 10) < today
    );

    const expiringCustomerDocs = db
      .prepare<[], any>(
        `SELECT cd.*, c.full_name, c.phone
         FROM customer_documents cd
         JOIN customers c ON c.id = cd.customer_id
         WHERE c.is_archived = 0
           AND COALESCE(cd.is_archived, 0) = 0
           AND cd.expiration_date IS NOT NULL
         ORDER BY cd.expiration_date ASC`
      )
      .all();

    const blacklistedCount = db
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM customers WHERE is_archived = 0 AND risk_status = 'BLACKLISTED'")
      .get()?.c ?? 0;

    if (filter.category === 'OPERATIONAL') {
      kpis.push(
        {
          key: 'contracts_period',
          labelFr: 'Contrats sur la période',
          labelAr: 'العقود خلال الفترة',
          valueDisplay: String(contracts.length),
          numericValue: contracts.length,
          tone: 'neutral',
        },
        {
          key: 'overdue_returns',
          labelFr: 'Retours en retard (actifs)',
          labelAr: 'الإرجاعات المتأخرة',
          valueDisplay: String(overdueContracts.length),
          numericValue: overdueContracts.length,
          tone: overdueContracts.length > 0 ? 'danger' : 'positive',
        },
        {
          key: 'inspections_period',
          labelFr: 'États des lieux effectués',
          labelAr: 'معاينات المركبات المنجزة',
          valueDisplay: String(inspections.length),
          numericValue: inspections.length,
          tone: 'neutral',
        },
        {
          key: 'open_damages',
          labelFr: 'Dommages non clôturés',
          labelAr: 'الأضرار قيد المعالجة',
          valueDisplay: String(damages.filter((d) => !['REPAIRED', 'REJECTED'].includes(d.status)).length),
          numericValue: damages.filter((d) => !['REPAIRED', 'REJECTED'].includes(d.status)).length,
          tone: 'warning',
        },
        {
          key: 'blacklisted_customers',
          labelFr: 'Clients liste noire',
          labelAr: 'الزبائن في القائمة السوداء',
          valueDisplay: String(blacklistedCount),
          numericValue: blacklistedCount,
          tone: blacklistedCount > 0 ? 'danger' : 'neutral',
        }
      );
    }

    if (wantSection('contracts')) {
      sections.push({
        id: 'contracts',
        titleFr: 'Contrats de location & prolongations',
        titleAr: 'عقود الكراء والتمديدات',
        columns: [
          { key: 'contractNumber', labelFr: 'Contrat', labelAr: 'العقد', type: 'text' },
          { key: 'status', labelFr: 'Statut', labelAr: 'الحالة', type: 'text' },
          { key: 'customerName', labelFr: 'Client', labelAr: 'الزبون', type: 'text' },
          { key: 'matricule', labelFr: 'Véhicule', labelAr: 'المركبة', type: 'text' },
          { key: 'startDate', labelFr: 'Début', labelAr: 'البداية', type: 'date' },
          { key: 'expectedReturnDate', labelFr: 'Retour prévu', labelAr: 'الإرجاع المتوقع', type: 'date' },
          { key: 'totalContractAmountMinor', labelFr: 'Total (DZD)', labelAr: 'الإجمالي (دج)', type: 'currency_minor' },
        ],
        rows: contracts.map((c) => ({
          contractNumber: c.contract_number,
          status: c.status,
          customerName: c.customer_name,
          matricule: c.matricule,
          startDate: String(c.start_date).slice(0, 10),
          expectedReturnDate: String(c.expected_return_date).slice(0, 10),
          totalContractAmountMinor: Number(c.total_contract_amount_minor ?? 0),
        })),
      });
    }

    if (wantSection('inspections_damages')) {
      sections.push({
        id: 'inspections',
        titleFr: 'États des lieux (Départ & Retour)',
        titleAr: 'محاضر المعاينة (الانطلاق والعودة)',
        columns: [
          { key: 'inspectionNumber', labelFr: 'N°', labelAr: 'الرقم', type: 'text' },
          { key: 'stage', labelFr: 'Étape', labelAr: 'المرحلة', type: 'text' },
          { key: 'contractNumber', labelFr: 'Contrat', labelAr: 'العقد', type: 'text' },
          { key: 'matricule', labelFr: 'Véhicule', labelAr: 'المركبة', type: 'text' },
          { key: 'odometerKm', labelFr: 'Compteur (km)', labelAr: 'العداد (كم)', type: 'number' },
          { key: 'fuelLevelPercent', labelFr: 'Carburant %', labelAr: 'الوقود %', type: 'percent' },
          { key: 'status', labelFr: 'Statut', labelAr: 'الحالة', type: 'text' },
          { key: 'inspectedAt', labelFr: 'Date', labelAr: 'التاريخ', type: 'date' },
        ],
        rows: inspections.map((i) => ({
          inspectionNumber: i.inspection_number,
          stage: i.stage,
          contractNumber: i.contract_number,
          matricule: i.matricule,
          odometerKm: Number(i.odometer_km ?? 0),
          fuelLevelPercent: Number(i.fuel_level_percent ?? 0),
          status: i.status,
          inspectedAt: String(i.inspected_at).slice(0, 10),
        })),
      });

      sections.push({
        id: 'damages',
        titleFr: 'Dommages signalés & suivi de réparation',
        titleAr: 'الأضرار المصرح بها ومتابعة التصليح',
        columns: [
          { key: 'matricule', labelFr: 'Véhicule', labelAr: 'المركبة', type: 'text' },
          { key: 'contractNumber', labelFr: 'Contrat', labelAr: 'العقد', type: 'text' },
          { key: 'zoneCode', labelFr: 'Zone', labelAr: 'المنطقة', type: 'text' },
          { key: 'damageType', labelFr: 'Type', labelAr: 'النوع', type: 'text' },
          { key: 'severity', labelFr: 'Gravité', labelAr: 'الخطورة', type: 'text' },
          { key: 'status', labelFr: 'Statut', labelAr: 'الحالة', type: 'text' },
          { key: 'estimatedRepairCostMinor', labelFr: 'Estimation', labelAr: 'التقدير', type: 'currency_minor' },
        ],
        rows: damages.map((d) => ({
          matricule: d.matricule,
          contractNumber: d.contract_number ?? '—',
          zoneCode: d.zone_code,
          damageType: d.damage_type,
          severity: d.severity,
          status: d.status,
          estimatedRepairCostMinor: d.estimated_repair_cost_minor != null ? Number(d.estimated_repair_cost_minor) : null,
        })),
      });
    }

    if (wantSection('customer_documents')) {
      sections.push({
        id: 'customer_documents',
        titleFr: 'Documents clients avec échéance',
        titleAr: 'وثائق الزبائن ذات تاريخ انتهاء الصلاحية',
        columns: [
          { key: 'fullName', labelFr: 'Client', labelAr: 'الزبون', type: 'text' },
          { key: 'phone', labelFr: 'Téléphone', labelAr: 'الهاتف', type: 'text' },
          { key: 'docCategory', labelFr: 'Catégorie', labelAr: 'الصنف', type: 'text' },
          { key: 'documentNumber', labelFr: 'N° pièce', labelAr: 'رقم الوثيقة', type: 'text' },
          { key: 'expirationDate', labelFr: 'Expiration', labelAr: 'الانتهاء', type: 'date' },
        ],
        rows: expiringCustomerDocs.map((d) => ({
          fullName: d.full_name,
          phone: d.phone,
          docCategory: d.doc_category,
          documentNumber: d.document_number ?? d.original_file_name,
          expirationDate: String(d.expiration_date).slice(0, 10),
        })),
      });
    }
  }

  // Optional Generated Documents section (OPERATIONAL or CUSTOM)
  if (
    (filter.category === 'OPERATIONAL' || filter.category === 'CUSTOM') &&
    wantSection('documents_archive')
  ) {
    const docClauses = [
      'substr(gd.created_at, 1, 10) >= ?',
      'substr(gd.created_at, 1, 10) <= ?',
    ];
    const docArgs: Array<string | number> = [dateFrom, dateTo];
    if (filter.documentKind) {
      docClauses.push('gd.document_kind = ?');
      docArgs.push(filter.documentKind);
    }
    if (filter.customerId) {
      docClauses.push('gd.customer_id = ?');
      docArgs.push(filter.customerId);
    }
    if (filter.vehicleId) {
      docClauses.push('gd.vehicle_id = ?');
      docArgs.push(filter.vehicleId);
    }
    if (filter.userId) {
      docClauses.push('gd.generated_by_user_id = ?');
      docArgs.push(filter.userId);
    }

    const docs = db
      .prepare<Array<string | number>, any>(
        `SELECT gd.document_number, gd.document_kind, gd.format, gd.language, gd.is_copy,
                gd.reprint_count, gd.generated_by_username, gd.created_at
         FROM generated_documents gd
         WHERE ${docClauses.join(' AND ')}
         ORDER BY gd.created_at DESC, gd.id DESC`
      )
      .all(...docArgs);

    sections.push({
      id: 'documents_archive',
      titleFr: 'Journal des documents émis & rééditions',
      titleAr: 'سجل الوثائق المصدرة والنسخ',
      columns: [
        { key: 'documentNumber', labelFr: 'N° Document', labelAr: 'رقم الوثيقة', type: 'text' },
        { key: 'documentKind', labelFr: 'Type', labelAr: 'النوع', type: 'text' },
        { key: 'format', labelFr: 'Format', labelAr: 'الصيغة', type: 'text' },
        { key: 'language', labelFr: 'Langue', labelAr: 'اللغة', type: 'text' },
        { key: 'isCopy', labelFr: 'Copie', labelAr: 'نسخة', type: 'text' },
        { key: 'generatedByUsername', labelFr: 'Émis par', labelAr: 'المصدر', type: 'text' },
        { key: 'createdAt', labelFr: 'Date', labelAr: 'التاريخ', type: 'date' },
      ],
      rows: docs.map((d) => ({
        documentNumber: d.document_number,
        documentKind: d.document_kind,
        format: d.format,
        language: d.language.toUpperCase(),
        isCopy: d.is_copy === 1 ? (lang === 'ar' ? 'نعم' : 'COPIE') : (lang === 'ar' ? 'أصلي' : 'ORIGINAL'),
        generatedByUsername: d.generated_by_username,
        createdAt: String(d.created_at).slice(0, 10),
      })),
    });
  }

  if (filter.category === 'CUSTOM' && kpis.length === 0) {
    const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
    kpis.push(
      {
        key: 'custom_sections',
        labelFr: 'Sections incluses',
        labelAr: 'الأقسام المشمولة',
        valueDisplay: String(sections.length),
        numericValue: sections.length,
        tone: 'neutral',
      },
      {
        key: 'custom_rows',
        labelFr: 'Lignes agrégées',
        labelAr: 'إجمالي السجلات',
        valueDisplay: String(totalRows),
        numericValue: totalRows,
        tone: 'neutral',
      }
    );
  }

  const titles: Record<ReportFilter['category'], { fr: string; ar: string }> = {
    FINANCIAL: { fr: 'Rapport Financier Consolidé', ar: 'التقرير المالي المجمع' },
    FLEET: { fr: 'Rapport Parc Automobile & Maintenance', ar: 'تقرير الأسطول والصيانة والمخزون' },
    OPERATIONAL: { fr: 'Rapport Opérationnel d’Agence', ar: 'التقرير التشغيلي للوكالة' },
    CUSTOM: { fr: 'Rapport Personnalisé Multi-Modules', ar: 'تقرير مخصص متعدد الوحدات' },
  };

  return {
    category: filter.category,
    reportCode: filter.reportCode || `${filter.category}_${dateFrom}_${dateTo}`,
    titleFr: titles[filter.category].fr,
    titleAr: titles[filter.category].ar,
    generatedAt: new Date().toISOString(),
    appliedFilters: filter,
    accountingDisclosuresFr: disclosuresFr,
    accountingDisclosuresAr: disclosuresAr,
    kpis,
    sections,
  };
}

export function buildReportCsv(dataset: ReportDataset, lang: AppLanguage): string {
  const isAr = lang === 'ar';
  const lines: string[] = [];
  lines.push(escapeSafeCsvCell(isAr ? dataset.titleAr : dataset.titleFr));
  lines.push(
    [
      escapeSafeCsvCell(isAr ? 'الفترة' : 'Période'),
      escapeSafeCsvCell(`${dataset.appliedFilters.dateFrom ?? ''} -> ${dataset.appliedFilters.dateTo ?? ''}`),
    ].join(',')
  );

  for (const disc of isAr ? dataset.accountingDisclosuresAr : dataset.accountingDisclosuresFr) {
    lines.push([escapeSafeCsvCell(isAr ? 'ملاحظة محاسبية' : 'Note comptable'), escapeSafeCsvCell(disc)].join(','));
  }

  if (dataset.kpis.length > 0) {
    lines.push('');
    lines.push([escapeSafeCsvCell(isAr ? 'المؤشر' : 'Indicateur'), escapeSafeCsvCell(isAr ? 'القيمة' : 'Valeur')].join(','));
    for (const k of dataset.kpis) {
      lines.push([escapeSafeCsvCell(isAr ? k.labelAr : k.labelFr), escapeSafeCsvCell(k.valueDisplay)].join(','));
    }
  }

  for (const sec of dataset.sections) {
    lines.push('');
    lines.push(escapeSafeCsvCell(isAr ? sec.titleAr : sec.titleFr));
    lines.push(sec.columns.map((c) => escapeSafeCsvCell(isAr ? c.labelAr : c.labelFr)).join(','));
    for (const row of sec.rows) {
      lines.push(
        sec.columns
          .map((c) => {
            const raw = row[c.key];
            if (c.type === 'currency_minor' && typeof raw === 'number') {
              return escapeSafeCsvCell(Number((raw / 100).toFixed(2)));
            }
            return escapeSafeCsvCell(raw as string | number | null);
          })
          .join(',')
      );
    }
  }

  return `\uFEFF${lines.join('\r\n')}`;
}

export async function buildReportXlsx(dataset: ReportDataset, lang: AppLanguage): Promise<Buffer> {
  const isAr = lang === 'ar';
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gestion Agence de Location ERP';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet(isAr ? 'الملخص والمؤشرات' : 'Synthèse & KPI', {
    views: [{ rightToLeft: isAr }],
  });
  summarySheet.columns = [
    { key: 'a', width: 42 },
    { key: 'b', width: 28 },
    { key: 'c', width: 46 },
  ];

  const titleRow = summarySheet.addRow([isAr ? dataset.titleAr : dataset.titleFr]);
  titleRow.font = { bold: true, size: 14 };
  summarySheet.addRow([
    isAr ? 'الفترة' : 'Période',
    `${dataset.appliedFilters.dateFrom ?? ''} -> ${dataset.appliedFilters.dateTo ?? ''}`,
    formatDateForDoc(dataset.generatedAt, lang, 'latin', true),
  ]);
  summarySheet.addRow([]);

  const kpiHdr = summarySheet.addRow([
    isAr ? 'المؤشر' : 'Indicateur',
    isAr ? 'القيمة' : 'Valeur',
    isAr ? 'ملاحظة' : 'Précision',
  ]);
  kpiHdr.font = { bold: true };

  for (const k of dataset.kpis) {
    const row = summarySheet.addRow([
      sanitizeSpreadsheetText(isAr ? k.labelAr : k.labelFr),
      k.unit === 'DZD' ? Number(k.numericValue.toFixed(2)) : sanitizeSpreadsheetText(k.valueDisplay),
      sanitizeSpreadsheetText((isAr ? k.noteAr : k.noteFr) ?? ''),
    ]);
    if (k.unit === 'DZD') {
      row.getCell(2).numFmt = '#,##0.00';
    }
  }

  summarySheet.addRow([]);
  const discHdr = summarySheet.addRow([isAr ? 'ضوابط وملاحظات محاسبية' : 'Disclosures & principes comptables']);
  discHdr.font = { bold: true };
  for (const d of isAr ? dataset.accountingDisclosuresAr : dataset.accountingDisclosuresFr) {
    summarySheet.addRow([sanitizeSpreadsheetText(d)]);
  }

  // One sheet per section (Excel sheet name <= 31 chars, unique)
  const usedNames = new Set<string>(['Synthèse & KPI', 'الملخص والمؤشرات']);
  dataset.sections.forEach((sec, idx) => {
    const rawName = (isAr ? sec.titleAr : sec.titleFr)
      .replace(/[\\/*?:[\]]/g, ' ')
      .trim()
      .slice(0, 26);
    let sheetName = rawName || `Section ${idx + 1}`;
    if (usedNames.has(sheetName)) {
      sheetName = `${sheetName.slice(0, 25)}_${idx + 1}`;
    }
    usedNames.add(sheetName);

    const ws = workbook.addWorksheet(sheetName, { views: [{ rightToLeft: isAr }] });
    ws.columns = sec.columns.map((c) => ({
      header: sanitizeSpreadsheetText(isAr ? c.labelAr : c.labelFr),
      key: c.key,
      width: c.type === 'text' ? 24 : 18,
    }));
    ws.getRow(1).font = { bold: true };

    for (const r of sec.rows) {
      const values = sec.columns.map((c) => {
        const raw = r[c.key];
        if (raw === null || raw === undefined) return '';
        if (c.type === 'currency_minor' && typeof raw === 'number') {
          return Number((raw / 100).toFixed(2));
        }
        if ((c.type === 'number' || c.type === 'percent') && typeof raw === 'number') {
          return raw;
        }
        return sanitizeSpreadsheetText(raw);
      });
      const added = ws.addRow(values);
      sec.columns.forEach((c, ci) => {
        if (c.type === 'currency_minor') {
          added.getCell(ci + 1).numFmt = '#,##0.00';
        }
      });
    }

    if (sec.totalsRow) {
      const totalValues = sec.columns.map((c) => {
        const raw = sec.totalsRow?.[c.key];
        if (raw === null || raw === undefined) return '';
        if (c.type === 'currency_minor' && typeof raw === 'number') {
          return Number((raw / 100).toFixed(2));
        }
        if (typeof raw === 'number') return raw;
        return sanitizeSpreadsheetText(raw);
      });
      const tr = ws.addRow(totalValues);
      tr.font = { bold: true };
      sec.columns.forEach((c, ci) => {
        if (c.type === 'currency_minor') {
          tr.getCell(ci + 1).numFmt = '#,##0.00';
        }
      });
    }
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Converts a ReportDataset into clean PDF sections for `FINANCIAL_SUMMARY` or `CUSTOM_REPORT` PDF archiving.
 */
export function reportDatasetToPdfSections(
  dataset: ReportDataset,
  lang: AppLanguage,
  numerals: 'latin' | 'arabic' = 'latin'
) {
  const isAr = lang === 'ar';
  const blocks: any[] = [];

  if (dataset.kpis.length > 0) {
    blocks.push({
      type: 'kv_grid',
      title: isAr ? 'المؤشرات الرئيسية' : 'Indicateurs clés de la période',
      columns: 2,
      items: dataset.kpis.map((k) => ({
        label: isAr ? k.labelAr : k.labelFr,
        value: applyNumeralPreference(k.valueDisplay, numerals),
        emphasize: k.tone === 'positive' || k.tone === 'danger',
      })),
    });
  }

  for (const sec of dataset.sections) {
    const mappedRows = sec.rows.slice(0, 250).map((r) => {
      const out: Record<string, string> = {};
      for (const col of sec.columns) {
        const raw = r[col.key];
        if (raw === null || raw === undefined) {
          out[col.key] = '—';
        } else if (col.type === 'currency_minor' && typeof raw === 'number') {
          out[col.key] = formatMoneyForDoc(raw, 'DZD', lang, numerals);
        } else if (col.type === 'date') {
          out[col.key] = formatDateForDoc(String(raw), lang, numerals, false);
        } else if (col.type === 'percent' && typeof raw === 'number') {
          out[col.key] = applyNumeralPreference(`${raw}%`, numerals);
        } else {
          out[col.key] = applyNumeralPreference(String(raw), numerals);
        }
      }
      return out;
    });

    blocks.push({
      type: 'table',
      title: isAr ? sec.titleAr : sec.titleFr,
      columns: sec.columns.map((c) => ({
        key: c.key,
        label: isAr ? c.labelAr : c.labelFr,
        widthWeight: c.type === 'text' ? 1.4 : 1,
        align:
          c.type === 'currency_minor' || c.type === 'number' || c.type === 'percent'
            ? isAr
              ? 'left'
              : 'right'
            : isAr
              ? 'right'
              : 'left',
      })),
      rows: mappedRows,
    });
  }

  blocks.push({
    type: 'text_block',
    title: isAr ? 'ملاحظات ومنهجية المحاسبة' : 'Notes comptables et limites d’analyse',
    muted: true,
    text: (isAr ? dataset.accountingDisclosuresAr : dataset.accountingDisclosuresFr).join('\n'),
  });

  return blocks;
}
