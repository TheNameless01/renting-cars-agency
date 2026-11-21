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

function setupKernel(): { root: string; kernel: DesktopKernel; invoke: (ch: any, payload?: any) => Promise<any> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase2-contracts-'));
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

test('Phase 2 Availability anti-overlap, Multi-tier Pricing Engine, Reservations, Contracts, and Extensions', async () => {
  const { root, kernel, invoke } = setupKernel();

  try {
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_ops', fullName: 'Admin Ops', password: 'AdminPassword2026!' },
    });
    const adminToken = boot.data.token as string;

    await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent_ops',
        fullName: 'Agent Ops',
        password: 'AgentPassword2026!',
        roleCode: 'AGENT',
      },
    });
    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_ops', password: 'AgentPassword2026!' },
    });
    const agentToken = agentLogin.data.token as string;

    // Seed Vehicle + 2 Customers (1 normal, 1 blacklisted)
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-101',
        matricule: '00555-125-16',
        brand: 'Dacia',
        model: 'Stepway',
        year: 2025,
        color: 'Gris',
        category: 'Citadine',
        fuelType: 'GPL',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 10000,
        defaultDailyRateMinor: 500000, // 5,000 DA/day
        defaultWeeklyRateMinor: 3000000, // 30,000 DA/week
        defaultMonthlyRateMinor: 11000000, // 110,000 DA/month
      },
    });
    const vehicleId = vRes.data.id as number;

    const custNormal = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: agentToken,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Amine Khelifi',
        phone: '0551000111',
        wilayaCode: '16',
        drivingLicenceNumber: 'DL-16-9901',
        drivingLicenceIssueDate: '2019-01-01',
        drivingLicenceExpirationDate: '2029-01-01',
      },
    });
    const customerId = custNormal.data.customer.id as number;

    const custBlack = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: agentToken,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Client Risqué',
        phone: '0552000222',
        wilayaCode: '31',
      },
    });
    const blacklistedId = custBlack.data.customer.id as number;
    await invoke(IPC_CHANNELS.CUSTOMERS_ADD_RISK, {
      token: adminToken,
      data: {
        customerId: blacklistedId,
        riskLevel: 'BLACKLISTED',
        reason: 'CONTRACT_VIOLATION',
        description: 'Sous-location non autorisée',
        incidentDate: '2026-10-01',
      },
    });

    // 1. Multi-tier Pricing Engine tests
    // 3 days -> Daily rate (3 * 5,000 = 15,000 DA)
    const calcDaily = await invoke(IPC_CHANNELS.PRICING_CALCULATE, {
      token: agentToken,
      data: {
        vehicleId,
        customerId,
        startDate: '2026-03-01T09:00',
        endDate: '2026-03-04T09:00',
        pricingTier: 'AUTO',
      },
    });
    assert.equal(calcDaily.ok, true);
    assert.equal(calcDaily.data.appliedTier, 'DAILY');
    assert.equal(calcDaily.data.netTotalMinor, 1500000);

    // 7 days -> Weekly tier (30,000 DA)
    const calcWeekly = await invoke(IPC_CHANNELS.PRICING_CALCULATE, {
      token: agentToken,
      data: {
        vehicleId,
        customerId,
        startDate: '2026-03-01T09:00',
        endDate: '2026-03-08T09:00',
        pricingTier: 'AUTO',
      },
    });
    assert.equal(calcWeekly.data.appliedTier, 'WEEKLY');
    assert.equal(calcWeekly.data.netTotalMinor, 3000000);

    // 30 days -> Monthly tier (110,000 DA)
    const calcMonthly = await invoke(IPC_CHANNELS.PRICING_CALCULATE, {
      token: agentToken,
      data: {
        vehicleId,
        customerId,
        startDate: '2026-03-01T09:00',
        endDate: '2026-03-31T09:00',
        pricingTier: 'AUTO',
      },
    });
    assert.equal(calcMonthly.data.appliedTier, 'MONTHLY');
    assert.equal(calcMonthly.data.netTotalMinor, 11000000);

    // Seasonal rate (July 2026 -> 8,000 DA/day)
    const season = await invoke(IPC_CHANNELS.PRICING_CREATE_SEASONAL, {
      token: adminToken,
      data: {
        name: 'Haute Saison Été',
        vehicleCategory: 'Citadine',
        startDate: '2026-07-01',
        endDate: '2026-08-31',
        dailyRateMinor: 800000,
      },
    });
    assert.equal(season.ok, true);

    const calcSeasonal = await invoke(IPC_CHANNELS.PRICING_CALCULATE, {
      token: agentToken,
      data: {
        vehicleId,
        customerId,
        startDate: '2026-07-10T09:00',
        endDate: '2026-07-13T09:00',
        pricingTier: 'AUTO',
      },
    });
    assert.equal(calcSeasonal.data.appliedTier, 'SEASONAL');
    assert.equal(calcSeasonal.data.netTotalMinor, 2400000);

    // Customer custom rate (4,500 DA/day + 10% discount)
    await invoke(IPC_CHANNELS.PRICING_UPSERT_CUSTOMER_RATE, {
      token: adminToken,
      data: {
        customerId,
        vehicleId,
        dailyRateMinor: 450000,
        defaultDiscountPercent: 10,
      },
    });
    const calcCustomer = await invoke(IPC_CHANNELS.PRICING_CALCULATE, {
      token: agentToken,
      data: {
        vehicleId,
        customerId,
        startDate: '2026-04-01T09:00',
        endDate: '2026-04-03T09:00',
        pricingTier: 'DAILY',
      },
    });
    assert.equal(calcCustomer.data.appliedTier, 'CUSTOMER_CUSTOM');
    assert.equal(calcCustomer.data.grossTotalMinor, 900000);
    assert.equal(calcCustomer.data.discountMinor, 90000);
    assert.equal(calcCustomer.data.netTotalMinor, 810000);

    // 2. Reservation & Anti-Overlap enforcement
    const res1 = await invoke(IPC_CHANNELS.RESERVATIONS_CREATE, {
      token: agentToken,
      data: {
        customerId,
        vehicleId,
        startDate: '2026-05-01T09:00',
        expectedReturnDate: '2026-05-05T18:00',
        estimatedTotalMinor: 2000000,
        status: 'CONFIRMED',
      },
    });
    assert.equal(res1.ok, true);

    // Future reservation (May 8 - May 10) to test extension conflict later
    const resFuture = await invoke(IPC_CHANNELS.RESERVATIONS_CREATE, {
      token: agentToken,
      data: {
        customerId,
        vehicleId,
        startDate: '2026-05-08T09:00',
        expectedReturnDate: '2026-05-10T18:00',
        estimatedTotalMinor: 1000000,
        status: 'CONFIRMED',
      },
    });
    assert.equal(resFuture.ok, true);

    // Overlapping reservation MUST fail
    const resOverlap = await invoke(IPC_CHANNELS.RESERVATIONS_CREATE, {
      token: agentToken,
      data: {
        customerId,
        vehicleId,
        startDate: '2026-05-03T09:00',
        expectedReturnDate: '2026-05-06T18:00',
        estimatedTotalMinor: 1500000,
        status: 'CONFIRMED',
      },
    });
    assert.equal(resOverlap.ok, false);
    assert.equal(resOverlap.error.code, 'CONFLICT');

    // 3. Agent blocked from exceeding discount cap (25% > 10%) & blocked from renting to BLACKLISTED
    const badDiscountContract = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: agentToken,
      data: {
        customerId,
        vehicleId,
        startDate: '2026-06-01T09:00',
        expectedReturnDate: '2026-06-04T09:00',
        departureOdometerKm: 10000,
        mileageMode: 'DAILY_ALLOWANCE',
        dailyMileageAllowanceKm: 300,
        extraKmRateMinor: 1500,
        currency: 'DZD',
        baseRentalTotalMinor: 1500000,
        discountMinor: 400000, // 26.7% > 10%
        depositAmountMinor: 5000000,
        depositCurrency: 'DZD',
        initialPaymentMinor: 0,
        initialPaymentMethod: 'CASH',
      },
    });
    assert.equal(badDiscountContract.ok, false);
    assert.equal(badDiscountContract.error.code, 'FORBIDDEN');

    const badBlacklistContract = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: agentToken,
      data: {
        customerId: blacklistedId,
        vehicleId,
        startDate: '2026-06-01T09:00',
        expectedReturnDate: '2026-06-04T09:00',
        departureOdometerKm: 10000,
        mileageMode: 'UNLIMITED',
        extraKmRateMinor: 0,
        currency: 'DZD',
        baseRentalTotalMinor: 1500000,
        discountMinor: 0,
        depositAmountMinor: 5000000,
        depositCurrency: 'DZD',
        initialPaymentMinor: 0,
        initialPaymentMethod: 'CASH',
        blacklistOverrideReason: 'Tentative agent',
      },
    });
    assert.equal(badBlacklistContract.ok, false);
    assert.equal(badBlacklistContract.error.code, 'FORBIDDEN');

    // 4. Convert res1 -> Contract (CONFIRMED), Activate -> ACTIVE, Extend -> EXTENDED, Complete -> COMPLETED
    const ctrRes = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: agentToken,
      data: {
        reservationId: res1.data.id,
        customerId,
        vehicleId,
        startDate: '2026-05-01T09:00',
        expectedReturnDate: '2026-05-05T18:00',
        departureOdometerKm: 10000,
        mileageMode: 'DAILY_ALLOWANCE',
        dailyMileageAllowanceKm: 200, // 5 days * 200 = 1000 km
        extraKmRateMinor: 1500, // 15 DA/km
        currency: 'DZD',
        baseRentalTotalMinor: 2000000, // 20,000 DA
        discountMinor: 100000, // 1,000 DA (5% <= 10%)
        depositAmountMinor: 5000000, // 50,000 DA separate deposit
        depositCurrency: 'DZD',
        initialPaymentMinor: 1000000, // 10,000 DA paid
        initialPaymentMethod: 'CASH',
        initialStatus: 'CONFIRMED',
      },
    });
    assert.equal(ctrRes.ok, true);
    const contractId = ctrRes.data.contract.id as number;
    assert.equal(ctrRes.data.contract.originalEndDate, '2026-05-05T18:00');
    assert.equal(ctrRes.data.contract.totalContractAmountMinor, 1900000);
    assert.equal(ctrRes.data.deposit.amountMinor, 5000000);

    // Activate contract (vehicle status becomes RENTED)
    const activated = await invoke(IPC_CHANNELS.CONTRACTS_ACTIVATE, {
      token: agentToken,
      data: { contractId },
    });
    assert.equal(activated.ok, true);
    assert.equal(activated.data.contract.status, 'ACTIVE');

    // Vehicle cannot be forced AVAILABLE while ACTIVE contract exists
    const forceAvail = await invoke(IPC_CHANNELS.VEHICLES_UPDATE, {
      token: adminToken,
      data: { id: vehicleId, status: 'AVAILABLE' },
    });
    assert.equal(forceAvail.ok, false);
    assert.equal(forceAvail.error.code, 'CONFLICT');

    // Extension overlapping resFuture (May 9) MUST BE BLOCKED
    const extConflict = await invoke(IPC_CHANNELS.CONTRACTS_EXTEND, {
      token: agentToken,
      data: {
        contractId,
        newReturnDate: '2026-05-09T18:00',
        additionalAmountMinor: 1800000,
        additionalKmAllowance: 800,
      },
    });
    assert.equal(extConflict.ok, false);
    assert.equal(extConflict.error.code, 'CONFLICT');

    // Valid extension until May 7 (before resFuture on May 8) succeeds & preserves originalEndDate!
    const extOk = await invoke(IPC_CHANNELS.CONTRACTS_EXTEND, {
      token: agentToken,
      data: {
        contractId,
        newReturnDate: '2026-05-07T18:00',
        additionalAmountMinor: 900000, // +9,000 DA
        additionalKmAllowance: 400, // total included km = 1000 + 400 = 1400 km
        notes: 'Prolongation 2 jours demandée par téléphone',
      },
    });
    assert.equal(extOk.ok, true);
    assert.equal(extOk.data.contract.status, 'EXTENDED');
    assert.equal(extOk.data.contract.originalEndDate, '2026-05-05T18:00');
    assert.equal(extOk.data.contract.expectedReturnDate, '2026-05-07T18:00');
    assert.equal(extOk.data.contract.totalContractAmountMinor, 2800000); // 19,000 + 9,000
    assert.equal(extOk.data.extensions.length, 1);

    // Complete contract with 1500 km driven (100 extra km * 15 DA = 1,500 DA = 150000 minor)
    const completed = await invoke(IPC_CHANNELS.CONTRACTS_COMPLETE, {
      token: agentToken,
      data: {
        contractId,
        actualReturnDate: '2026-05-07T17:30',
        returnOdometerKm: 11500,
        lateFeeMinor: 0,
        damageChargeMinor: 0,
        otherChargesMinor: 0,
      },
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.data.contract.status, 'COMPLETED');
    assert.equal(completed.data.contract.extraKmChargeMinor, 150000);
    assert.equal(completed.data.contract.totalContractAmountMinor, 2950000); // 28,000 + 1,500 DA

    const vehicleAfter = await invoke(IPC_CHANNELS.VEHICLES_GET, {
      token: agentToken,
      data: { id: vehicleId },
    });
    assert.equal(vehicleAfter.data.vehicle.currentOdometerKm, 11500);
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 2 Preview Express HTTP API end-to-end flow (Vehicles, Customers, Pricing, Planning, Contracts)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-preview-p2-'));
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

    // Bootstrap Admin
    const bootRes = await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'p2_admin',
        fullName: 'P2 Preview Admin',
        password: 'PreviewAdminPassword2!',
      }),
    });
    assert.equal(bootRes.status, 201);
    const token = ((await bootRes.json()) as any).data.token as string;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    // Create vehicle via HTTP
    const vRes = await fetch(`${base}${PREVIEW_ENDPOINTS.VEHICLES}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        internalCode: 'PV-01',
        matricule: '01020-125-16',
        brand: 'Hyundai',
        model: 'i10',
        year: 2025,
        color: 'Noir',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'AUTOMATIC',
        seats: 5,
        currentOdometerKm: 5000,
        defaultDailyRateMinor: 700000,
      }),
    });
    assert.equal(vRes.status, 201);
    const vehicleId = ((await vRes.json()) as any).data.id as number;

    // Create customer via HTTP
    const cRes = await fetch(`${base}${PREVIEW_ENDPOINTS.CUSTOMERS}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customerType: 'INDIVIDUAL',
        fullName: 'Samir Boudiaf',
        phone: '0550998877',
        wilayaCode: '16',
      }),
    });
    assert.equal(cRes.status, 201);
    const customerId = ((await cRes.json()) as any).data.customer.id as number;

    // Pricing calculation via HTTP
    const priceRes = await fetch(`${base}${PREVIEW_ENDPOINTS.PRICING}/calculate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        vehicleId,
        customerId,
        startDate: '2026-08-01T09:00',
        endDate: '2026-08-04T09:00',
      }),
    });
    assert.equal(priceRes.status, 200);
    assert.equal(((await priceRes.json()) as any).data.netTotalMinor, 2100000);

    // Create contract via HTTP
    const ctrRes = await fetch(`${base}${PREVIEW_ENDPOINTS.CONTRACTS}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customerId,
        vehicleId,
        startDate: '2026-08-01T09:00',
        expectedReturnDate: '2026-08-04T09:00',
        departureOdometerKm: 5000,
        mileageMode: 'UNLIMITED',
        extraKmRateMinor: 0,
        currency: 'DZD',
        baseRentalTotalMinor: 2100000,
        discountMinor: 0,
        depositAmountMinor: 5000000,
        depositCurrency: 'DZD',
        initialPaymentMinor: 1000000,
        initialPaymentMethod: 'CASH',
        initialStatus: 'ACTIVE',
      }),
    });
    assert.equal(ctrRes.status, 201);
    const contractId = ((await ctrRes.json()) as any).data.contract.id as number;

    // Planning calendar returns contract event
    const calRes = await fetch(
      `${base}${PREVIEW_ENDPOINTS.PLANNING}/calendar?startDate=2026-08-01T00:00&endDate=2026-08-10T23:59`,
      { headers }
    );
    assert.equal(calRes.status, 200);
    const calJson = (await calRes.json()) as any;
    assert.equal(calJson.data.events.some((e: any) => e.id === contractId && e.eventType === 'CONTRACT'), true);
  } finally {
    server.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
