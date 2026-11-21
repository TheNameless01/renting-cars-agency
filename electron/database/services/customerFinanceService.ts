import type Database from 'better-sqlite3';
import type { CurrencyCode, CustomerAdjustmentType } from '../../../shared/types/domain.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';

function generateAdjustmentCode(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const countRow = db
    .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM customer_financial_adjustments')
    .get();
  const seq = (countRow?.cnt ?? 0) + 1;
  return `ADJ-${year}-${String(seq).padStart(5, '0')}`;
}

export interface CustomerBalanceMetrics {
  totalRentals: number;
  activeContractsCount: number;
  overdueContractsCount: number;
  contractChargesMinor: number;
  debitAdjustmentsMinor: number;
  creditAndWriteOffMinor: number;
  totalChargedMinor: number;
  inflowsMinor: number;
  refundsMinor: number;
  netPaidMinor: number;
  outstandingBalanceMinor: number;
  overdueDebtMinor: number;
  heldDepositsMinor: number;
}

/**
 * Authoritative single-source customer financial balance calculation.
 * - Security deposits remain strictly separated as liabilities (heldDepositsMinor).
 * - Never allows negative outstanding balances.
 */
export function computeCustomerFinancialMetrics(
  db: Database.Database,
  customerId: number
): CustomerBalanceMetrics {
  const nowIso = new Date().toISOString();

  const contracts = db
    .prepare<[number], any>(
      `SELECT rc.id, rc.status, rc.expected_return_date, rc.total_contract_amount_minor,
              COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                        FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor,
              COALESCE((SELECT SUM(CASE WHEN cfa.adjustment_type = 'DEBIT_CHARGE' THEN cfa.amount_minor
                                        WHEN cfa.adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -cfa.amount_minor
                                        ELSE 0 END)
                        FROM customer_financial_adjustments cfa WHERE cfa.contract_id = rc.id), 0) AS contract_adj_net_minor
       FROM rental_contracts rc
       WHERE rc.customer_id = ?`
    )
    .all(customerId);

  const nonCancelled = contracts.filter((c) => c.status !== 'CANCELLED');
  const activeContractsCount = contracts.filter((c) =>
    ['CONFIRMED', 'ACTIVE', 'EXTENDED'].includes(c.status)
  ).length;

  const contractChargesMinor = nonCancelled.reduce(
    (s, c) => s + Number(c.total_contract_amount_minor ?? 0),
    0
  );

  const adjTotals = db
    .prepare<[number], { debit_minor: number; credit_minor: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor ELSE 0 END), 0) AS debit_minor,
         COALESCE(SUM(CASE WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN amount_minor ELSE 0 END), 0) AS credit_minor
       FROM customer_financial_adjustments
       WHERE customer_id = ?`
    )
    .get(customerId);

  const debitAdjustmentsMinor = Number(adjTotals?.debit_minor ?? 0);
  const creditAndWriteOffMinor = Number(adjTotals?.credit_minor ?? 0);
  const totalChargedMinor = Math.max(0, contractChargesMinor + debitAdjustmentsMinor - creditAndWriteOffMinor);

  const paymentSummary = db
    .prepare<[number], { inflows: number; refunds: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN direction = 'REFUND' THEN amount_minor ELSE 0 END), 0) AS refunds
       FROM contract_payments
       WHERE customer_id = ?`
    )
    .get(customerId);

  const inflowsMinor = Number(paymentSummary?.inflows ?? 0);
  const refundsMinor = Number(paymentSummary?.refunds ?? 0);
  const netPaidMinor = inflowsMinor - refundsMinor;
  const outstandingBalanceMinor = Math.max(0, totalChargedMinor - netPaidMinor);

  // Per-contract overdue computation + cap by overall outstanding balance
  const unallocatedAdj = db
    .prepare<[number], { net_unalloc: number }>(
      `SELECT COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor
                                WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -amount_minor
                                ELSE 0 END), 0) AS net_unalloc
       FROM customer_financial_adjustments
       WHERE customer_id = ? AND contract_id IS NULL`
    )
    .get(customerId);

  let overdueContractsCount = 0;
  let overdueRawMinor = 0;

  for (const c of nonCancelled) {
    const cAdjustedTotal = Math.max(
      0,
      Number(c.total_contract_amount_minor ?? 0) + Number(c.contract_adj_net_minor ?? 0)
    );
    const cRemaining = Math.max(0, cAdjustedTotal - Number(c.paid_net_minor ?? 0));
    const isOverdue =
      cRemaining > 0 && (c.status === 'COMPLETED' || String(c.expected_return_date) < nowIso);
    if (isOverdue) {
      overdueContractsCount += 1;
      overdueRawMinor += cRemaining;
    }
  }

  const unallocNet = Number(unallocatedAdj?.net_unalloc ?? 0);
  const overdueDebtMinor = Math.min(
    outstandingBalanceMinor,
    Math.max(0, overdueRawMinor + (unallocNet < 0 ? unallocNet : 0))
  );

  const depositSummary = db
    .prepare<[number], { held_minor: number }>(
      `SELECT COALESCE(SUM(MAX(0, amount_minor - deducted_amount_minor - refunded_amount_minor)), 0) AS held_minor
       FROM deposits
       WHERE customer_id = ?`
    )
    .get(customerId);

  return {
    totalRentals: contracts.length,
    activeContractsCount,
    overdueContractsCount,
    contractChargesMinor,
    debitAdjustmentsMinor,
    creditAndWriteOffMinor,
    totalChargedMinor,
    inflowsMinor,
    refundsMinor,
    netPaidMinor,
    outstandingBalanceMinor,
    overdueDebtMinor,
    heldDepositsMinor: Number(depositSummary?.held_minor ?? 0),
  };
}

