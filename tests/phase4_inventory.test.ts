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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase4-inventory-'));
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

test('Test 21: Desktop IPC Spare Parts Inventory, stock movements, negative stock protection, low-stock alerts auto-resolution, Finance purchase integration, and Admin-only adjustments', async () => {
  const { root, kernel, invoke } = setupDesktop();

  try {
    // 1. Bootstrap Admin & create Agent
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_inv', fullName: 'Admin Stock', password: 'AdminPassword2026!' },
    });
    assert.equal(boot.ok, true);
    const adminToken = boot.data.token as string;

    const agentCreate = await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent_inv',
        fullName: 'Agent Magasin',
        password: 'AgentPassword2026!',
        roleCode: 'AGENT',
      },
    });
    assert.equal(agentCreate.ok, true);

    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_inv', password: 'AgentPassword2026!' },
    });
    assert.equal(agentLogin.ok, true);
    const agentToken = agentLogin.data.token as string;

    // 2. Upsert supplier (create & update)
    const supCreate = await invoke(IPC_CHANNELS.FINANCE_UPSERT_SUPPLIER, {
      token: agentToken,
      data: {
        name: 'Sarl Auto Pièces El Harrach',
        phone: '0550445566',
        email: 'contact@el-harrach-pieces.dz',
        wilayaCode: '16',
        specialty: 'Filtration & Lubrifiants',
        nifNumber: '001616009988112',
        address: 'Zone Industrielle El Harrach, Alger',
      },
    });
    assert.equal(supCreate.ok, true, JSON.stringify(supCreate.error));
    const supplierId = supCreate.data.id as number;

    const supUpdate = await invoke(IPC_CHANNELS.FINANCE_UPSERT_SUPPLIER, {
      token: agentToken,
      data: {
        id: supplierId,
        name: 'Sarl Auto Pièces El Harrach',
        phone: '0550445599',
        wilayaCode: '16',
        specialty: 'Filtration, Freinage & Lubrifiants',
      },
    });
    assert.equal(supUpdate.ok, true);
    assert.equal(supUpdate.data.phone, '0550445599');

    // 3. Create part with initialStock > 0 -> must log INITIAL_STOCK movement
    const partCreate = await invoke(IPC_CHANNELS.INVENTORY_UPSERT_PART, {
      token: agentToken,
      data: {
        partCode: 'flt-hui-15dci',
        partName: 'Filtre à huile 1.5 dCi',
        category: 'FILTRATION',
        unitLabel: 'PIECE',
        compatibleModels: 'Clio 4, Sandero, Symbol',
        minimumStock: 3,
        unitPurchasePriceMinor: 120000,
        supplierId,
        storageLocation: 'Rayon A · Bac 02',
        initialStock: 2,
      },
    });
    assert.equal(partCreate.ok, true, JSON.stringify(partCreate.error));
    const partId = partCreate.data.part.id as number;
    assert.equal(partCreate.data.part.partCode, 'FLT-HUI-15DCI');
    assert.equal(partCreate.data.part.quantityAvailable, 2);
    assert.equal(partCreate.data.part.stockStatus, 'LOW_STOCK');
    assert.equal(partCreate.data.movements.length, 1);
    assert.equal(partCreate.data.movements[0].movementType, 'INITIAL_STOCK');
    assert.equal(partCreate.data.movements[0].quantityDelta, 2);

    // 4. Sync alerts -> part has qty 2 <= min 3 -> LOW_STOCK WARNING alert created
    const syncLow = await invoke(IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS, {
      token: agentToken,
      data: {},
    });
    assert.equal(syncLow.ok, true);
    const lowAlert = syncLow.data.find(
      (a: any) => a.category === 'LOW_STOCK' && a.entityType === 'inventory_part' && a.entityId === partId
    );
    assert.ok(lowAlert, 'LOW_STOCK alert should be emitted when quantity <= minimumStock');
    assert.equal(lowAlert.severity, 'WARNING');

    // 5. Reject WITHDRAWAL that would cause negative stock
    const negWithdraw = await invoke(IPC_CHANNELS.INVENTORY_RECORD_MOVEMENT, {
      token: agentToken,
      data: {
        partId,
        movementType: 'WITHDRAWAL',
        quantity: 5,
        notes: 'Tentative retrait excessif',
      },
    });
    assert.equal(negWithdraw.ok, false);
    assert.equal(negWithdraw.error?.code, 'CONFLICT');

    // 6. Withdraw all remaining 2 units -> stock = 0 (OUT_OF_STOCK) -> escalates alert to CRITICAL
    const outWithdraw = await invoke(IPC_CHANNELS.INVENTORY_RECORD_MOVEMENT, {
      token: agentToken,
      data: {
        partId,
        movementType: 'WITHDRAWAL',
        quantity: 2,
        referenceCode: 'BON-SORTIE-01',
        notes: 'Sortie atelier',
      },
    });
    assert.equal(outWithdraw.ok, true);
    assert.equal(outWithdraw.data.part.quantityAvailable, 0);
    assert.equal(outWithdraw.data.part.stockStatus, 'OUT_OF_STOCK');

    const alertsOut = await invoke(IPC_CHANNELS.NOTIFICATIONS_LIST, {
      token: agentToken,
      data: { category: 'LOW_STOCK' },
    });
    assert.equal(alertsOut.ok, true);
    assert.equal(alertsOut.data.length, 1);
    assert.equal(alertsOut.data[0].severity, 'CRITICAL');

    // 7. Enforce RBAC on PURCHASE with recordInFinance: true (Agent lacks finance:manage_expenses -> FORBIDDEN), then execute as Admin
    const agentPurchaseFinance = await invoke(IPC_CHANNELS.INVENTORY_RECORD_MOVEMENT, {
      token: agentToken,
      data: {
        partId,
        movementType: 'PURCHASE',
        quantity: 10,
        unitCostMinor: 135000,
        supplierId,
        referenceCode: 'BL-2026-088',
        movementDate: '2026-06-15',
        notes: 'Tentative achat avec dépense finance sans permission',
        recordInFinance: true,
        paymentMethod: 'CASH',
      },
    });
    assert.equal(agentPurchaseFinance.ok, false);
    assert.equal(agentPurchaseFinance.error?.code, 'FORBIDDEN');

    const purchaseRes = await invoke(IPC_CHANNELS.INVENTORY_RECORD_MOVEMENT, {
      token: adminToken,
      data: {
        partId,
        movementType: 'PURCHASE',
        quantity: 10,
        unitCostMinor: 135000,
        supplierId,
        referenceCode: 'BL-2026-088',
        movementDate: '2026-06-15',
        notes: 'Réapprovisionnement lot de 10 filtres',
        recordInFinance: true,
        paymentMethod: 'CASH',
        paymentReference: 'CAISSE-01',
      },
    });
    assert.equal(purchaseRes.ok, true, JSON.stringify(purchaseRes.error));
    assert.equal(purchaseRes.data.part.quantityAvailable, 10);
    assert.equal(purchaseRes.data.part.unitPurchasePriceMinor, 135000);
    assert.equal(purchaseRes.data.part.stockStatus, 'IN_STOCK');
    assert.ok(purchaseRes.data.movement.expenseId);

    const expList = await invoke(IPC_CHANNELS.FINANCE_LIST_EXPENSES, {
      token: adminToken,
      data: { category: 'SPARE_PARTS' },
    });
    assert.equal(expList.ok, true);
    const linkedPurchaseExp = expList.data.find((ex: any) => ex.id === purchaseRes.data.movement.expenseId);
    assert.ok(linkedPurchaseExp);
    assert.equal(linkedPurchaseExp.amountMinor, 1_350_000);

    // LOW_STOCK alert must now be automatically resolved!
    const unresolvedLow = await invoke(IPC_CHANNELS.NOTIFICATIONS_LIST, {
      token: agentToken,
      data: { category: 'LOW_STOCK', includeResolved: false },
    });
    assert.equal(unresolvedLow.ok, true);
    assert.equal(unresolvedLow.data.length, 0);

    // 8. Return 1 part -> stock becomes 11
    const retRes = await invoke(IPC_CHANNELS.INVENTORY_RECORD_MOVEMENT, {
      token: agentToken,
      data: {
        partId,
        movementType: 'RETURN',
        quantity: 1,
        referenceCode: 'RET-ATELIER-01',
      },
    });
    assert.equal(retRes.ok, true);
    assert.equal(retRes.data.part.quantityAvailable, 11);

    // 9. Enforce RBAC on INVENTORY_ADJUST_STOCK (Agent -> FORBIDDEN, Admin -> OK, negative result -> CONFLICT)
    const agentAdjust = await invoke(IPC_CHANNELS.INVENTORY_ADJUST_STOCK, {
      token: agentToken,
      data: {
        partId,
        quantityDelta: -1,
        overrideReason: 'Tentative ajustement par agent',
      },
    });
    assert.equal(agentAdjust.ok, false);
    assert.equal(agentAdjust.error?.code, 'FORBIDDEN');

    const adminTooNegative = await invoke(IPC_CHANNELS.INVENTORY_ADJUST_STOCK, {
      token: adminToken,
      data: {
        partId,
        quantityDelta: -50,
        overrideReason: 'Test écart négatif impossible',
      },
    });
    assert.equal(adminTooNegative.ok, false);
    assert.equal(adminTooNegative.error?.code, 'CONFLICT');

    const adminAdjust = await invoke(IPC_CHANNELS.INVENTORY_ADJUST_STOCK, {
      token: adminToken,
      data: {
        partId,
        quantityDelta: -2,
        overrideReason: 'Inventaire physique juin 2026 : 2 filtres endommagés',
        movementDate: '2026-06-16',
      },
    });
    assert.equal(adminAdjust.ok, true);
    assert.equal(adminAdjust.data.part.quantityAvailable, 9);
    assert.equal(adminAdjust.data.movement.movementType, 'ADJUSTMENT');

    // 10. Overview & archive
    const ov = await invoke(IPC_CHANNELS.INVENTORY_OVERVIEW, { token: agentToken, data: {} });
    assert.equal(ov.ok, true);
    assert.equal(ov.data.totalSkuCount, 1);
    assert.equal(ov.data.totalUnitsInStock, 9);
    assert.equal(ov.data.totalValuationMinor, 9 * 135000);
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Test 22: Preview Express HTTP Inventory routes, RBAC on /adjust, temp DB isolation & ModalDialog portal hygiene', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase4-inv-http-'));
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
      username: 'prev_admin_inv',
      fullName: 'Preview Admin Inv',
      password: 'PreviewPassword2026!',
    });
    assert.equal(boot.status, 201);
    const adminToken = boot.json.data.token as string;

    await req(PREVIEW_ENDPOINTS.USERS, 'POST', adminToken, {
      username: 'prev_agent_inv',
      fullName: 'Preview Agent Inv',
      password: 'PreviewPassword2026!',
      roleCode: 'AGENT',
    });
    const agentLogin = await req(PREVIEW_ENDPOINTS.AUTH_LOGIN, 'POST', undefined, {
      username: 'prev_agent_inv',
      password: 'PreviewPassword2026!',
    });
    const agentToken = agentLogin.json.data.token as string;

    // Supplier HTTP
    const supRes = await req(`${PREVIEW_ENDPOINTS.FINANCE}/suppliers`, 'POST', agentToken, {
      name: 'Comptoir Oran Pièces',
      wilayaCode: '31',
      specialty: 'Freinage',
    });
    assert.equal(supRes.status, 201);
    const supplierId = supRes.json.data.id as number;

    // Create part HTTP
    const partRes = await req(`${PREVIEW_ENDPOINTS.INVENTORY}/parts`, 'POST', agentToken, {
      partCode: 'PLQ-AV-208',
      partName: 'Plaquettes avant Peugeot 208',
      category: 'FREINAGE',
      unitLabel: 'JEU',
      minimumStock: 2,
      unitPurchasePriceMinor: 420000,
      supplierId,
      initialStock: 4,
    });
    assert.equal(partRes.status, 201);
    const partId = partRes.json.data.part.id as number;

    // Overview & part detail HTTP
    const ovRes = await req(`${PREVIEW_ENDPOINTS.INVENTORY}/overview`, 'GET', agentToken);
    assert.equal(ovRes.status, 200);
    assert.equal(ovRes.json.data.totalSkuCount, 1);

    const detRes = await req(`${PREVIEW_ENDPOINTS.INVENTORY}/parts/${partId}`, 'GET', agentToken);
    assert.equal(detRes.status, 200);
    assert.equal(detRes.json.data.movements.length, 1);

    // Agent forbidden on /adjust
    const agentAdj = await req(`${PREVIEW_ENDPOINTS.INVENTORY}/adjust`, 'POST', agentToken, {
      partId,
      quantityDelta: -1,
      overrideReason: 'Agent HTTP interdit',
    });
    assert.equal(agentAdj.status, 403);

    // Admin allowed on /adjust
    const adminAdj = await req(`${PREVIEW_ENDPOINTS.INVENTORY}/adjust`, 'POST', adminToken, {
      partId,
      quantityDelta: 1,
      overrideReason: 'Boîte retrouvée en inventaire',
    });
    assert.equal(adminAdj.status, 201);
    assert.equal(adminAdj.json.data.part.quantityAvailable, 5);

    // Verify all inventory UI components strictly use ModalDialog / ConfirmDialog portals
    const invDir = path.resolve('src/features/inventory');
    const files = fs.readdirSync(invDir).filter((f) => f.endsWith('.tsx'));
    assert.ok(files.length >= 4);
    for (const file of files) {
      const src = fs.readFileSync(path.join(invDir, file), 'utf8');
      assert.equal(src.includes('fixed inset-0'), false, `${file} must not render raw fixed inset-0 overlays`);
      assert.equal(src.includes('z-50'), false, `${file} must not hardcode z-50 stacking layers`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Test 23: End-to-End Phase 4 Operations Integration (Contract -> Departure/Return Inspections -> Damage -> Deposit Settlement -> Maintenance Parts Consumption -> Locked Anti-Double-Deduction -> Vehicle Profitability)', async () => {
  const { root, kernel, invoke } = setupDesktop();

  try {
    // 1. Setup Admin & Agent
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_e2e', fullName: 'Admin E2E', password: 'AdminPassword2026!' },
    });
    assert.equal(boot.ok, true);
    const adminToken = boot.data.token as string;

    // 2. Seed vehicle, customer, supplier & spare part
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-E2E-01',
        matricule: '05511-126-16',
        brand: 'Hyundai',
        model: 'i20',
        year: 2026,
        color: 'Gris',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 10000,
        defaultDailyRateMinor: 700000,
      },
    });
    assert.equal(vRes.ok, true);
    const vehicleId = vRes.data.id as number;

    const cRes = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: adminToken,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Yacine Benali',
        phone: '0770123456',
        wilayaCode: '16',
        commune: 'Kouba',
        cniNumber: '1600776655',
        drivingLicenceNumber: 'DL-16-998877',
        drivingLicenceIssueDate: '2020-01-01',
        drivingLicenceExpirationDate: '2032-01-01',
      },
    });
    assert.equal(cRes.ok, true);
    const customerId = cRes.data.customer.id as number;

    const supRes = await invoke(IPC_CHANNELS.FINANCE_UPSERT_SUPPLIER, {
      token: adminToken,
      data: { name: 'Atelier Hyundai Centre', specialty: 'Mécanique générale', wilayaCode: '16' },
    });
    assert.equal(supRes.ok, true);
    const supplierId = supRes.data.id as number;

    // Create 2 spare parts: oil filter (qty 5 @ 1,500 DZD) and engine oil (qty 4 @ 6,500 DZD)
    const pFilter = await invoke(IPC_CHANNELS.INVENTORY_UPSERT_PART, {
      token: adminToken,
      data: {
        partCode: 'HYU-FLT-01',
        partName: 'Filtre huile i20',
        category: 'FILTRATION',
        unitLabel: 'PIECE',
        minimumStock: 2,
        unitPurchasePriceMinor: 150000,
        supplierId,
        initialStock: 5,
      },
    });
    assert.equal(pFilter.ok, true);
    const filterPartId = pFilter.data.part.id as number;

    const pOil = await invoke(IPC_CHANNELS.INVENTORY_UPSERT_PART, {
      token: adminToken,
      data: {
        partCode: 'HYU-OIL-5W30',
        partName: 'Bidon Huile 5W30 4L',
        category: 'LUBRIFIANTS',
        unitLabel: 'BIDON',
        minimumStock: 2,
        unitPurchasePriceMinor: 650000,
        supplierId,
        initialStock: 4,
      },
    });
    assert.equal(pOil.ok, true);
    const oilPartId = pOil.data.part.id as number;

    // 3. Create & activate rental contract (3 days = 2,100,000 minor = 21,000 DZD) with 30,000 DZD deposit
    const startDt = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 16);
    const expectedRetDt = new Date(Date.now() - 3600_000).toISOString().slice(0, 16);
    const contractCreate = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: adminToken,
      data: {
        customerId,
        vehicleId,
        startDate: startDt,
        expectedReturnDate: expectedRetDt,
        departureOdometerKm: 10000,
        mileageMode: 'UNLIMITED',
        extraKmRateMinor: 0,
        currency: 'DZD',
        baseRentalTotalMinor: 2_100_000,
        discountMinor: 0,
        depositAmountMinor: 3_000_000,
        depositCurrency: 'DZD',
        initialPaymentMinor: 2_100_000,
        initialPaymentMethod: 'CASH',
        initialStatus: 'ACTIVE',
      },
    });
    assert.equal(contractCreate.ok, true, JSON.stringify(contractCreate.error));
    const contractId = contractCreate.data.contract.id as number;
    const depositId = contractCreate.data.deposit.id as number;

    // 4. Finalize Departure & Return Inspections (Return records newly discovered bumper dent; NO auto-charge!)
    const depInsp = await invoke(IPC_CHANNELS.INSPECTIONS_CREATE, {
      token: adminToken,
      data: {
        contractId,
        stage: 'DEPARTURE',
        odometerKm: 10000,
        fuelLevelPercent: 100,
        customerAcknowledged: true,
        finalizeNow: true,
        items: [
          {
            itemKey: 'ext_rear_bumper',
            category: 'EXTERIOR',
            labelFr: 'Pare-chocs arrière',
            labelAr: 'المصد الخلفي',
            condition: 'GOOD',
            sortOrder: 1,
          },
        ],
      },
    });
    assert.equal(depInsp.ok, true);

    const retInsp = await invoke(IPC_CHANNELS.INSPECTIONS_CREATE, {
      token: adminToken,
      data: {
        contractId,
        stage: 'RETURN',
        odometerKm: 10450,
        fuelLevelPercent: 100,
        customerAcknowledged: true,
        finalizeNow: true,
        items: [
          {
            itemKey: 'ext_rear_bumper',
            category: 'EXTERIOR',
            labelFr: 'Pare-chocs arrière',
            labelAr: 'المصد الخلفي',
            condition: 'DAMAGED',
            sortOrder: 1,
          },
        ],
        damages: [
          {
            zoneCode: 'REAR_BUMPER',
            diagramX: 50,
            diagramY: 92,
            damageType: 'DENT',
            severity: 'MODERATE',
            description: 'Enfoncement pare-chocs arrière constaté au retour',
            isPreExisting: false,
            isNewlyDiscovered: true,
            estimatedRepairCostMinor: 800000,
          },
        ],
      },
    });
    assert.equal(retInsp.ok, true);
    const damageId = retInsp.data.damages[0].id as number;

    // Confirm zero auto-charging happened on contract or deposit!
    const contractMid = await invoke(IPC_CHANNELS.CONTRACTS_GET, {
      token: adminToken,
      data: { id: contractId },
    });
    assert.equal(contractMid.data.contract.totalContractAmountMinor, 2_100_000);
    assert.equal(contractMid.data.deposit.remainingHeldMinor, 3_000_000);

    // 5. Complete contract, settle deposit via Finance (8,000 DZD deducted for damage, 22,000 DZD refunded), resolve damage -> REPAIRED
    const completeContract = await invoke(IPC_CHANNELS.CONTRACTS_COMPLETE, {
      token: adminToken,
      data: {
        contractId,
        actualReturnDate: new Date().toISOString().slice(0, 16),
        returnOdometerKm: 10450,
      },
    });
    assert.equal(completeContract.ok, true);

    const settleDep = await invoke(IPC_CHANNELS.FINANCE_SETTLE_DEPOSIT, {
      token: adminToken,
      data: {
        depositId,
        deductedAmountMinor: 800000,
        refundedAmountMinor: 2_200_000,
        chargeCategory: 'DAMAGE',
        deductionReason: 'Réparation pare-chocs arrière selon PV retour',
        refundMethod: 'CASH',
      },
    });
    assert.equal(settleDep.ok, true, JSON.stringify(settleDep.error));

    const dmgConfirm = await invoke(IPC_CHANNELS.DAMAGES_UPDATE_STATUS, {
      token: adminToken,
      data: { damageId, newStatus: 'CONFIRMED', notes: 'Chiffrage validé avec client' },
    });
    assert.equal(dmgConfirm.ok, true);
    const dmgRepair = await invoke(IPC_CHANNELS.DAMAGES_UPDATE_STATUS, {
      token: adminToken,
      data: { damageId, newStatus: 'REPAIRED', repairReference: 'CAR-2026-19', notes: 'Pare-chocs redressé et peint' },
    });
    assert.equal(dmgRepair.ok, true);
    assert.equal(dmgRepair.data.status, 'REPAIRED');

    // 6. Start IN_PROGRESS maintenance using warehouse parts + vehicle block
    const typesRes = await invoke(IPC_CHANNELS.MAINTENANCE_TYPES_LIST, {
      token: adminToken,
      data: { includeInactive: false },
    });
    const vidangeType = typesRes.data.find((t: any) => t.code === 'VIDANGE');
    assert.ok(vidangeType);

    const today = new Date().toISOString().slice(0, 10);
    const maintStart = await invoke(IPC_CHANNELS.MAINTENANCE_CREATE, {
      token: adminToken,
      data: {
        vehicleId,
        maintenanceTypeId: vidangeType.id,
        supplierId,
        status: 'IN_PROGRESS',
        workDescription: 'Vidange 10 000 km + remplacement filtre huile',
        performedDate: today,
        scheduledStartDate: `${today}T09:00`,
        scheduledEndDate: `${today}T12:00`,
        odometerKm: 10450,
        laborCostMinor: 300000,
        partsUsed: [
          { partId: filterPartId, quantityUsed: 1 },
          { partId: oilPartId, quantityUsed: 1 },
        ],
        blockVehicle: true,
        recordInFinance: false,
      },
    });
    assert.equal(maintStart.ok, true, JSON.stringify(maintStart.error));
    const maintId = maintStart.data.record.id as number;
    // While IN_PROGRESS, parts must NOT be deducted yet!
    assert.equal(maintStart.data.record.partsCostMinor, 800000); // 150,000 + 650,000
    assert.equal(maintStart.data.record.partsConsumedLocked, false);

    const filterWhileInProgress = await invoke(IPC_CHANNELS.INVENTORY_GET, {
      token: adminToken,
      data: { partId: filterPartId },
    });
    assert.equal(filterWhileInProgress.data.part.quantityAvailable, 5);

    // Vehicle must be MAINTENANCE & unavailable
    const availCheck = await invoke(IPC_CHANNELS.PLANNING_CHECK_AVAILABILITY, {
      token: adminToken,
      data: {
        vehicleId,
        startDate: `${today}T10:00`,
        endDate: `${today}T11:00`,
      },
    });
    assert.equal(availCheck.ok, true);
    assert.equal(availCheck.data.available, false);

    // 7. Complete maintenance with encrypted invoice + Finance posting (TOTAL = 300,000 + 800,000 = 1,100,000)
    const maintComplete = await invoke(IPC_CHANNELS.MAINTENANCE_UPDATE, {
      token: adminToken,
      data: {
        recordId: maintId,
        status: 'COMPLETED',
        blockVehicle: false,
        recordInFinance: true,
        financeCategory: 'MAINTENANCE',
        financeExpenseScope: 'TOTAL',
        paymentMethod: 'CASH',
        invoiceDoc: {
          originalFileName: 'facture-hyundai.png',
          mimeType: 'image/png',
          base64Data: SAMPLE_PNG_BASE64,
        },
      },
    });
    assert.equal(maintComplete.ok, true, JSON.stringify(maintComplete.error));
    assert.equal(maintComplete.data.record.status, 'COMPLETED');
    assert.equal(maintComplete.data.record.partsConsumedLocked, true);
    assert.equal(maintComplete.data.record.blockIsActive, false);
    assert.ok(maintComplete.data.record.linkedExpenseId);

    // Stock must now be decremented exactly once (filter: 5->4, oil: 4->3) with MAINTENANCE_USE movements!
    const filterAfter = await invoke(IPC_CHANNELS.INVENTORY_GET, {
      token: adminToken,
      data: { partId: filterPartId },
    });
    const oilAfter = await invoke(IPC_CHANNELS.INVENTORY_GET, {
      token: adminToken,
      data: { partId: oilPartId },
    });
    assert.equal(filterAfter.data.part.quantityAvailable, 4);
    assert.equal(oilAfter.data.part.quantityAvailable, 3);
    assert.ok(
      filterAfter.data.movements.some(
        (m: any) => m.movementType === 'MAINTENANCE_USE' && m.maintenanceRecordId === maintId && m.quantityDelta === -1
      )
    );

    // 8. Subsequent edit of notes/technician on COMPLETED maintenance must NEVER double-deduct stock or duplicate expense
    const repeatUpdate = await invoke(IPC_CHANNELS.MAINTENANCE_UPDATE, {
      token: adminToken,
      data: {
        recordId: maintId,
        technicianName: 'Chef Atelier Karim',
        recordInFinance: true,
      },
    });
    assert.equal(repeatUpdate.ok, true);

    const filterAfterRepeat = await invoke(IPC_CHANNELS.INVENTORY_GET, {
      token: adminToken,
      data: { partId: filterPartId },
    });
    assert.equal(filterAfterRepeat.data.part.quantityAvailable, 4, 'Stock must not be double-deducted');
    const maintUseMovements = filterAfterRepeat.data.movements.filter(
      (m: any) => m.movementType === 'MAINTENANCE_USE' && m.maintenanceRecordId === maintId
    );
    assert.equal(maintUseMovements.length, 1);

    // Also test LABOR_ONLY finance expense scope on a 2nd COMPLETED maintenance using remaining stock
    const maintLaborOnly = await invoke(IPC_CHANNELS.MAINTENANCE_CREATE, {
      token: adminToken,
      data: {
        vehicleId,
        maintenanceTypeId: vidangeType.id,
        supplierId,
        status: 'COMPLETED',
        workDescription: 'Appoint huile + contrôle',
        performedDate: today,
        odometerKm: 10460,
        laborCostMinor: 100000,
        partsUsed: [{ partId: oilPartId, quantityUsed: 1 }],
        blockVehicle: false,
        recordInFinance: true,
        financeCategory: 'MAINTENANCE',
        financeExpenseScope: 'LABOR_ONLY',
        paymentMethod: 'CASH',
      },
    });
    assert.equal(maintLaborOnly.ok, true, JSON.stringify(maintLaborOnly.error));
    assert.equal(maintLaborOnly.data.record.partsCostMinor, 650000);
    assert.equal(maintLaborOnly.data.record.partsConsumedLocked, true);

    const oilAfterSecond = await invoke(IPC_CHANNELS.INVENTORY_GET, {
      token: adminToken,
      data: { partId: oilPartId },
    });
    assert.equal(oilAfterSecond.data.part.quantityAvailable, 2);

    const expensesCheck = await invoke(IPC_CHANNELS.FINANCE_LIST_EXPENSES, {
      token: adminToken,
      data: { vehicleId },
    });
    const expLaborOnly = expensesCheck.data.find((ex: any) => ex.id === maintLaborOnly.data.record.linkedExpenseId);
    assert.ok(expLaborOnly);
    assert.equal(expLaborOnly.amountMinor, 100000, 'LABOR_ONLY expense must post only labor cost');

    // 9. Verify vehicle finance summary & profitability integration reflect contract revenue + maintenance expenses
    const vehFin = await invoke(IPC_CHANNELS.FINANCE_VEHICLE_SUMMARY, {
      token: adminToken,
      data: { vehicleId },
    });
    assert.equal(vehFin.ok, true);
    assert.equal(vehFin.data.profitability.rentalRevenueMinor, 2_100_000);
    assert.equal(vehFin.data.profitability.expensesMinor, 1_200_000); // 1,100,000 + 100,000
    assert.equal(vehFin.data.profitability.netProfitMinor, 900_000);

    // 10. Check operational alert generated when oil dropped to 2 (<= minStock 2)
    const oilLowAlert = await invoke(IPC_CHANNELS.NOTIFICATIONS_LIST, {
      token: adminToken,
      data: { category: 'LOW_STOCK', includeResolved: false },
    });
    assert.equal(oilLowAlert.ok, true);
    assert.ok(oilLowAlert.data.some((a: any) => a.entityId === oilPartId && a.severity === 'WARNING'));
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
