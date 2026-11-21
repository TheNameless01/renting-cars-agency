import type Database from 'better-sqlite3';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';
import { checkVehicleAvailability, recomputeVehicleStatus } from './availabilityService.ts';
import { appendCashMovementIfOpenSession } from './cashRegisterService.ts';
import { checkCustomerEligibility } from './customerService.ts';

function generateContractNumber(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const countRow = db
    .prepare<[string], { cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM rental_contracts WHERE contract_number LIKE ?'
    )
    .get(`CTR-${year}-%`);
  const seq = (countRow?.cnt ?? 0) + 1;
  return `CTR-${year}-${String(seq).padStart(4, '0')}`;
}

function generatePaymentCodes(db: Database.Database) {
  const year = new Date().getUTCFullYear();
  const countRow = db
    .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM contract_payments')
    .get();
  const seq = (countRow?.cnt ?? 0) + 1;
  return {
    transactionCode: `TXN-${year}-${String(seq).padStart(5, '0')}`,
    receiptNumber: `REC-${year}-${String(seq).padStart(5, '0')}`,
  };
}

export function listContracts(
  db: Database.Database,
  filters?: { status?: string; search?: string }
) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.status && filters.status !== 'ALL') {
    clauses.push('rc.status = ?');
    params.push(filters.status);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push('(rc.contract_number LIKE ? OR c.full_name LIKE ? OR v.matricule LIKE ? OR v.brand LIKE ?)');
    params.push(q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare<Array<string | number>, any>(
      `SELECT rc.*,
              c.full_name AS customer_name, c.phone AS customer_phone, c.risk_status AS customer_risk_status,
              v.matricule, v.brand, v.model,
              (SELECT COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0)
               FROM contract_payments cp WHERE cp.contract_id = rc.id) AS paid_net_minor,
              (SELECT amount_minor FROM deposits d WHERE d.contract_id = rc.id) AS deposit_amount_minor,
              (SELECT status FROM deposits d WHERE d.contract_id = rc.id) AS deposit_status
       FROM rental_contracts rc
       JOIN customers c ON c.id = rc.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       ${where}
       ORDER BY rc.id DESC`
    )
    .all(...params)
    .map((r) => ({
      id: r.id,
      contractNumber: r.contract_number,
      reservationId: r.reservation_id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      customerRiskStatus: r.customer_risk_status,
      vehicleId: r.vehicle_id,
      vehicleLabel: `${r.brand} ${r.model} (${r.matricule})`,
      status: r.status,
      startDate: r.start_date,
      originalEndDate: r.original_end_date,
      expectedReturnDate: r.expected_return_date,
      actualReturnDate: r.actual_return_date,
      departureOdometerKm: r.departure_odometer_km,
      returnOdometerKm: r.return_odometer_km,
      mileageMode: r.mileage_mode,
      includedTotalKm: r.included_total_km,
      currency: r.currency,
      totalContractAmountMinor: r.total_contract_amount_minor,
      paidNetMinor: Number(r.paid_net_minor ?? 0),
      outstandingMinor: Math.max(0, Number(r.total_contract_amount_minor) - Number(r.paid_net_minor ?? 0)),
      depositAmountMinor: Number(r.deposit_amount_minor ?? 0),
      depositStatus: r.deposit_status ?? null,
      createdAt: r.created_at,
    }));
}

export function getContractDetail(db: Database.Database, contractId: number) {
  const row = db
    .prepare<[number], any>(
      `SELECT rc.*,
              c.full_name AS customer_name, c.phone AS customer_phone, c.risk_status AS customer_risk_status,
              c.customer_type,
              v.matricule, v.brand, v.model, v.year, v.current_odometer_km, v.default_daily_rate_minor
       FROM rental_contracts rc
       JOIN customers c ON c.id = rc.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       WHERE rc.id = ?`
    )
    .get(contractId);

  if (!row) throw new AuthError('NOT_FOUND', 'Contrat introuvable');

  const pricingItems = db
    .prepare<[number], any>('SELECT * FROM contract_pricing_items WHERE contract_id = ? ORDER BY id ASC')
    .all(contractId)
    .map((p) => ({
      id: p.id,
      contractId: p.contract_id,
      itemType: p.item_type,
      label: p.label,
      quantity: p.quantity,
      unitPriceMinor: p.unit_price_minor,
      totalMinor: p.total_minor,
      isAuthorizedAdjustment: p.is_authorized_adjustment === 1,
      createdAt: p.created_at,
    }));

  const extensions = db
    .prepare<[number], any>(
      `SELECT re.*, u.username AS created_by_username
       FROM rental_extensions re
       JOIN users u ON u.id = re.created_by_user_id
       WHERE re.contract_id = ?
       ORDER BY re.id ASC`
    )
    .all(contractId)
    .map((e) => ({
      id: e.id,
      contractId: e.contract_id,
      previousReturnDate: e.previous_return_date,
      newReturnDate: e.new_return_date,
      addedDays: e.added_days,
      additionalAmountMinor: e.additional_amount_minor,
      additionalKmAllowance: e.additional_km_allowance,
      notes: e.notes,
      createdByUsername: e.created_by_username,
      createdAt: e.created_at,
    }));

  const payments = db
    .prepare<[number], any>(
      `SELECT cp.*, rev.id AS reversed_by_payment_id
       FROM contract_payments cp
       LEFT JOIN contract_payments rev ON rev.reversal_of_payment_id = cp.id
       WHERE cp.contract_id = ?
       ORDER BY cp.id ASC`
    )
    .all(contractId)
    .map((p) => ({
      id: p.id,
      transactionCode: p.transaction_code,
      receiptNumber: p.receipt_number,
      direction: p.direction,
      method: p.method,
      paymentReference: p.payment_reference,
      amountMinor: p.amount_minor,
      currency: p.currency,
      paymentDate: p.payment_date,
      description: p.description,
      reversalOfPaymentId: p.reversal_of_payment_id ?? null,
      isReversed: p.reversed_by_payment_id != null,
      createdAt: p.created_at,
    }));

  const deposit = db.prepare<[number], any>('SELECT * FROM deposits WHERE contract_id = ?').get(contractId);

  const paidNetMinor = payments.reduce(
    (sum, p) => sum + (p.direction === 'INFLOW' ? p.amountMinor : -p.amountMinor),
    0
  );

  return {
    contract: {
      id: row.id,
      contractNumber: row.contract_number,
      reservationId: row.reservation_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerType: row.customer_type,
      customerRiskStatus: row.customer_risk_status,
      vehicleId: row.vehicle_id,
      vehicleLabel: `${row.brand} ${row.model} (${row.matricule})`,
      vehicleYear: row.year,
      vehicleCurrentOdometerKm: row.current_odometer_km,
      vehicleDefaultDailyRateMinor: row.default_daily_rate_minor,
      status: row.status,
      startDate: row.start_date,
      originalEndDate: row.original_end_date,
      expectedReturnDate: row.expected_return_date,
      actualReturnDate: row.actual_return_date,
      departureOdometerKm: row.departure_odometer_km,
      returnOdometerKm: row.return_odometer_km,
      odometerCorrectionReason: row.odometer_correction_reason,
      mileageMode: row.mileage_mode,
      dailyMileageAllowanceKm: row.daily_mileage_allowance_km,
      includedTotalKm: row.included_total_km,
      extraKmRateMinor: row.extra_km_rate_minor,
      currency: row.currency,
      baseRentalTotalMinor: row.base_rental_total_minor,
      discountMinor: row.discount_minor,
      extensionTotalMinor: row.extension_total_minor,
      extraKmChargeMinor: row.extra_km_charge_minor,
      lateFeeMinor: row.late_fee_minor,
      damageChargeMinor: row.damage_charge_minor,
      otherChargesMinor: row.other_charges_minor,
      totalContractAmountMinor: row.total_contract_amount_minor,
      paidNetMinor,
      outstandingMinor: Math.max(0, row.total_contract_amount_minor - paidNetMinor),
      blacklistOverrideReason: row.blacklist_override_reason,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    pricingItems,
    extensions,
    payments,
    deposit: deposit
      ? {
          id: deposit.id,
          amountMinor: deposit.amount_minor,
          currency: deposit.currency,
          status: deposit.status,
          receivedDate: deposit.received_date,
          returnedDate: deposit.returned_date,
          deductedAmountMinor: deposit.deducted_amount_minor,
          refundedAmountMinor: deposit.refunded_amount_minor,
          remainingHeldMinor: Math.max(
            0,
            Number(deposit.amount_minor) -
              Number(deposit.deducted_amount_minor ?? 0) -
              Number(deposit.refunded_amount_minor ?? 0)
          ),
          deductionReason: deposit.deduction_reason,
          hasSupportingDoc: Boolean(deposit.supporting_doc_path),
          supportingDocOriginalName: deposit.supporting_doc_original_name ?? null,
        }
      : null,
  };
}

export function createContract(
  db: Database.Database,
  actor: { id: number; username: string },
  permissions: { canOverrideBlacklist: boolean; canApproveDiscount: boolean },
  input: any
) {
  const tx = db.transaction(() => {
    const startMs = Date.parse(input.startDate);
    const endMs = Date.parse(input.expectedReturnDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      throw new AuthError('VALIDATION_ERROR', 'Date de retour prévue invalide');
    }

    // 1. Verify availability (anti-overlap across contracts, reservations, maintenance, blocks)
    const avail = checkVehicleAvailability(db, {
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.expectedReturnDate,
      excludeReservationId: input.reservationId ?? null,
    });
    if (!avail.available) {
      throw new AuthError(
        'CONFLICT',
        `Véhicule indisponible: ${avail.conflicts.map((c) => c.details).join(' ; ')}`
      );
    }

    // 2. Verify customer eligibility & blacklist override
    const eligibility = checkCustomerEligibility(db, input.customerId, input.expectedReturnDate);
    if (!eligibility.eligible) {
      throw new AuthError('VALIDATION_ERROR', eligibility.blockers.join(' ; '));
    }
    if (eligibility.requiresBlacklistOverride) {
      if (!permissions.canOverrideBlacklist) {
        throw new AuthError(
          'FORBIDDEN',
          'Client sur liste noire — autorisation Administrateur requise (customers:override_blacklist)'
        );
      }
      if (!input.blacklistOverrideReason || !input.blacklistOverrideReason.trim()) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Motif obligatoire pour autoriser la location à un client sur liste noire'
        );
      }
    }

    // 3. Enforce discount limit unless approved
    const maxAgentPctRow = db
      .prepare<[], { setting_value: string }>(
        "SELECT setting_value FROM application_settings WHERE setting_key = 'business.max_agent_discount_percent'"
      )
      .get();
    const maxAgentPct = Number(maxAgentPctRow?.setting_value ?? 10);
    const effectiveDiscountPct =
      input.baseRentalTotalMinor > 0 ? (input.discountMinor / input.baseRentalTotalMinor) * 100 : 0;

    if (effectiveDiscountPct > maxAgentPct && !permissions.canApproveDiscount) {
      throw new AuthError(
        'FORBIDDEN',
        `Remise (${effectiveDiscountPct.toFixed(1)}%) supérieure au plafond agent (${maxAgentPct}%) — approbation Administrateur requise`
      );
    }

    // 4. Verify EUR deposit rule
    if (input.depositCurrency === 'EUR') {
      const eurSetting = db
        .prepare<[], { setting_value: string }>(
          "SELECT setting_value FROM application_settings WHERE setting_key = 'business.allow_eur_deposits'"
        )
        .get();
      if (eurSetting?.setting_value !== 'true') {
        throw new AuthError('VALIDATION_ERROR', 'Les cautions en EUR ne sont pas activées dans les paramètres');
      }
    }

    const totalContractAmountMinor = Math.max(0, input.baseRentalTotalMinor - (input.discountMinor ?? 0));
    const days = Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)));
    const includedTotalKm =
      input.mileageMode === 'UNLIMITED'
        ? null
        : input.mileageMode === 'DAILY_ALLOWANCE'
          ? (input.dailyMileageAllowanceKm ?? 0) * days
          : input.includedTotalKm ?? 0;

    const contractNumber = generateContractNumber(db);
    const initialStatus = input.initialStatus ?? 'CONFIRMED';

    const insertRes = db
      .prepare(
        `INSERT INTO rental_contracts (
          contract_number, reservation_id, customer_id, vehicle_id, status,
          start_date, original_end_date, expected_return_date, departure_odometer_km,
          mileage_mode, daily_mileage_allowance_km, included_total_km, extra_km_rate_minor,
          currency, base_rental_total_minor, discount_minor, total_contract_amount_minor,
          blacklist_override_reason, blacklist_override_by_user_id, notes, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        contractNumber,
        input.reservationId ?? null,
        input.customerId,
        input.vehicleId,
        initialStatus,
        input.startDate,
        input.expectedReturnDate,
        input.expectedReturnDate,
        input.departureOdometerKm,
        input.mileageMode,
        input.dailyMileageAllowanceKm ?? null,
        includedTotalKm,
        input.extraKmRateMinor,
        input.currency,
        input.baseRentalTotalMinor,
        input.discountMinor ?? 0,
        totalContractAmountMinor,
        eligibility.requiresBlacklistOverride ? input.blacklistOverrideReason.trim() : null,
        eligibility.requiresBlacklistOverride ? actor.id : null,
        input.notes ?? null,
        actor.id
      );

    const contractId = Number(insertRes.lastInsertRowid);

    // Record transparent pricing breakdown
    db.prepare(
      `INSERT INTO contract_pricing_items (
        contract_id, item_type, label, quantity, unit_price_minor, total_minor,
        is_authorized_adjustment, authorized_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`
    ).run(
      contractId,
      input.pricingTier === 'MONTHLY'
        ? 'MONTHLY_RATE'
        : input.pricingTier === 'WEEKLY'
          ? 'WEEKLY_RATE'
          : input.pricingTier === 'CUSTOM'
            ? 'CUSTOM_RATE'
            : 'DAILY_RATE',
      input.pricingBreakdownLabel || `Location ${days} jours`,
      days,
      Math.round(input.baseRentalTotalMinor / days),
      input.baseRentalTotalMinor
    );

    if ((input.discountMinor ?? 0) > 0) {
      db.prepare(
        `INSERT INTO contract_pricing_items (
          contract_id, item_type, label, quantity, unit_price_minor, total_minor,
          is_authorized_adjustment, authorized_by_user_id
        ) VALUES (?, 'FIXED_DISCOUNT', ?, 1, ?, ?, ?, ?)`
      ).run(
        contractId,
        input.discountAuthorizationReason || 'Remise accordée sur contrat',
        -input.discountMinor,
        -input.discountMinor,
        effectiveDiscountPct > maxAgentPct ? 1 : 0,
        effectiveDiscountPct > maxAgentPct ? actor.id : null
      );
    }

    // Convert reservation if linked
    if (input.reservationId) {
      db.prepare(
        `UPDATE reservations SET status = 'CONVERTED', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(input.reservationId);
    }

    // Separate Security Deposit ledger (NEVER mixed into rental revenue)
    if (input.depositAmountMinor > 0) {
      const depCurrency = input.depositCurrency ?? 'DZD';
      const depMethod = (input as any).depositPaymentMethod ?? 'CASH';
      const depRes = db
        .prepare(
          `INSERT INTO deposits (
            contract_id, customer_id, amount_minor, currency, status, received_date, received_method, received_by_user_id
          ) VALUES (?, ?, ?, ?, 'HELD', ?, ?, ?)`
        )
        .run(
          contractId,
          input.customerId,
          input.depositAmountMinor,
          depCurrency,
          new Date().toISOString().slice(0, 10),
          depMethod,
          actor.id
        );
      const depMovRes = db
        .prepare(
          `INSERT INTO deposit_movements (deposit_id, movement_type, amount_minor, payment_method, reason, recorded_by_user_id)
           VALUES (?, 'RECEIVED', ?, ?, 'Caution reçue au contrat', ?)`
        )
        .run(Number(depRes.lastInsertRowid), input.depositAmountMinor, depMethod, actor.id);

      appendCashMovementIfOpenSession(db, {
        actorId: actor.id,
        currency: depCurrency,
        paymentMethod: depMethod,
        movementType: 'DEPOSIT_INFLOW',
        amountMinor: input.depositAmountMinor,
        depositMovementId: Number(depMovRes.lastInsertRowid),
        description: `Caution reçue (${contractNumber})`,
      });
    }

    // Initial rental payment (separate from deposit)
    if ((input.initialPaymentMinor ?? 0) > 0) {
      const codes = generatePaymentCodes(db);
      const payRes = db
        .prepare(
          `INSERT INTO contract_payments (
            transaction_code, receipt_number, contract_id, customer_id, direction, method,
            payment_reference, amount_minor, currency, payment_date, description, recorded_by_user_id
          ) VALUES (?, ?, ?, ?, 'INFLOW', ?, ?, ?, ?, ?, 'Paiement initial contrat', ?)`
        )
        .run(
          codes.transactionCode,
          codes.receiptNumber,
          contractId,
          input.customerId,
          input.initialPaymentMethod ?? 'CASH',
          input.initialPaymentReference ?? null,
          input.initialPaymentMinor,
          input.currency,
          new Date().toISOString().slice(0, 10),
          actor.id
        );

      appendCashMovementIfOpenSession(db, {
        actorId: actor.id,
        currency: input.currency,
        paymentMethod: input.initialPaymentMethod ?? 'CASH',
        movementType: 'PAYMENT_INFLOW',
        amountMinor: input.initialPaymentMinor,
        paymentId: Number(payRes.lastInsertRowid),
        description: `${codes.receiptNumber} (${contractNumber})`,
      });
    }

    recomputeVehicleStatus(db, input.vehicleId);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CONTRACT_CREATED',
      entityType: 'rental_contracts',
      entityId: contractId,
      newValue: {
        contractNumber,
        vehicleId: input.vehicleId,
        customerId: input.customerId,
        status: initialStatus,
        totalContractAmountMinor,
        depositAmountMinor: input.depositAmountMinor,
      },
      reason: eligibility.requiresBlacklistOverride ? input.blacklistOverrideReason : null,
    });

    return getContractDetail(db, contractId);
  });

  return tx();
}

