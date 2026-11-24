import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IPC_CHANNELS } from '../electron/ipc/contracts.ts';
import { startDesktopKernel, type DesktopKernel } from '../electron/main/appKernel.ts';
import { createPreloadBridge } from '../electron/preload/bridge.ts';
import { createPreviewExpressApp } from '../server.ts';
import { PREVIEW_ENDPOINTS } from '../shared/api/previewContracts.ts';

function setupDesktop(): {
  root: string;
  kernel: DesktopKernel;
  invoke: (ch: (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS], payload?: any) => Promise<any>;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase3-finance-'));
  const kernel = startDesktopKernel({
    productionDbPath: path.join(root, 'data', 'agency_erp.db'),
    migrationsDir: path.resolve('electron/database/migrations'),
    vaultRootDir: path.join(root, 'vault'),
  });
  const bridge = createPreloadBridge(async (channel, payload) => {
    const handler = kernel.handlers[channel];
    if (!handler) throw new Error(`Missing handler for ${channel}`);
    return handler(payload);
  });
  return { root, kernel, invoke: (ch, payload) => bridge.invoke(ch, payload) };
}

function isoDateDaysOffset(days: number): string {
  const dt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return dt.toISOString().slice(0, 10);
}

test('Phase 3 Financial Management enforces accounting rules, cash reconciliation, encrypted docs, and RBAC via Desktop IPC', async () => {
  const { root, kernel, invoke } = setupDesktop();

  try {
    // 1. Bootstrap Admin & create Agent
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_fin', fullName: 'Admin Finance', password: 'AdminPassword2026!' },
    });
    assert.equal(boot.ok, true);
    const adminToken = boot.data.token as string;

    const agentCreate = await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent_fin',
        fullName: 'Agent Caisse',
        password: 'AgentPassword2026!',
        roleCode: 'AGENT',
      },
    });
    assert.equal(agentCreate.ok, true);

    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_fin', password: 'AgentPassword2026!' },
    });
    assert.equal(agentLogin.ok, true);
    const agentToken = agentLogin.data.token as string;

    // 2. Seed vehicle (with acquisition cost for ROI) & customer
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-FIN-01',
        matricule: '00456-126-16',
        brand: 'Hyundai',
        model: 'i20',
        year: 2025,
        color: 'Gris',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 10000,
        acquisitionDate: '2025-01-15',
        acquisitionCostMinor: 250000000, // 2,500,000 DA
        defaultDailyRateMinor: 600000, // 6,000 DA / day
      },
    });
    assert.equal(vRes.ok, true);
    const vehicleId = vRes.data.id as number;

    const cRes = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: adminToken,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Karim Benali',
        phone: '0555123456',
        wilayaCode: '16',
        commune: 'Hydra',
        cniNumber: '1600998877',
        drivingLicenceNumber: 'DL-16-998877',
        drivingLicenceIssueDate: '2020-01-01',
        drivingLicenceExpirationDate: '2032-01-01',
      },
    });
    assert.equal(cRes.ok, true, JSON.stringify(cRes.error));
    const customerId = cRes.data.customer.id as number;

    // 3. Open Cash Register session (Agent has finance:cash_register)
    const initialCashCheck = await invoke(IPC_CHANNELS.FINANCE_CASH_SESSION_CURRENT, {
      token: agentToken,
    });
    assert.equal(initialCashCheck.ok, true);
    assert.equal(initialCashCheck.data.session, null);
    assert.equal(initialCashCheck.data.suggestedOpeningBalanceMinor, 0);

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Algiers',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const openCashRes = await invoke(IPC_CHANNELS.FINANCE_CASH_SESSION_OPEN, {
      token: agentToken,
      data: {
        sessionDate: today,
        openingBalanceMinor: 10_000_000, // 100,000 DA
        openingNotes: 'Fond de caisse matin',
      },
    });
    assert.equal(openCashRes.ok, true);
    const sessionId = openCashRes.data.session.id as number;
    assert.equal(openCashRes.data.session.status, 'OPEN');

    // 4. Create Active Contract: 5 days @ 6,000 DA = 30,000 DA (3,000,000 minor), Deposit = 50,000 DA (5,000,000 minor), initial CASH payment = 10,000 DA (1,000,000 minor)
    const startDt = `${today}T09:00:00`;
    const endDt = `${isoDateDaysOffset(5)}T09:00:00`;

    const contractRes = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: agentToken,
      data: {
        customerId,
        vehicleId,
        startDate: startDt,
        expectedReturnDate: endDt,
        departureOdometerKm: 10000,
        mileageMode: 'UNLIMITED',
        extraKmRateMinor: 0,
        currency: 'DZD',
        baseRentalTotalMinor: 3_000_000, // 30,000 DA
        discountMinor: 0,
        depositAmountMinor: 5_000_000, // 50,000 DA liability
        depositCurrency: 'DZD',
        initialPaymentMinor: 1_000_000, // 10,000 DA cash
        initialPaymentMethod: 'CASH',
        initialPaymentReference: null,
        initialStatus: 'ACTIVE',
      },
    });
    assert.equal(contractRes.ok, true, JSON.stringify(contractRes.error));
    const contractId = contractRes.data.contract.id as number;

    // Verify Rule: Deposit (50,000 DA) is a LIABILITY and NEVER rental revenue!
    const report1 = await invoke(IPC_CHANNELS.FINANCE_DASHBOARD_REPORTS, {
      token: adminToken,
      data: { dateFrom: isoDateDaysOffset(-7), dateTo: isoDateDaysOffset(7) },
    });
    assert.equal(report1.ok, true);
    assert.equal(report1.data.summary.rentalRevenueMinor, 3_000_000);
    assert.equal(report1.data.summary.collectedNetMinor, 1_000_000);
    assert.equal(report1.data.summary.depositsCurrentlyHeldDzdMinor, 5_000_000);

    // 5. Multiple payments per contract & no double counting of revenue
    const pay2 = await invoke(IPC_CHANNELS.FINANCE_RECORD_PAYMENT, {
      token: agentToken,
      data: {
        contractId,
        direction: 'INFLOW',
        method: 'CCP',
        paymentReference: 'CCP-994812',
        amountMinor: 1_500_000, // 15,000 DA
        currency: 'DZD',
        paymentDate: today,
        description: 'Versement partiel CCP',
      },
    });
    assert.equal(pay2.ok, true, JSON.stringify(pay2.error));
    const pay2Id = pay2.data.payment.id as number;

    // Overpayment (> remaining 5,000 DA) must fail with VALIDATION_ERROR
    const overPay = await invoke(IPC_CHANNELS.FINANCE_RECORD_PAYMENT, {
      token: agentToken,
      data: {
        contractId,
        direction: 'INFLOW',
        method: 'CASH',
        amountMinor: 600_000, // 6,000 DA > 5,000 DA
        currency: 'DZD',
        paymentDate: today,
      },
    });
    assert.equal(overPay.ok, false);
    assert.equal(overPay.error.code, 'VALIDATION_ERROR');

    // Over-refund (> net paid 25,000 DA) must fail with VALIDATION_ERROR
    const overRefund = await invoke(IPC_CHANNELS.FINANCE_RECORD_PAYMENT, {
      token: agentToken,
      data: {
        contractId,
        direction: 'REFUND',
        method: 'CASH',
        amountMinor: 3_000_000, // 30,000 DA > 25,000 DA
        currency: 'DZD',
        paymentDate: today,
      },
    });
    assert.equal(overRefund.ok, false);
    assert.equal(overRefund.error.code, 'VALIDATION_ERROR');

    // Payment receipt check
    const receiptRes = await invoke(IPC_CHANNELS.FINANCE_GET_PAYMENT_RECEIPT, {
      token: agentToken,
      data: { paymentId: pay2Id },
    });
    assert.equal(receiptRes.ok, true);
    assert.equal(receiptRes.data.payment.amountMinor, 1_500_000);
    assert.equal(receiptRes.data.contract.outstandingMinor, 500_000);

    // 6. Payment Reversal (non-destructive, audited, RBAC gated)
    const agentReverseForbidden = await invoke(IPC_CHANNELS.FINANCE_REVERSE_PAYMENT, {
      token: agentToken,
      data: { paymentId: pay2Id, reason: 'Agent ne peut pas annuler' },
    });
    assert.equal(agentReverseForbidden.ok, false);
    assert.equal(agentReverseForbidden.error.code, 'FORBIDDEN');

    const adminReverseOk = await invoke(IPC_CHANNELS.FINANCE_REVERSE_PAYMENT, {
      token: adminToken,
      data: { paymentId: pay2Id, reason: 'Erreur référence CCP' },
    });
    assert.equal(adminReverseOk.ok, true, JSON.stringify(adminReverseOk.error));
    assert.equal(adminReverseOk.data.payment.direction, 'REFUND');
    assert.equal(adminReverseOk.data.payment.amountMinor, 1_500_000);

    // Second reversal on the same payment must be rejected with CONFLICT
    const secondReverse = await invoke(IPC_CHANNELS.FINANCE_REVERSE_PAYMENT, {
      token: adminToken,
      data: { paymentId: pay2Id, reason: 'Double annulation interdite' },
    });
    assert.equal(secondReverse.ok, false);
    assert.equal(secondReverse.error.code, 'CONFLICT');

    // Re-pay 20,000 DA via BaridiMob so contract is paid in full (10,000 + 20,000 = 30,000 DA)
    const pay3 = await invoke(IPC_CHANNELS.FINANCE_RECORD_PAYMENT, {
      token: agentToken,
      data: {
        contractId,
        direction: 'INFLOW',
        method: 'BARIDIMOB',
        paymentReference: 'BM-2026-0041',
        amountMinor: 2_000_000,
        currency: 'DZD',
        paymentDate: today,
      },
    });
    assert.equal(pay3.ok, true);

    // Verify revenue was NOT inflated by multiple payments (still 3,000,000 minor)
    const reportAfterPayments = await invoke(IPC_CHANNELS.FINANCE_DASHBOARD_REPORTS, {
      token: adminToken,
      data: { dateFrom: isoDateDaysOffset(-7), dateTo: isoDateDaysOffset(7) },
    });
    assert.equal(reportAfterPayments.data.summary.rentalRevenueMinor, 3_000_000);
    assert.equal(reportAfterPayments.data.summary.collectedNetMinor, 3_000_000);
    assert.equal(reportAfterPayments.data.summary.portfolioOutstandingMinor, 0);

    // 7. Traffic Fines & Security Deposit Settlement w/ Encrypted Supporting Document
    const fineRes = await invoke(IPC_CHANNELS.FINANCE_CREATE_FINE, {
      token: adminToken,
      data: {
        contractId,
        vehicleId,
        customerId,
        fineType: 'RADAR',
        referenceNumber: 'PV-RADAR-16-882',
        incurredDate: today,
        amountMinor: 400_000, // 4,000 DA
        notes: 'Excès de vitesse rocade sud',
      },
    });
    assert.equal(fineRes.ok, true);
    const fineId = fineRes.data.id as number;
    assert.equal(fineRes.data.isPaidByCustomer, false);

    const depositsList = await invoke(IPC_CHANNELS.FINANCE_LIST_DEPOSITS, {
      token: adminToken,
      data: { customerId },
    });
    assert.equal(depositsList.ok, true);
    assert.equal(depositsList.data.length, 1);
    const depositId = depositsList.data[0].id as number;

    // Agent forbidden from settling deposit
    const agentDepositForbidden = await invoke(IPC_CHANNELS.FINANCE_SETTLE_DEPOSIT, {
      token: agentToken,
      data: {
        depositId,
        deductedAmountMinor: 400_000,
        refundedAmountMinor: 4_600_000,
        chargeCategory: 'TRAFFIC_FINE',
        deductionReason: 'Tentative agent',
        refundMethod: 'CASH',
      },
    });
    assert.equal(agentDepositForbidden.ok, false);
    assert.equal(agentDepositForbidden.error.code, 'FORBIDDEN');

    const proofSample = Buffer.from('%PDF-1.4\nPV Radar scan simulation PDF content 2026', 'utf8').toString('base64');
    const settleRes = await invoke(IPC_CHANNELS.FINANCE_SETTLE_DEPOSIT, {
      token: adminToken,
      data: {
        depositId,
        deductedAmountMinor: 400_000, // 4,000 DA deducted
        refundedAmountMinor: 4_600_000, // 46,000 DA refunded in cash
        chargeCategory: 'TRAFFIC_FINE',
        deductionReason: 'Retenue amende radar PV-RADAR-16-882',
        refundMethod: 'CASH',
        trafficFineId: fineId,
        supportingDoc: {
          originalFileName: 'pv-radar-882.pdf',
          mimeType: 'application/pdf',
          base64Data: proofSample,
        },
      },
    });
    assert.equal(settleRes.ok, true, JSON.stringify(settleRes.error));
    assert.equal(settleRes.data.deposit.status, 'PARTIALLY_DEDUCTED');
    assert.equal(settleRes.data.deposit.deductedAmountMinor, 400_000);
    assert.equal(settleRes.data.deposit.refundedAmountMinor, 4_600_000);
    assert.equal(settleRes.data.deposit.remainingHeldMinor, 0);
    assert.equal(settleRes.data.deposit.hasSupportingDoc, true);

    // Fine should now be marked paid by customer
    const finesAfterSettle = await invoke(IPC_CHANNELS.FINANCE_LIST_FINES, {
      token: adminToken,
      data: { contractId },
    });
    assert.equal(finesAfterSettle.data[0].isPaidByCustomer, true);

    // Encrypted supporting doc decrypts identically
    const readDepDoc = await invoke(IPC_CHANNELS.FINANCE_READ_DEPOSIT_DOC, {
      token: adminToken,
      data: { depositId },
    });
    assert.equal(readDepDoc.ok, true);
    assert.equal(readDepDoc.data.base64Data, proofSample);
    assert.equal(readDepDoc.data.originalFileName, 'pv-radar-882.pdf');

    // 8. Suppliers & Expenses (Vehicle & Agency) + Encrypted Receipt + Reversal
    const supRes = await invoke(IPC_CHANNELS.FINANCE_CREATE_SUPPLIER, {
      token: adminToken,
      data: {
        name: 'Garage El-Bahdja',
        phone: '0550112233',
        specialty: 'Mécanique & Vidange',
        nifNumber: '001616009911223',
      },
    });
    assert.equal(supRes.ok, true);
    const supplierId = supRes.data.id as number;

    const receiptBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('Facture vidange 6000 DA', 'utf8'),
    ]).toString('base64');
    const expVehicleRes = await invoke(IPC_CHANNELS.FINANCE_RECORD_EXPENSE, {
      token: adminToken,
      data: {
        category: 'MAINTENANCE',
        vehicleId,
        supplierId,
        amountMinor: 600_000, // 6,000 DA cash
        currency: 'DZD',
        expenseDate: today,
        paymentMethod: 'CASH',
        description: 'Vidange complète + filtre à huile',
        receiptDoc: {
          originalFileName: 'facture-vidange.png',
          mimeType: 'image/png',
          base64Data: receiptBytes,
        },
      },
    });
    assert.equal(expVehicleRes.ok, true, JSON.stringify(expVehicleRes.error));
    const expVehicleId = expVehicleRes.data.id as number;
    assert.equal(expVehicleRes.data.hasReceiptDoc, true);

    // Decrypt receipt
    const readExpDoc = await invoke(IPC_CHANNELS.FINANCE_READ_EXPENSE_DOC, {
      token: adminToken,
      data: { expenseId: expVehicleId },
    });
    assert.equal(readExpDoc.ok, true);
    assert.equal(readExpDoc.data.base64Data, receiptBytes);

    // Record general agency expense via Bank Transfer (does not affect cash drawer)
    const expAgencyRes = await invoke(IPC_CHANNELS.FINANCE_RECORD_EXPENSE, {
      token: adminToken,
      data: {
        category: 'ADMINISTRATIVE',
        vehicleId: null,
        amountMinor: 1_200_000, // 12,000 DA
        currency: 'DZD',
        expenseDate: today,
        paymentMethod: 'BANK_TRANSFER',
        paymentReference: 'VIR-BNA-771',
        description: 'Frais comptabilité & internet',
      },
    });
    assert.equal(expAgencyRes.ok, true);

    // Record erroneous expense then reverse it
    const expWrong = await invoke(IPC_CHANNELS.FINANCE_RECORD_EXPENSE, {
      token: adminToken,
      data: {
        category: 'OTHER',
        vehicleId,
        amountMinor: 250_000,
        currency: 'DZD',
        expenseDate: today,
        paymentMethod: 'BANK_TRANSFER',
        description: 'Saisie en double',
      },
    });
    assert.equal(expWrong.ok, true);

    const revExpRes = await invoke(IPC_CHANNELS.FINANCE_REVERSE_EXPENSE, {
      token: adminToken,
      data: { expenseId: expWrong.data.id, reason: 'Doublon confirmé' },
    });
    assert.equal(revExpRes.ok, true);
    assert.equal(revExpRes.data.status, 'REVERSED');

    // Negative cash drawer prevention check
    const tooLargeCashExpense = await invoke(IPC_CHANNELS.FINANCE_RECORD_EXPENSE, {
      token: adminToken,
      data: {
        category: 'OTHER',
        amountMinor: 50_000_000, // 500,000 DA > cash drawer balance
        currency: 'DZD',
        expenseDate: today,
        paymentMethod: 'CASH',
        description: 'Dépense excessive impossible',
      },
    });
    assert.equal(tooLargeCashExpense.ok, false);
    assert.equal(tooLargeCashExpense.error.code, 'VALIDATION_ERROR');

    // 9. Cash Register Adjustment, Reconciliation, Immutability & Carry-Forward
    const adjCashRes = await invoke(IPC_CHANNELS.FINANCE_CASH_RECORD_ADJUSTMENT, {
      token: adminToken,
      data: {
        sessionId,
        amountDeltaMinor: 200_000, // +2,000 DA
        reason: 'Appoint monnaie ajouté par gérant',
      },
    });
    assert.equal(adjCashRes.ok, true);

    // Expected drawer balance:
    // Opening: 10,000,000
    // + Cash contract inflow: 1,000,000
    // + Cash deposit inflow: 5,000,000
    // - Cash deposit refund: 4,600,000
    // - Cash vehicle expense: 600,000
    // + Cash adjustment: 200,000
    // = 11,000,000 minor (110,000 DA)
    const currentCash = await invoke(IPC_CHANNELS.FINANCE_CASH_SESSION_CURRENT, {
      token: adminToken,
    });
    assert.equal(currentCash.ok, true);
    assert.equal(currentCash.data.session.expectedClosingMinor, 11_000_000);

    // Close with actual counted cash 10,950,000 (-50,000 = -500 DA discrepancy)
    const closeCash = await invoke(IPC_CHANNELS.FINANCE_CASH_SESSION_CLOSE, {
      token: agentToken,
      data: {
        sessionId,
        actualClosingMinor: 10_950_000,
        discrepancyNotes: 'Écart caisse mineur -500 DA',
      },
    });
    assert.equal(closeCash.ok, true);
    assert.equal(closeCash.data.session.status, 'CLOSED');
    assert.equal(closeCash.data.session.discrepancyMinor, -50_000);

    // Closed session must be immutable
    const closedAdjust = await invoke(IPC_CHANNELS.FINANCE_CASH_RECORD_ADJUSTMENT, {
      token: adminToken,
      data: { sessionId, amountDeltaMinor: 10_000, reason: 'Tentative sur session fermée' },
    });
    assert.equal(closedAdjust.ok, false);
    assert.equal(closedAdjust.error.code, 'CONFLICT');

    const closedReclose = await invoke(IPC_CHANNELS.FINANCE_CASH_SESSION_CLOSE, {
      token: adminToken,
      data: { sessionId, actualClosingMinor: 10_950_000 },
    });
    assert.equal(closedReclose.ok, false);
    assert.equal(closedReclose.error.code, 'CONFLICT');

    // Suggested carry-forward matches actualClosingMinor
    const afterCloseCurrent = await invoke(IPC_CHANNELS.FINANCE_CASH_SESSION_CURRENT, {
      token: adminToken,
    });
    assert.equal(afterCloseCurrent.data.session, null);
    assert.equal(afterCloseCurrent.data.suggestedOpeningBalanceMinor, 10_950_000);

    // 10. Customer Financial Accounts & Ledger Adjustments (second vehicle/contract scenario)
    const v2Res = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-FIN-02',
        matricule: '00999-126-16',
        brand: 'Dacia',
        model: 'Sandero',
        year: 2025,
        color: 'Noir',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 5000,
        defaultDailyRateMinor: 500_000, // 5,000 DA / day
      },
    });
    assert.equal(v2Res.ok, true);
    const vehicle2Id = v2Res.data.id as number;

    const c2Res = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: adminToken,
      data: {
        customerId,
        vehicleId: vehicle2Id,
        startDate: startDt,
        expectedReturnDate: `${isoDateDaysOffset(2)}T09:00:00`,
        departureOdometerKm: 5000,
        mileageMode: 'UNLIMITED',
        extraKmRateMinor: 0,
        currency: 'DZD',
        baseRentalTotalMinor: 1_000_000, // 10,000 DA unpaid
        discountMinor: 0,
        depositAmountMinor: 2_000_000, // 20,000 DA deposit still HELD (bank transfer / held)
        depositCurrency: 'DZD',
        initialPaymentMinor: 0,
        initialPaymentMethod: 'CASH',
        initialStatus: 'CONFIRMED',
      },
    });
    assert.equal(c2Res.ok, true);
    const contract2Id = c2Res.data.contract.id as number;

    // Debit charge +2,000 DA -> balance becomes 12,000 DA
    const debitRes = await invoke(IPC_CHANNELS.FINANCE_CREATE_CUSTOMER_ADJUSTMENT, {
      token: adminToken,
      data: {
        customerId,
        contractId: contract2Id,
        adjustmentType: 'DEBIT_CHARGE',
        amountMinor: 200_000,
        currency: 'DZD',
        adjustmentDate: today,
        reason: 'Nettoyage approfondi supplémentaire',
      },
    });
    assert.equal(debitRes.ok, true);

    // Credit note -3,000 DA -> balance becomes 9,000 DA
    const creditRes = await invoke(IPC_CHANNELS.FINANCE_CREATE_CUSTOMER_ADJUSTMENT, {
      token: adminToken,
      data: {
        customerId,
        contractId: contract2Id,
        adjustmentType: 'CREDIT_NOTE',
        amountMinor: 300_000,
        currency: 'DZD',
        adjustmentDate: today,
        reason: 'Geste commercial fidélité',
      },
    });
    assert.equal(creditRes.ok, true);

    // Over-credit (> 9,000 DA outstanding) must fail
    const overCredit = await invoke(IPC_CHANNELS.FINANCE_CREATE_CUSTOMER_ADJUSTMENT, {
      token: adminToken,
      data: {
        customerId,
        contractId: contract2Id,
        adjustmentType: 'CREDIT_NOTE',
        amountMinor: 1_500_000,
        currency: 'DZD',
        adjustmentDate: today,
        reason: 'Trop perçu interdit',
      },
    });
    assert.equal(overCredit.ok, false);
    assert.equal(overCredit.error.code, 'VALIDATION_ERROR');

    const ledgerRes = await invoke(IPC_CHANNELS.FINANCE_CUSTOMER_LEDGER, {
      token: adminToken,
      data: { customerId },
    });
    assert.equal(ledgerRes.ok, true);
    assert.equal(ledgerRes.data.metrics.outstandingBalanceMinor, 900_000); // 9,000 DA
    assert.equal(ledgerRes.data.metrics.heldDepositsMinor, 2_000_000); // 20,000 DA held on contract2

    // 11. Financial Dashboard, Vehicle Finance Summary & UTF-8 BOM CSV Export
    const finalReport = await invoke(IPC_CHANNELS.FINANCE_DASHBOARD_REPORTS, {
      token: adminToken,
      data: { dateFrom: isoDateDaysOffset(-7), dateTo: isoDateDaysOffset(7) },
    });
    assert.equal(finalReport.ok, true);
    // Revenue: contract1 (3,000,000) + contract2 (1,000,000) + debit (200,000) - credit note (300,000) = 3,900,000
    assert.equal(finalReport.data.summary.rentalRevenueMinor, 3_900_000);
    // Collected net: 3,000,000
    assert.equal(finalReport.data.summary.collectedNetMinor, 3_000_000);
    // Active non-reversed expenses: 600,000 (vehicle1) + 1,200,000 (agency) = 1,800,000
    assert.equal(finalReport.data.summary.expensesMinor, 1_800_000);
    // Deposits currently held: 0 (contract1 settled) + 2,000,000 (contract2) = 2,000,000
    assert.equal(finalReport.data.summary.depositsCurrentlyHeldDzdMinor, 2_000_000);
    // Outstanding: 900,000
    assert.equal(finalReport.data.summary.portfolioOutstandingMinor, 900_000);

    const v1Summary = await invoke(IPC_CHANNELS.FINANCE_VEHICLE_SUMMARY, {
      token: adminToken,
      data: { vehicleId },
    });
    assert.equal(v1Summary.ok, true);
    assert.equal(v1Summary.data.profitability.rentalRevenueMinor, 3_000_000);
    assert.equal(v1Summary.data.profitability.expensesMinor, 600_000);
    assert.equal(v1Summary.data.profitability.netProfitMinor, 2_400_000);
    assert.equal(v1Summary.data.totalFinesMinor, 400_000);
    assert.equal(v1Summary.data.unpaidFinesMinor, 0);
    assert.ok(v1Summary.data.profitability.roiPercent !== null);

    // Agent forbidden from reports and CSV export
    const agentReportForbidden = await invoke(IPC_CHANNELS.FINANCE_DASHBOARD_REPORTS, {
      token: agentToken,
      data: { dateFrom: isoDateDaysOffset(-7), dateTo: isoDateDaysOffset(7) },
    });
    assert.equal(agentReportForbidden.ok, false);
    assert.equal(agentReportForbidden.error.code, 'FORBIDDEN');

    const csvRes = await invoke(IPC_CHANNELS.FINANCE_EXPORT_CSV, {
      token: adminToken,
      data: { dateFrom: isoDateDaysOffset(-7), dateTo: isoDateDaysOffset(7), lang: 'fr' },
    });
    assert.equal(csvRes.ok, true);
    assert.equal(csvRes.data.csvContent.startsWith('\uFEFF'), true);
    assert.match(csvRes.data.csvContent, /00456-126-16/);
    assert.match(csvRes.data.csvContent, /Hyundai i20/);
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 3 Isolated Preview Express HTTP endpoints enforce auth, RBAC, and CSV export', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase3-preview-'));
  const dbPath = path.join(tempDir, 'preview.sqlite');
  const { app, db } = createPreviewExpressApp(dbPath);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      if (server.listening) resolve();
      else server.once('listening', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    // Unauthenticated call fails 401
    const unauthReports = await fetch(`${base}${PREVIEW_ENDPOINTS.REPORTS}/dashboard`);
    assert.equal(unauthReports.status, 401);

    // Bootstrap Admin + Agent
    const bootRes = await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'prev_admin_p3',
        fullName: 'Preview Admin P3',
        password: 'PreviewAdminPassword3!',
      }),
    });
    assert.equal(bootRes.status, 201);
    const adminToken = ((await bootRes.json()) as any).data.token as string;

    const createAgent = await fetch(`${base}${PREVIEW_ENDPOINTS.USERS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        username: 'prev_agent_p3',
        fullName: 'Preview Agent P3',
        password: 'PreviewAgentPassword3!',
        roleCode: 'AGENT',
      }),
    });
    assert.equal(createAgent.status, 201);

    const agentLogin = await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_LOGIN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'prev_agent_p3',
        password: 'PreviewAgentPassword3!',
      }),
    });
    const agentToken = ((await agentLogin.json()) as any).data.token as string;

    // Agent can open cash register session via HTTP
    const openCashHttp = await fetch(`${base}${PREVIEW_ENDPOINTS.FINANCE}/cash-register/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ openingBalanceMinor: 5_000_000 }),
    });
    assert.equal(openCashHttp.status, 201);

    // Agent is blocked (403) from reports & expenses
    const agentReportRes = await fetch(`${base}${PREVIEW_ENDPOINTS.REPORTS}/dashboard`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert.equal(agentReportRes.status, 403);

    const agentExpensesRes = await fetch(`${base}${PREVIEW_ENDPOINTS.FINANCE}/expenses`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert.equal(agentExpensesRes.status, 403);

    // Admin retrieves dashboard reports & UTF-8 BOM CSV
    const adminReportRes = await fetch(`${base}${PREVIEW_ENDPOINTS.REPORTS}/dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminReportRes.status, 200);
    const adminReportJson = (await adminReportRes.json()) as any;
    assert.equal(adminReportJson.ok, true);
    assert.equal(adminReportJson.data.summary.openCashSessionBalanceMinor, 5_000_000);

    const csvHttpRes = await fetch(`${base}${PREVIEW_ENDPOINTS.REPORTS}/export-csv?lang=ar`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(csvHttpRes.status, 200);
    const csvJson = (await csvHttpRes.json()) as any;
    assert.equal(csvJson.data.csvContent.startsWith('\uFEFF'), true);
  } finally {
    server.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
