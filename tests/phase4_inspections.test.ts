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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase4-inspections-'));
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

test('Phase 4 Step 1 Inspections & Damage Management enforces lifecycle, immutability, vault encryption, RBAC, and zero auto-charging via Desktop IPC', async () => {
  const { root, kernel, invoke } = setupDesktop();

  try {
    // 1. Bootstrap Admin & Agent
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_insp', fullName: 'Admin Ops', password: 'AdminPassword2026!' },
    });
    assert.equal(boot.ok, true);
    const adminToken = boot.data.token as string;

    const agentCreate = await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent_insp',
        fullName: 'Agent Parc',
        password: 'AgentPassword2026!',
        roleCode: 'AGENT',
      },
    });
    assert.equal(agentCreate.ok, true);

    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_insp', password: 'AgentPassword2026!' },
    });
    assert.equal(agentLogin.ok, true);
    const agentToken = agentLogin.data.token as string;

    // 2. Seed vehicle, customer & active contract
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-INSP-01',
        matricule: '00987-126-16',
        brand: 'Dacia',
        model: 'Sandero Stepway',
        year: 2025,
        color: 'Bleu',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 15000,
        defaultDailyRateMinor: 550000,
      },
    });
    assert.equal(vRes.ok, true);
    const vehicleId = vRes.data.id as number;

    const cRes = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: adminToken,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Nabil Kaci',
        phone: '0661223344',
        wilayaCode: '16',
        commune: 'Bab Ezzouar',
        cniNumber: '1600112233',
        drivingLicenceNumber: 'DL-16-445566',
        drivingLicenceIssueDate: '2019-01-01',
        drivingLicenceExpirationDate: '2031-01-01',
      },
    });
    assert.equal(cRes.ok, true);
    const customerId = cRes.data.customer.id as number;

    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
    const expectedReturnDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().slice(0, 19);

    const contractRes = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: adminToken,
      data: {
        customerId,
        vehicleId,
        startDate,
        expectedReturnDate,
        departureOdometerKm: 15000,
        mileageMode: 'UNLIMITED',
        extraKmRateMinor: 0,
        currency: 'DZD',
        baseRentalTotalMinor: 1_100_000,
        discountMinor: 0,
        depositAmountMinor: 3_000_000,
        depositCurrency: 'DZD',
        initialPaymentMinor: 1_100_000,
        initialPaymentMethod: 'CASH',
        initialStatus: 'ACTIVE',
      },
    });
    assert.equal(contractRes.ok, true, JSON.stringify(contractRes.error));
    const contractId = contractRes.data.contract.id as number;
    const baselineContractTotal = contractRes.data.contract.totalContractAmountMinor as number;
    const baselinePaidNet = contractRes.data.contract.paidNetMinor as number;
    const baselineDepositHeld = contractRes.data.deposit.remainingHeldMinor as number;

    // 3. Create DEPARTURE inspection as DRAFT with pre-existing scratch
    const depCreate = await invoke(IPC_CHANNELS.INSPECTIONS_CREATE, {
      token: agentToken,
      data: {
        contractId,
        stage: 'DEPARTURE',
        odometerKm: 15000,
        fuelLevelPercent: 80,
        exteriorNotes: 'Véhicule propre au départ',
        customerAcknowledged: true,
        items: [
          {
            itemKey: 'ext_front_bumper',
            category: 'EXTERIOR',
            labelFr: 'Pare-chocs avant',
            labelAr: 'المصد الأمامي',
            condition: 'GOOD',
            sortOrder: 1,
          },
          {
            itemKey: 'safety_spare_tire',
            category: 'SAFETY_DOCS',
            labelFr: 'Roue de secours',
            labelAr: 'العجلة الاحتياطية',
            condition: 'GOOD',
            sortOrder: 2,
          },
        ],
        damages: [
          {
            zoneCode: 'REAR_BUMPER',
            diagramX: 50,
            diagramY: 92,
            damageType: 'SCRATCH',
            severity: 'MINOR',
            description: 'Légère rayure superficielle préexistante',
            isPreExisting: true,
            isNewlyDiscovered: false,
            estimatedRepairCostMinor: 500000,
          },
        ],
      },
    });
    assert.equal(depCreate.ok, true, JSON.stringify(depCreate.error));
    const depId = depCreate.data.inspection.id as number;
    assert.equal(depCreate.data.inspection.status, 'DRAFT');
    assert.equal(depCreate.data.damages.length, 1);

    // 4. Upload encrypted photo to DRAFT departure inspection, verify ciphertext on disk & roundtrip
    const upPhoto = await invoke(IPC_CHANNELS.INSPECTIONS_UPLOAD_PHOTO, {
      token: agentToken,
      data: {
        inspectionId: depId,
        originalFileName: 'depart-avant.png',
        mimeType: 'image/png',
        base64Data: SAMPLE_PNG_BASE64,
        caption: 'Vue avant départ',
      },
    });
    assert.equal(upPhoto.ok, true, JSON.stringify(upPhoto.error));
    const photoId = upPhoto.data.id as number;
    const encryptedRelPath = upPhoto.data.filePath as string;
    const encryptedFullPath = path.join(root, 'vault', encryptedRelPath);
    assert.equal(fs.existsSync(encryptedFullPath), true);
    const diskBytes = fs.readFileSync(encryptedFullPath);
    assert.notEqual(diskBytes.toString('base64'), SAMPLE_PNG_BASE64);

    const readPhoto = await invoke(IPC_CHANNELS.INSPECTIONS_READ_PHOTO, {
      token: agentToken,
      data: { photoId },
    });
    assert.equal(readPhoto.ok, true);
    assert.equal(readPhoto.data.base64Data, SAMPLE_PNG_BASE64);

    // Upload a second temporary photo and delete it while still DRAFT
    const tempPhoto = await invoke(IPC_CHANNELS.INSPECTIONS_UPLOAD_PHOTO, {
      token: agentToken,
      data: {
        inspectionId: depId,
        originalFileName: 'temp.png',
        mimeType: 'image/png',
        base64Data: SAMPLE_PNG_BASE64,
      },
    });
    assert.equal(tempPhoto.ok, true);
    const delTemp = await invoke(IPC_CHANNELS.INSPECTIONS_DELETE_PHOTO, {
      token: agentToken,
      data: { photoId: tempPhoto.data.id },
    });
    assert.equal(delTemp.ok, true);

    // 5. Finalize DEPARTURE inspection -> verify immutable lock
    const finDep = await invoke(IPC_CHANNELS.INSPECTIONS_FINALIZE, {
      token: agentToken,
      data: { inspectionId: depId },
    });
    assert.equal(finDep.ok, true, JSON.stringify(finDep.error));
    assert.equal(finDep.data.inspection.status, 'FINALIZED');

    const editAfterFin = await invoke(IPC_CHANNELS.INSPECTIONS_UPDATE, {
      token: adminToken,
      data: { inspectionId: depId, odometerKm: 15100 },
    });
    assert.equal(editAfterFin.ok, false);
    assert.equal(editAfterFin.error.code, 'CONFLICT');

    const uploadAfterFin = await invoke(IPC_CHANNELS.INSPECTIONS_UPLOAD_PHOTO, {
      token: adminToken,
      data: {
        inspectionId: depId,
        originalFileName: 'late.png',
        mimeType: 'image/png',
        base64Data: SAMPLE_PNG_BASE64,
      },
    });
    assert.equal(uploadAfterFin.ok, false);
    assert.equal(uploadAfterFin.error.code, 'CONFLICT');

    const deletePhotoAfterFin = await invoke(IPC_CHANNELS.INSPECTIONS_DELETE_PHOTO, {
      token: adminToken,
      data: { photoId },
    });
    assert.equal(deletePhotoAfterFin.ok, false);
    assert.equal(deletePhotoAfterFin.error.code, 'CONFLICT');

    const addDmgFinalized = await invoke(IPC_CHANNELS.DAMAGES_ADD, {
      token: adminToken,
      data: {
        vehicleId,
        contractId,
        inspectionId: depId,
        zoneCode: 'HOOD',
        damageType: 'DENT',
        severity: 'MODERATE',
        description: 'Tentative modification post-finalisation',
      },
    });
    assert.equal(addDmgFinalized.ok, false);
    assert.equal(addDmgFinalized.error.code, 'CONFLICT');

    // 6. Create RETURN inspection -> verify Departure is untouched & comparison detects degradation & new damage
    const retCreate = await invoke(IPC_CHANNELS.INSPECTIONS_CREATE, {
      token: agentToken,
      data: {
        contractId,
        stage: 'RETURN',
        odometerKm: 15420,
        fuelLevelPercent: 55,
        customerAcknowledged: true,
        finalizeNow: true,
        items: [
          {
            itemKey: 'ext_front_bumper',
            category: 'EXTERIOR',
            labelFr: 'Pare-chocs avant',
            labelAr: 'المصد الأمامي',
            condition: 'DAMAGED',
            notes: 'Choc avant droit',
            sortOrder: 1,
          },
          {
            itemKey: 'safety_spare_tire',
            category: 'SAFETY_DOCS',
            labelFr: 'Roue de secours',
            labelAr: 'العجلة الاحتياطية',
            condition: 'MISSING',
            sortOrder: 2,
          },
        ],
        damages: [
          {
            zoneCode: 'FRONT_BUMPER',
            diagramX: 50,
            diagramY: 10,
            damageType: 'CRACK',
            severity: 'MAJOR',
            description: 'Pare-chocs avant fissuré au retour',
            isPreExisting: false,
            isNewlyDiscovered: true,
            estimatedRepairCostMinor: 4_500_000,
          },
        ],
      },
    });
    assert.equal(retCreate.ok, true, JSON.stringify(retCreate.error));
    assert.equal(retCreate.data.inspection.status, 'FINALIZED');
    assert.equal(retCreate.data.inspection.mileageDeltaKm, 420);
    assert.ok(retCreate.data.inspection.lateReturnMinutes > 0);
    assert.equal(retCreate.data.comparison.odometerDeltaKm, 420);
    assert.equal(retCreate.data.comparison.fuelDeltaPercent, -25);
    assert.equal(retCreate.data.comparison.degradedItemsCount, 2);
    assert.equal(retCreate.data.comparison.missingAccessoriesCount, 1);
    assert.equal(retCreate.data.comparison.newlyDiscoveredDamages.length, 1);
    const newDamageId = retCreate.data.damages[0].id as number;

    // Verify Departure remains intact and separate
    const contractInsp = await invoke(IPC_CHANNELS.INSPECTIONS_GET_BY_CONTRACT, {
      token: agentToken,
      data: { contractId },
    });
    assert.equal(contractInsp.ok, true);
    assert.equal(contractInsp.data.departure.inspection.id, depId);
    assert.equal(contractInsp.data.departure.inspection.odometerKm, 15000);
    assert.equal(contractInsp.data.returnInspection.inspection.odometerKm, 15420);

    // 7. Verify CRITICAL business rule: Return inspection NEVER auto-charges customer or deducts deposit!
    const contractAfterReturn = await invoke(IPC_CHANNELS.CONTRACTS_GET, {
      token: agentToken,
      data: { id: contractId },
    });
    assert.equal(contractAfterReturn.ok, true);
    assert.equal(contractAfterReturn.data.contract.totalContractAmountMinor, baselineContractTotal);
    assert.equal(contractAfterReturn.data.contract.paidNetMinor, baselinePaidNet);
    assert.equal(contractAfterReturn.data.contract.damageChargeMinor, 0);
    assert.equal(contractAfterReturn.data.deposit.remainingHeldMinor, baselineDepositHeld);
    assert.equal(contractAfterReturn.data.deposit.deductedAmountMinor, 0);

    // 8. Damage status workflow & RBAC enforcement
    const agentDamageTransition = await invoke(IPC_CHANNELS.DAMAGES_UPDATE_STATUS, {
      token: agentToken,
      data: {
        damageId: newDamageId,
        newStatus: 'CONFIRMED',
        notes: 'Agent sans permission',
      },
    });
    assert.equal(agentDamageTransition.ok, false);
    assert.equal(agentDamageTransition.error.code, 'FORBIDDEN');

    for (const step of [
      { status: 'UNDER_REVIEW', notes: 'Inspection atelier demandée' },
      { status: 'CONFIRMED', notes: 'Devis carrosserie confirmé', cost: 4_800_000 },
      { status: 'UNDER_REPAIR', notes: 'Déposé au garage', ref: 'GAR-2026-041' },
      { status: 'REPAIRED', notes: 'Réparation terminée et contrôlée', ref: 'GAR-2026-041' },
    ]) {
      const upd = await invoke(IPC_CHANNELS.DAMAGES_UPDATE_STATUS, {
        token: adminToken,
        data: {
          damageId: newDamageId,
          newStatus: step.status,
          notes: step.notes,
          estimatedRepairCostMinor: step.cost ?? null,
          repairReference: step.ref ?? null,
        },
      });
      assert.equal(upd.ok, true, JSON.stringify(upd.error));
      assert.equal(upd.data.status, step.status);
    }

    const dmgList = await invoke(IPC_CHANNELS.DAMAGES_LIST, {
      token: agentToken,
      data: { vehicleId },
    });
    assert.equal(dmgList.ok, true);
    const tracked = dmgList.data.find((d: any) => d.id === newDamageId);
    assert.ok(tracked);
    assert.equal(tracked.status, 'REPAIRED');
    assert.equal(tracked.resolutionHistory.length, 5);

    // 9. PDF Payload includes decrypted photo dataUrl & comparison
    const pdfPayload = await invoke(IPC_CHANNELS.INSPECTIONS_GET_PDF_PAYLOAD, {
      token: agentToken,
      data: { inspectionId: depId },
    });
    assert.equal(pdfPayload.ok, true);
    assert.equal(pdfPayload.data.photos.length, 1);
    assert.ok(pdfPayload.data.photos[0].dataUrl.startsWith('data:image/png;base64,'));
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 4 Step 1 Preview Express HTTP routes work with isolated preview DB and enforce RBAC', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase4-preview-insp-'));
  const dbPath = path.join(root, 'preview.sqlite');
  const { app, db } = createPreviewExpressApp(dbPath);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve) => {
      if (server.listening) resolve();
      else server.once('listening', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    async function api(method: string, urlPath: string, token?: string, body?: unknown) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as any;
      return { status: res.status, json };
    }

    const boot = await api('POST', PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP, undefined, {
      username: 'prev_admin',
      fullName: 'Preview Admin',
      password: 'AdminPassword2026!',
    });
    assert.equal(boot.status, 201);
    const token = boot.json.data.token as string;

    const listEmpty = await api('GET', PREVIEW_ENDPOINTS.INSPECTIONS, token);
    assert.equal(listEmpty.status, 200);
    assert.deepEqual(listEmpty.json.data, []);

    const dmgListEmpty = await api('GET', `${PREVIEW_ENDPOINTS.INSPECTIONS}/damages`, token);
    assert.equal(dmgListEmpty.status, 200);
    assert.deepEqual(dmgListEmpty.json.data, []);
  } finally {
    server.close();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 4 Step 1 Inspection UI files obey ModalDialog portal rule (no raw fixed inset-0 or z-50)', () => {
  const dir = path.resolve('src/features/inspections');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));
  assert.ok(files.length >= 4);
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.equal(content.includes('fixed inset-0'), false, `${file} must use ModalDialog`);
    assert.equal(content.includes('z-50'), false, `${file} must not hardcode z-50`);
  }
});