export function activateContract(
  db: Database.Database,
  actor: { id: number; username: string },
  contractId: number,
  departureOdometerKm?: number
) {
  const tx = db.transaction(() => {
    const current = db.prepare<[number], any>('SELECT * FROM rental_contracts WHERE id = ?').get(contractId);
    if (!current) throw new AuthError('NOT_FOUND', 'Contrat introuvable');
    if (current.status !== 'DRAFT' && current.status !== 'CONFIRMED') {
      throw new AuthError('CONFLICT', `Impossible d’activer un contrat au statut ${current.status}`);
    }

    const avail = checkVehicleAvailability(db, {
      vehicleId: current.vehicle_id,
      startDate: current.start_date,
      endDate: current.expected_return_date,
      excludeContractId: contractId,
    });
    if (!avail.available) {
      throw new AuthError(
        'CONFLICT',
        `Activation bloquée: ${avail.conflicts.map((c) => c.details).join(' ; ')}`
      );
    }

    const odo = departureOdometerKm ?? current.departure_odometer_km;
    db.prepare(
      `UPDATE rental_contracts
       SET status = 'ACTIVE', departure_odometer_km = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(odo, contractId);

    recomputeVehicleStatus(db, current.vehicle_id);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CONTRACT_ACTIVATED',
      entityType: 'rental_contracts',
      entityId: contractId,
      previousValue: { status: current.status },
      newValue: { status: 'ACTIVE', departureOdometerKm: odo },
    });

    return getContractDetail(db, contractId);
  });

  return tx();
}

/**
 * Extends an existing ACTIVE or EXTENDED contract while strictly preserving original_end_date and audit history.
 */
export function extendContract(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    contractId: number;
    newReturnDate: string;
    additionalAmountMinor: number;
    additionalKmAllowance: number;
    notes?: string | null;
  }
) {
  const tx = db.transaction(() => {
    const current = db
      .prepare<[number], any>('SELECT * FROM rental_contracts WHERE id = ?')
      .get(input.contractId);

    if (!current) throw new AuthError('NOT_FOUND', 'Contrat introuvable');
    if (current.status !== 'ACTIVE' && current.status !== 'EXTENDED' && current.status !== 'CONFIRMED') {
      throw new AuthError(
        'CONFLICT',
        `Seul un contrat confirmé, actif ou déjà prolongé peut être prolongé (statut actuel: ${current.status})`
      );
    }

    const prevEndMs = Date.parse(current.expected_return_date);
    const nextEndMs = Date.parse(input.newReturnDate);
    if (Number.isNaN(nextEndMs) || nextEndMs <= prevEndMs) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'La nouvelle date de retour doit être strictement postérieure à la date de retour actuelle'
      );
    }

    // Check vehicle availability over the extended window [expected_return_date, newReturnDate)
    const avail = checkVehicleAvailability(db, {
      vehicleId: current.vehicle_id,
      startDate: current.expected_return_date,
      endDate: input.newReturnDate,
      excludeContractId: current.id,
    });
    if (!avail.available) {
      throw new AuthError(
        'CONFLICT',
        `Prolongation impossible — conflit sur la période demandée: ${avail.conflicts.map((c) => c.details).join(' ; ')}`
      );
    }

    const addedDays = Math.max(1, Math.ceil((nextEndMs - prevEndMs) / (24 * 60 * 60 * 1000)));

    // 1. Insert immutable extension history record
    db.prepare(
      `INSERT INTO rental_extensions (
        contract_id, previous_return_date, new_return_date, added_days,
        additional_amount_minor, additional_km_allowance, notes, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      current.id,
      current.expected_return_date,
      input.newReturnDate,
      addedDays,
      input.additionalAmountMinor,
      input.additionalKmAllowance ?? 0,
      input.notes ?? null,
      actor.id
    );

    // 2. Append transparent pricing line item
    db.prepare(
      `INSERT INTO contract_pricing_items (
        contract_id, item_type, label, quantity, unit_price_minor, total_minor
      ) VALUES (?, 'DAILY_RATE', ?, ?, ?, ?)`
    ).run(
      current.id,
      `Prolongation (${addedDays} j jusqu'au ${input.newReturnDate.slice(0, 10)})`,
      addedDays,
      Math.round(input.additionalAmountMinor / addedDays),
      input.additionalAmountMinor
    );

    // 3. Update expected_return_date & totals while NEVER touching original_end_date
    const nextExtensionTotal = Number(current.extension_total_minor) + input.additionalAmountMinor;
    const nextTotalAmount = Number(current.total_contract_amount_minor) + input.additionalAmountMinor;
    const nextIncludedKm =
      current.mileage_mode === 'UNLIMITED'
        ? null
        : Number(current.included_total_km ?? 0) + (input.additionalKmAllowance ?? 0);
    const nextStatus = current.status === 'CONFIRMED' ? 'CONFIRMED' : 'EXTENDED';

    db.prepare(
      `UPDATE rental_contracts
       SET expected_return_date = ?,
           extension_total_minor = ?,
           included_total_km = ?,
           total_contract_amount_minor = ?,
           status = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      input.newReturnDate,
      nextExtensionTotal,
      nextIncludedKm,
      nextTotalAmount,
      nextStatus,
      current.id
    );

    recomputeVehicleStatus(db, current.vehicle_id);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CONTRACT_EXTENDED',
      entityType: 'rental_contracts',
      entityId: current.id,
      previousValue: {
        expectedReturnDate: current.expected_return_date,
        totalContractAmountMinor: current.total_contract_amount_minor,
      },
      newValue: {
        newReturnDate: input.newReturnDate,
        addedDays,
        additionalAmountMinor: input.additionalAmountMinor,
        totalContractAmountMinor: nextTotalAmount,
      },
      reason: input.notes ?? null,
    });

    return getContractDetail(db, current.id);
  });

  return tx();
}

export function completeContract(
  db: Database.Database,
  actor: { id: number; username: string },
  hasOdometerOverridePerm: boolean,
  input: {
    contractId: number;
    actualReturnDate: string;
    returnOdometerKm: number;
    odometerCorrectionReason?: string | null;
    lateFeeMinor: number;
    damageChargeMinor: number;
    otherChargesMinor: number;
    notes?: string | null;
  }
) {
  const tx = db.transaction(() => {
    const current = db.prepare<[number], any>('SELECT * FROM rental_contracts WHERE id = ?').get(input.contractId);
    if (!current) throw new AuthError('NOT_FOUND', 'Contrat introuvable');
    if (current.status !== 'ACTIVE' && current.status !== 'EXTENDED') {
      throw new AuthError('CONFLICT', `Le contrat doit être actif pour être clôturé (${current.status})`);
    }

    if (input.returnOdometerKm < current.departure_odometer_km) {
      if (!hasOdometerOverridePerm || !input.odometerCorrectionReason?.trim()) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Le kilométrage retour ne peut pas être inférieur au kilométrage départ sans correction autorisée et justifiée'
        );
      }
    }

    const drivenKm = Math.max(0, input.returnOdometerKm - current.departure_odometer_km);
    let extraKmChargeMinor = 0;
    if (current.mileage_mode !== 'UNLIMITED' && current.included_total_km != null) {
      const extraKm = Math.max(0, drivenKm - Number(current.included_total_km));
      extraKmChargeMinor = extraKm * Number(current.extra_km_rate_minor);
    }

    if (extraKmChargeMinor > 0) {
      db.prepare(
        `INSERT INTO contract_pricing_items (contract_id, item_type, label, quantity, unit_price_minor, total_minor)
         VALUES (?, 'EXTRA_KM', 'Kilométrage supplémentaire', 1, ?, ?)`
      ).run(current.id, extraKmChargeMinor, extraKmChargeMinor);
    }
    if (input.lateFeeMinor > 0) {
      db.prepare(
        `INSERT INTO contract_pricing_items (contract_id, item_type, label, quantity, unit_price_minor, total_minor)
         VALUES (?, 'LATE_FEE', 'Pénalité de retard', 1, ?, ?)`
      ).run(current.id, input.lateFeeMinor, input.lateFeeMinor);
    }
    if (input.damageChargeMinor > 0) {
      db.prepare(
        `INSERT INTO contract_pricing_items (contract_id, item_type, label, quantity, unit_price_minor, total_minor)
         VALUES (?, 'DAMAGE', 'Frais de dommages', 1, ?, ?)`
      ).run(current.id, input.damageChargeMinor, input.damageChargeMinor);
    }

    const nextTotal =
      Number(current.base_rental_total_minor) -
      Number(current.discount_minor) +
      Number(current.extension_total_minor) +
      extraKmChargeMinor +
      input.lateFeeMinor +
      input.damageChargeMinor +
      input.otherChargesMinor;

    db.prepare(
      `UPDATE rental_contracts
       SET status = 'COMPLETED',
           actual_return_date = ?,
           return_odometer_km = ?,
           odometer_correction_reason = ?,
           extra_km_charge_minor = ?,
           late_fee_minor = ?,
           damage_charge_minor = ?,
           other_charges_minor = ?,
           total_contract_amount_minor = ?,
           closed_by_user_id = ?,
           notes = COALESCE(?, notes),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      input.actualReturnDate,
      input.returnOdometerKm,
      input.odometerCorrectionReason ?? null,
      extraKmChargeMinor,
      input.lateFeeMinor,
      input.damageChargeMinor,
      input.otherChargesMinor,
      nextTotal,
      actor.id,
      input.notes ?? null,
      current.id
    );

    // Update vehicle current odometer
    db.prepare(
      `UPDATE vehicles
       SET current_odometer_km = MAX(current_odometer_km, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.returnOdometerKm, current.vehicle_id);

    recomputeVehicleStatus(db, current.vehicle_id);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CONTRACT_COMPLETED',
      entityType: 'rental_contracts',
      entityId: current.id,
      newValue: {
        returnOdometerKm: input.returnOdometerKm,
        extraKmChargeMinor,
        lateFeeMinor: input.lateFeeMinor,
        totalContractAmountMinor: nextTotal,
      },
    });

    return getContractDetail(db, current.id);
  });

  return tx();
}

export function cancelContract(
  db: Database.Database,
  actor: { id: number; username: string },
  contractId: number,
  reason: string
) {
  const tx = db.transaction(() => {
    const current = db.prepare<[number], any>('SELECT * FROM rental_contracts WHERE id = ?').get(contractId);
    if (!current) throw new AuthError('NOT_FOUND', 'Contrat introuvable');
    if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
      throw new AuthError('CONFLICT', `Impossible d’annuler un contrat au statut ${current.status}`);
    }

    db.prepare(
      `UPDATE rental_contracts
       SET status = 'CANCELLED',
           notes = COALESCE(notes || ' | Annulé: ' || ?, 'Annulé: ' || ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(reason.trim(), reason.trim(), contractId);

    recomputeVehicleStatus(db, current.vehicle_id);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'CONTRACT_CANCELLED',
      entityType: 'rental_contracts',
      entityId: contractId,
      previousValue: { status: current.status },
      newValue: { status: 'CANCELLED' },
      reason: reason.trim(),
    });

    return getContractDetail(db, contractId);
  });

  return tx();
}