export function listCustomerFinancialAccounts(
  db: Database.Database,
  filters?: { search?: string; onlyWithBalance?: boolean; onlyOverdue?: boolean }
) {
  const clauses: string[] = ['c.is_archived = 0'];
  const params: string[] = [];

  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push("(c.full_name LIKE ? OR c.phone LIKE ? OR COALESCE(cc.company_name, '') LIKE ?)");
    params.push(q, q, q);
  }

  const rows = db
    .prepare<string[], any>(
      `SELECT c.id, c.customer_type, c.full_name, c.phone, c.risk_status, cc.company_name
       FROM customers c
       LEFT JOIN customer_companies cc ON cc.customer_id = c.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY c.full_name ASC`
    )
    .all(...params);

  const accounts = rows.map((r) => {
    const metrics = computeCustomerFinancialMetrics(db, r.id);
    return {
      customerId: r.id as number,
      customerType: r.customer_type as 'INDIVIDUAL' | 'COMPANY',
      fullName: r.full_name as string,
      companyName: (r.company_name ?? null) as string | null,
      phone: r.phone as string,
      riskStatus: r.risk_status as string,
      ...metrics,
    };
  });

  return accounts
    .filter((a) => (!filters?.onlyWithBalance ? true : a.outstandingBalanceMinor > 0))
    .filter((a) => (!filters?.onlyOverdue ? true : a.overdueDebtMinor > 0))
    .sort((a, b) => b.overdueDebtMinor - a.overdueDebtMinor || b.outstandingBalanceMinor - a.outstandingBalanceMinor);
}

