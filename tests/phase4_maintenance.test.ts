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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase4-maintenance-'));
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

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('Phase 4 Step 2 Maintenance lifecycle: blocking, auto next-due, encrypted invoice, single Finance expense posting, and operational alerts auto-resolution via Desktop IPC', async () => {
  const { root, kernel, invoke } = setupDesktop();

  try {
    // 1. Bootstrap Admin & create Agent
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_maint', fullName: 'Admin Atelier', password: 'AdminPassword2026!' },
    });
    assert.equal(boot.ok, true);
    const adminToken = boot.data.token as string;

    const agentCreate = await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent_maint',
        fullName: 'Agent Atelier',
        password: 'AgentPassword2026!',
        roleCode: 'AGENT',
      },
    });
    assert.equal(agentCreate.ok, true);
    const agentUserId = agentCreate.data.id as number;

    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_maint', password: 'AgentPassword2026!' },
    });
    assert.equal(agentLogin.ok, true);
    const agentToken = agentLogin.data.token as string;

    // 2. Seed vehicle, expiring assurance doc, and eligible customer
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-MNT-01',
        matricule: '01234-126-16',
        brand: 'Renault',
        model: 'Symbol',
        year: 2025,
        color: 'Blanc',
        category: 'Berline',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 45000,
        defaultDailyRateMinor: 600000,
      },
    });
    assert.equal(vRes.ok, true);
    const vehicleId = vRes.data.id as number;

    const soonDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const docRes = await invoke(IPC_CHANNELS.VEHICLES_UPSERT_DOC, {
      token: adminToken,
      data: {
        vehicleId,
        docType: 'ASSURANCE',
        documentNumber: 'ASS-2026-01',
        issueDate: '2025-05-01',
        expirationDate: soonDate,
        reminderDays: 30,
      },
    });
    assert.equal(docRes.ok, true);
    const docId = docRes.data.id as number;

    const cRes = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: adminToken,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Karim Mansouri',
        phone: '0550112233',
        wilayaCode: '16',
        commune: 'Hydra',
        cniNumber: '1600998877',
        drivingLicenceNumber: 'DL-16-889900',
        drivingLicenceIssueDate: '2018-03-01',
        drivingLicenceExpirationDate: '2031-03-01',
      },
    });
    assert.equal(cRes.ok, true);
    const customerId = cRes.data.customer.id as number;

    // 3. List types & verify seeded 2026 types
    const typesRes = await invoke(IPC_CHANNELS.MAINTENANCE_TYPES_LIST, {
      token: agentToken,
      data: { includeInactive: false },
    });
    assert.equal(typesRes.ok, true);
    assert.ok(typesRes.data.length >= 12);
    const vidangeType = typesRes.data.find((t: any) => t.code === 'VIDANGE');
    assert.ok(vidangeType);

    // 4. Create IN_PROGRESS maintenance with blockVehicle: true
    const startDt = new Date(Date.now() - 3600_000).toISOString().slice(0, 16);
    const endDt = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 16);
    const performedToday = new Date().toISOString().slice(0, 10);

    const createMaint = await invoke(IPC_CHANNELS.MAINTENANCE_CREATE, {
      token: agentToken,
      data: {
        vehicleId,
        maintenanceTypeId: vidangeType.id,
        status: 'IN_PROGRESS',
        isEmergency: false,
        workDescription: 'Vidange complète + filtre à huile',
        performedDate: performedToday,
        scheduledStartDate: startDt,
        scheduledEndDate: endDt,
        odometerKm: 45000,
        laborCostMinor: 250000,
        partsCostMinor: 450000,
        technicianName: 'Atelier Alger',
        blockVehicle: true,
        recordInFinance: false,
      },
    });
    assert.equal(createMaint.ok, true);
    const maintId = createMaint.data.record.id as number;
    assert.equal(createMaint.data.record.status, 'IN_PROGRESS');
    assert.equal(createMaint.data.record.blockIsActive, true);
    assert.equal(createMaint.data.record.totalCostMinor, 700000);

    // Check vehicle status transitioned to MAINTENANCE
    const vMid = await invoke(IPC_CHANNELS.VEHICLES_GET, {
      token: adminToken,
      data: { id: vehicleId },
    });
    assert.equal(vMid.ok, true);
    assert.equal(vMid.data.vehicle.status, 'MAINTENANCE');

    // Attempt to contract during maintenance block -> must fail with overlap/conflict
    const contractConflict = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: adminToken,
      data: {
        customerId,
        vehicleId,
        startDate: new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
        expectedReturnDate: new Date(Date.now() + 86400_000).toISOString().slice(0, 16),
        departureOdometerKm: 45000,
        mileageMode: 'UNLIMITED',
        extraKmRateMinor: 0,
        currency: 'DZD',
        baseRentalTotalMinor: 600000,
        discountMinor: 0,
        depositAmountMinor: 2000000,
        depositCurrency: 'DZD',
        initialPaymentMinor: 0,
        initialPaymentMethod: 'CASH',
        initialStatus: 'CONFIRMED',
      },
    });
    assert.equal(contractConflict.ok, false);

    // Planning calendar must emit BLOCKED_PERIOD (MAINTENANCE) while blockVehicle=true
    const calRes = await invoke(IPC_CHANNELS.PLANNING_CALENDAR, {
      token: adminToken,
      data: {
        startDate: `${performedToday}T00:00`,
        endDate: `${new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10)}T23:59`,
      },
    });
    assert.equal(calRes.ok, true);
    const blockEvent = calRes.data.events.find(
      (ev: any) => ev.vehicleId === vehicleId && ev.eventType === 'BLOCKED_PERIOD' && ev.status === 'MAINTENANCE'
    );
    assert.ok(blockEvent);

    // Also verify unblocked scheduled maintenance emits MAINTENANCE event on Planning calendar
    const unblockedRes = await invoke(IPC_CHANNELS.MAINTENANCE_CREATE, {
      token: adminToken,
      data: {
        vehicleId,
        maintenanceTypeId: vidangeType.id,
        status: 'SCHEDULED',
        workDescription: 'Contrôle freins programmé',
        performedDate: new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10),
        scheduledStartDate: new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10) + 'T09:00',
        scheduledEndDate: new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10) + 'T11:00',
        odometerKm: 45000,
        blockVehicle: false,
      },
    });
    assert.equal(unblockedRes.ok, true);
    const calWithMaint = await invoke(IPC_CHANNELS.PLANNING_CALENDAR, {
      token: adminToken,
      data: {
        startDate: `${performedToday}T00:00`,
        endDate: `${new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10)}T23:59`,
      },
    });
    assert.equal(calWithMaint.ok, true);
    const maintEvent = calWithMaint.data.events.find(
      (ev: any) => ev.vehicleId === vehicleId && ev.eventType === 'MAINTENANCE'
    );
    assert.ok(maintEvent);
    await invoke(IPC_CHANNELS.MAINTENANCE_UPDATE, {
      token: adminToken,
      data: { recordId: unblockedRes.data.record.id, status: 'CANCELLED' },
    });

    // 5. Complete maintenance with encrypted invoice + Finance expense posting
    const completeRes = await invoke(IPC_CHANNELS.MAINTENANCE_UPDATE, {
      token: adminToken,
      data: {
        recordId: maintId,
        status: 'COMPLETED',
        odometerKm: 45200,
        laborCostMinor: 300000,
        partsCostMinor: 500000,
        blockVehicle: false,
        recordInFinance: true,
        financeCategory: 'MAINTENANCE',
        paymentMethod: 'CASH',
        invoiceDoc: {
          originalFileName: 'facture-vidange.png',
          mimeType: 'image/png',
          base64Data: SAMPLE_PNG_BASE64,
        },
      },
    });
    assert.equal(completeRes.ok, true);
    assert.equal(completeRes.data.record.status, 'COMPLETED');
    assert.equal(completeRes.data.record.blockIsActive, false);
    assert.ok(completeRes.data.record.linkedExpenseId);
    assert.ok(completeRes.data.record.nextDueOdometerKm > 45200);
    assert.ok(completeRes.data.record.nextDueDate);

    // Vehicle must return to AVAILABLE
    const vAfter = await invoke(IPC_CHANNELS.VEHICLES_GET, {
      token: adminToken,
      data: { id: vehicleId },
    });
    assert.equal(vAfter.ok, true);
    assert.equal(vAfter.data.vehicle.status, 'AVAILABLE');

    // Invoice must be AES-256 encrypted on disk and roundtrip cleanly via IPC
    const relPath = completeRes.data.record.invoiceFilePath as string;
    const diskBuf = fs.readFileSync(path.join(root, 'vault', relPath));
    assert.notEqual(diskBuf.subarray(0, 4).toString('hex'), '89504e47');
    const invoiceRead = await invoke(IPC_CHANNELS.MAINTENANCE_READ_INVOICE, {
      token: adminToken,
      data: { recordId: maintId },
    });
    assert.equal(invoiceRead.ok, true);
    assert.equal(invoiceRead.data.base64Data, SAMPLE_PNG_BASE64);

    // Re-submitting update with recordInFinance: true must NOT duplicate Finance expense
    const repeatUpdate = await invoke(IPC_CHANNELS.MAINTENANCE_UPDATE, {
      token: adminToken,
      data: {
        recordId: maintId,
        notes: 'Mise à jour post-clôture',
        recordInFinance: true,
      },
    });
    assert.equal(repeatUpdate.ok, true);
    const expensesRes = await invoke(IPC_CHANNELS.FINANCE_LIST_EXPENSES, {
      token: adminToken,
      data: { vehicleId },
    });
    assert.equal(expensesRes.ok, true);
    const linkedExpenses = expensesRes.data.filter((ex: any) => ex.maintenanceRecordId === maintId);
    assert.equal(linkedExpenses.length, 1);
    assert.equal(linkedExpenses[0].amountMinor, 800000);

    // 6. Trigger & test Operational Alerts + deduplication + auto-resolution
    // 6a. Past-due scheduled maintenance record -> MAINTENANCE_OVERDUE
    const pastDate = '2025-01-10';
    const overduePlanned = await invoke(IPC_CHANNELS.MAINTENANCE_CREATE, {
      token: adminToken,
      data: {
        vehicleId,
        maintenanceTypeId: vidangeType.id,
        status: 'SCHEDULED',
        workDescription: 'Contrôle en retard',
        performedDate: pastDate,
        scheduledStartDate: `${pastDate}T08:00`,
        scheduledEndDate: `${pastDate}T12:00`,
        odometerKm: 40000,
        blockVehicle: false,
      },
    });
    assert.equal(overduePlanned.ok, true);
    const overdueId = overduePlanned.data.record.id as number;

    // 6b. Chronological odometer drop (later/same date with lower km than 45200) -> MILEAGE_ANOMALY
    const anomalyRec = await invoke(IPC_CHANNELS.MAINTENANCE_CREATE, {
      token: adminToken,
      data: {
        vehicleId,
        maintenanceTypeId: vidangeType.id,
        status: 'SCHEDULED',
        workDescription: 'Relevé compteur incohérent',
        performedDate: performedToday,
        odometerKm: 41000,
        blockVehicle: false,
      },
    });
    assert.equal(anomalyRec.ok, true);

    const sync1 = await invoke(IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS, { token: adminToken, data: {} });
    assert.equal(sync1.ok, true);
    const sync2 = await invoke(IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS, { token: adminToken, data: {} });
    assert.equal(sync2.ok, true);
    assert.equal(sync1.data.length, sync2.data.length, 'Alert sync must deduplicate without creating duplicates');

    const hasDocAlert = sync2.data.some((a: any) => a.category === 'VEHICLE_DOCUMENT');
    const hasOverdueRecordAlert = sync2.data.some(
      (a: any) =>
        a.category === 'MAINTENANCE_OVERDUE' &&
        a.entityType === 'maintenance_record' &&
        a.entityId === overdueId
    );
    const hasMileageAnomaly = sync2.data.some((a: any) => a.category === 'MILEAGE_ANOMALY');
    assert.equal(hasDocAlert, true);
    assert.equal(hasOverdueRecordAlert, true);
    assert.equal(hasMileageAnomaly, true);

    // Renew assurance doc & cancel past-due record -> those alerts auto-resolve on next sync
    await invoke(IPC_CHANNELS.VEHICLES_UPSERT_DOC, {
      token: adminToken,
      data: {
        id: docId,
        vehicleId,
        docType: 'ASSURANCE',
        documentNumber: 'ASS-2027-01',
        issueDate: performedToday,
        expirationDate: '2028-12-31',
        reminderDays: 30,
      },
    });
    await invoke(IPC_CHANNELS.MAINTENANCE_UPDATE, {
      token: adminToken,
      data: { recordId: overdueId, status: 'CANCELLED' },
    });

    const syncAfterClear = await invoke(IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS, {
      token: adminToken,
      data: {},
    });
    assert.equal(syncAfterClear.ok, true);
    assert.equal(
      syncAfterClear.data.some((a: any) => a.category === 'VEHICLE_DOCUMENT'),
      false
    );
    assert.equal(
      syncAfterClear.data.some(
        (a: any) =>
          a.category === 'MAINTENANCE_OVERDUE' &&
          a.entityType === 'maintenance_record' &&
          a.entityId === overdueId
      ),
      false
    );

    // 7. RBAC enforcement checks
    const agentUpsertType = await invoke(IPC_CHANNELS.MAINTENANCE_TYPES_UPSERT, {
      token: agentToken,
      data: {
        code: 'CUSTOM_TEST',
        nameFr: 'Test interdit',
        nameAr: 'اختبار ممنوع',
        kmWarningThreshold: 500,
        dayWarningThreshold: 7,
        isActive: true,
      },
    });
    assert.equal(agentUpsertType.ok, false);
    assert.equal(agentUpsertType.error?.code, 'FORBIDDEN');

    // Strip finance:manage_expenses from agent -> posting to Finance must return FORBIDDEN
    const stripRes = await invoke(IPC_CHANNELS.USERS_UPDATE, {
      token: adminToken,
      data: {
        userId: agentUserId,
        permissionOverrides: [{ code: 'finance:manage_expenses', granted: false }],
      },
    });
    assert.equal(stripRes.ok, true);

    const agentFinancePost = await invoke(IPC_CHANNELS.MAINTENANCE_CREATE, {
      token: agentToken,
      data: {
        vehicleId,
        maintenanceTypeId: vidangeType.id,
        status: 'COMPLETED',
        workDescription: 'Tentative dépense sans permission',
        performedDate: performedToday,
        odometerKm: 45300,
        laborCostMinor: 100000,
        partsCostMinor: 0,
        recordInFinance: true,
      },
    });
    assert.equal(agentFinancePost.ok, false);
    assert.equal(agentFinancePost.error?.code, 'FORBIDDEN');
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 4 Step 2 Preview Express HTTP routes enforce RBAC and isolate Maintenance & Operational Alerts on temp DB', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase4-maint-http-'));
  const previewDbPath = path.join(root, 'preview.db');
  const { app, db } = createPreviewExpressApp(previewDbPath);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      if (server.listening) resolve();
      else server.once('listening', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const req = async (urlPath: string, method = 'GET', token?: string, body?: unknown) => {
      const res = await fetch(`${base}${urlPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: (await res.json()) as any };
    };

    const boot = await req(PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP, 'POST', undefined, {
      username: 'prev_admin_m',
      fullName: 'Preview Admin M',
      password: 'PreviewPassword2026!',
    });
    assert.equal(boot.status, 201);
    const adminToken = boot.json.data.token as string;

    const agentCreate = await req(PREVIEW_ENDPOINTS.USERS, 'POST', adminToken, {
      username: 'prev_agent_m',
      fullName: 'Preview Agent M',
      password: 'PreviewPassword2026!',
      roleCode: 'AGENT',
    });
    assert.equal(agentCreate.status, 201);

    const agentLogin = await req(PREVIEW_ENDPOINTS.AUTH_LOGIN, 'POST', undefined, {
      username: 'prev_agent_m',
      password: 'PreviewPassword2026!',
    });
    const agentToken = agentLogin.json.data.token as string;

    // Seed vehicle
    const vCreate = await req(PREVIEW_ENDPOINTS.VEHICLES, 'POST', adminToken, {
      internalCode: 'PV-M-01',
      matricule: '09999-126-16',
      brand: 'Peugeot',
      model: '208',
      year: 2026,
      color: 'Gris',
      category: 'Citadine',
      fuelType: 'ESSENCE',
      transmission: 'MANUAL',
      seats: 5,
      currentOdometerKm: 12000,
      defaultDailyRateMinor: 650000,
    });
    assert.equal(vCreate.status, 201);
    const vehicleId = vCreate.json.data.id as number;

    // Types list + RBAC block on agent creating type
    const typesList = await req(`${PREVIEW_ENDPOINTS.MAINTENANCE}/types`, 'GET', agentToken);
    assert.equal(typesList.status, 200);
    assert.ok(typesList.json.data.length >= 12);

    const agentTypeForbidden = await req(`${PREVIEW_ENDPOINTS.MAINTENANCE}/types`, 'POST', agentToken, {
      code: 'FORBIDDEN_TYPE',
      nameFr: 'Interdit',
      nameAr: 'ممنوع',
      kmWarningThreshold: 500,
      dayWarningThreshold: 10,
      isActive: true,
    });
    assert.equal(agentTypeForbidden.status, 403);

    // Create maintenance via HTTP & verify retrieval + alert sync
    const maintCreate = await req(PREVIEW_ENDPOINTS.MAINTENANCE, 'POST', agentToken, {
      vehicleId,
      maintenanceTypeId: typesList.json.data[0].id,
      status: 'COMPLETED',
      workDescription: 'Révision 12 000 km',
      performedDate: '2026-06-01',
      odometerKm: 12000,
      laborCostMinor: 200000,
      partsCostMinor: 300000,
      blockVehicle: false,
    });
    assert.equal(maintCreate.status, 201);
    const recId = maintCreate.json.data.record.id as number;

    const maintGet = await req(`${PREVIEW_ENDPOINTS.MAINTENANCE}/${recId}`, 'GET', agentToken);
    assert.equal(maintGet.status, 200);
    assert.equal(maintGet.json.data.record.totalCostMinor, 500000);

    const syncHttp = await req(`${PREVIEW_ENDPOINTS.NOTIFICATIONS}/sync`, 'POST', agentToken, {});
    assert.equal(syncHttp.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 4 Step 2 maintenance feature components use ModalDialog portals without raw fixed overlays', () => {
  const maintDir = path.resolve('src/features/maintenance');
  const files = fs.readdirSync(maintDir).filter((f) => f.endsWith('.tsx'));
  assert.ok(files.length >= 4);
  for (const file of files) {
    const src = fs.readFileSync(path.join(maintDir, file), 'utf8');
    assert.equal(src.includes('fixed inset-0'), false, `${file} must not render raw fixed inset-0 overlays`);
    assert.equal(src.includes('z-50'), false, `${file} must not hardcode z-50 stacking layers`);
  }
});