export function getCustomerFinancialLedger(db: Database.Database, customerId: number) {
  const customer = db
    .prepare<[number], any>(
      `SELECT c.*, cc.company_name
       FROM customers c
       LEFT JOIN customer_companies cc ON cc.customer_id = c.id
       WHERE c.id = ?`
    )
    .get(customerId);
  if (!customer) throw new AuthError('NOT_FOUND', 'Client introuvable');

  const metrics = computeCustomerFinancialMetrics(db, customerId);
  const nowIso = new Date().toISOString();

  const contracts = db
    .prepare<[number], any>(
      `SELECT rc.*,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label,
              COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                        FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor,
              COALESCE((SELECT SUM(CASE WHEN cfa.adjustment_type = 'DEBIT_CHARGE' THEN cfa.amount_minor
                                        WHEN cfa.adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -cfa.amount_minor
                                        ELSE 0 END)
                        FROM customer_financial_adjustments cfa WHERE cfa.contract_id = rc.id), 0) AS adj_net_minor
       FROM rental_contracts rc
       JOIN vehicles v ON v.id = rc.vehicle_id
       WHERE rc.customer_id = ?
       ORDER BY rc.start_date DESC`
    )
    .all(customerId)
    .map((c) => {
      const effectiveTotal = Math.max(0, Number(c.total_contract_amount_minor) + Number(c.adj_net_minor ?? 0));
      const paidNetMinor = Number(c.paid_net_minor ?? 0);
      const outstandingMinor = c.status === 'CANCELLED' ? 0 : Math.max(0, effectiveTotal - paidNetMinor);
      const isOverdue =
        c.status !== 'CANCELLED' &&
        outstandingMinor > 0 &&
        (c.status === 'COMPLETED' || String(c.expected_return_date) < nowIso);
      return {
        id: c.id as number,
        contractNumber: c.contract_number as string,
        vehicleLabel: c.vehicle_label as string,
        status: c.status as string,
        startDate: c.start_date as string,
        expectedReturnDate: c.expected_return_date as string,
        currency: c.currency as CurrencyCode,
        totalContractAmountMinor: Number(c.total_contract_amount_minor),
        adjustmentNetMinor: Number(c.adj_net_minor ?? 0),
        paidNetMinor,
        outstandingMinor,
        isOverdue,
      };
    });

  const payments = db
    .prepare<[number], any>(
      `SELECT cp.*, rc.contract_number, u.username AS recorded_by_username
       FROM contract_payments cp
       JOIN rental_contracts rc ON rc.id = cp.contract_id
       JOIN users u ON u.id = cp.recorded_by_user_id
       WHERE cp.customer_id = ?
       ORDER BY cp.payment_date DESC, cp.id DESC`
    )
    .all(customerId)
    .map((p) => ({
      id: p.id as number,
      transactionCode: p.transaction_code as string,
      receiptNumber: p.receipt_number as string,
      contractId: p.contract_id as number,
      contractNumber: p.contract_number as string,
      direction: p.direction as 'INFLOW' | 'REFUND',
      method: p.method as string,
      paymentReference: (p.payment_reference ?? null) as string | null,
      amountMinor: Number(p.amount_minor),
      currency: p.currency as CurrencyCode,
      paymentDate: p.payment_date as string,
      description: (p.description ?? null) as string | null,
      recordedByUsername: p.recorded_by_username as string,
    }));

  const adjustments = db
    .prepare<[number], any>(
      `SELECT cfa.*, rc.contract_number, u.username AS authorized_by_username
       FROM customer_financial_adjustments cfa
       LEFT JOIN rental_contracts rc ON rc.id = cfa.contract_id
       JOIN users u ON u.id = cfa.authorized_by_user_id
       WHERE cfa.customer_id = ?
       ORDER BY cfa.adjustment_date DESC, cfa.id DESC`
    )
    .all(customerId)
    .map((a) => ({
      id: a.id as number,
      adjustmentCode: a.adjustment_code as string,
      customerId: a.customer_id as number,
      contractId: (a.contract_id ?? null) as number | null,
      contractNumber: (a.contract_number ?? null) as string | null,
      adjustmentType: a.adjustment_type as CustomerAdjustmentType,
      amountMinor: Number(a.amount_minor),
      currency: a.currency as CurrencyCode,
      adjustmentDate: a.adjustment_date as string,
      reason: a.reason as string,
      notes: (a.notes ?? null) as string | null,
      authorizedByUsername: a.authorized_by_username as string,
      createdAt: a.created_at as string,
    }));

  const deposits = db
    .prepare<[number], any>(
      `SELECT d.*, rc.contract_number
       FROM deposits d
       JOIN rental_contracts rc ON rc.id = d.contract_id
       WHERE d.customer_id = ?
       ORDER BY d.id DESC`
    )
    .all(customerId)
    .map((d) => ({
      id: d.id as number,
      contractId: d.contract_id as number,
      contractNumber: d.contract_number as string,
      amountMinor: Number(d.amount_minor),
      deductedAmountMinor: Number(d.deducted_amount_minor),
      refundedAmountMinor: Number(d.refunded_amount_minor),
      remainingHeldMinor: Math.max(
        0,
        Number(d.amount_minor) - Number(d.deducted_amount_minor) - Number(d.refunded_amount_minor)
      ),
      currency: d.currency as CurrencyCode,
      status: d.status as string,
      receivedDate: d.received_date as string,
    }));

  return {
    customer: {
      id: customer.id as number,
      customerType: customer.customer_type as 'INDIVIDUAL' | 'COMPANY',
      fullName: customer.full_name as string,
      companyName: (customer.company_name ?? null) as string | null,
      phone: customer.phone as string,
      riskStatus: customer.risk_status as string,
    },
    metrics,
    contracts,
    payments,
    adjustments,
    deposits,
  };
}

export function createCustomerAdjustment(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    customerId: number;
    contractId?: number | null;
    adjustmentType: CustomerAdjustmentType;
    amountMinor: number;
    currency: CurrencyCode;
    adjustmentDate: string;
    reason: string;
    notes?: string | null;
  }
) {
  const tx = db.transaction(() => {
    const cust = db.prepare<[number], any>('SELECT id FROM customers WHERE id = ?').get(input.customerId);
    if (!cust) throw new AuthError('NOT_FOUND', 'Client introuvable');

    if (input.contractId) {
      const ctr = db
        .prepare<[number], any>('SELECT id, customer_id, status FROM rental_contracts WHERE id = ?')
        .get(input.contractId);
      if (!ctr) throw new AuthError('NOT_FOUND', 'Contrat introuvable');
      if (ctr.customer_id !== input.customerId) {
        throw new AuthError('VALIDATION_ERROR', 'Ce contrat appartient à un autre client');
      }
      if (ctr.status === 'CANCELLED') {
        throw new AuthError('CONFLICT', 'Impossible d’ajuster un contrat annulé');
      }
    }

    const currentMetrics = computeCustomerFinancialMetrics(db, input.customerId);
    if (
      (input.adjustmentType === 'CREDIT_NOTE' || input.adjustmentType === 'WRITE_OFF') &&
      input.amountMinor > currentMetrics.outstandingBalanceMinor
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `L’avoir / annulation de créance (${input.amountMinor / 100}) dépasse le solde dû par le client (${currentMetrics.outstandingBalanceMinor / 100})`
      );
    }

    const code = generateAdjustmentCode(db);
    const res = db
      .prepare(
        `INSERT INTO customer_financial_adjustments (
          adjustment_code, customer_id, contract_id, adjustment_type, amount_minor,
          currency, adjustment_date, reason, notes, authorized_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        code,
        input.customerId,
        input.contractId ?? null,
        input.adjustmentType,
        input.amountMinor,
        input.currency,
        input.adjustmentDate,
        input.reason.trim(),
        input.notes?.trim() || null,
        actor.id
      );

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CUSTOMER_FINANCIAL_ADJUSTMENT_CREATED',
      entityType: 'customer_financial_adjustments',
      entityId: Number(res.lastInsertRowid),
      newValue: { code, ...input },
      reason: input.reason.trim(),
    });

    return getCustomerFinancialLedger(db, input.customerId);
  });

  return tx();
}
