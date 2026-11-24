import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IPC_CHANNELS } from '../electron/ipc/contracts.ts';
import { startDesktopKernel, type DesktopKernel } from '../electron/main/appKernel.ts';
import { createPreloadBridge } from '../electron/preload/bridge.ts';

function setupKernel(): { root: string; kernel: DesktopKernel; invoke: (ch: any, payload?: any) => Promise<any> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase2-fleet-cust-'));
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

test('Phase 2 Fleet Management & Customer Vault/Risk enforcement via Desktop IPC', async () => {
  const { root, kernel, invoke } = setupKernel();

  try {
    // Bootstrap Admin + create Agent
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_p2', fullName: 'Admin Phase 2', password: 'AdminPassword2026!' },
    });
    assert.equal(boot.ok, true);
    const adminToken = boot.data.token as string;

    const agentCreated = await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent_p2',
        fullName: 'Agent Phase 2',
        password: 'AgentPassword2026!',
        roleCode: 'AGENT',
      },
    });
    assert.equal(agentCreated.ok, true);

    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_p2', password: 'AgentPassword2026!' },
    });
    const agentToken = agentLogin.data.token as string;

    // 1. Fleet: Invalid Algerian matricule rejected when enforce_matricule_regex=true
    const badPlate = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-001',
        matricule: 'BAD-99-99',
        brand: 'Renault',
        model: 'Clio 5',
        year: 2024,
        color: 'Blanc',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 15000,
        defaultDailyRateMinor: 600000,
      },
    });
    assert.equal(badPlate.ok, false);
    assert.equal(badPlate.error.code, 'VALIDATION_ERROR');

    // 2. Fleet: Valid vehicle created (new wilaya 59 Aflou)
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-001',
        matricule: '00123-124-59',
        vin: 'VF1CLIO5000012345',
        brand: 'Renault',
        model: 'Clio 5',
        year: 2024,
        color: 'Blanc',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 15000,
        defaultDailyRateMinor: 600000, // 6,000 DA
        defaultWeeklyRateMinor: 3800000, // 38,000 DA
        defaultMonthlyRateMinor: 14000000, // 140,000 DA
      },
    });
    assert.equal(vRes.ok, true);
    const vehicleId = vRes.data.id as number;
    assert.equal(vRes.data.status, 'AVAILABLE');

    // Duplicate matricule rejected
    const dupVehicle = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-002',
        matricule: '00123-124-59',
        brand: 'Peugeot',
        model: '208',
        year: 2024,
        color: 'Gris',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 1000,
        defaultDailyRateMinor: 650000,
      },
    });
    assert.equal(dupVehicle.ok, false);
    assert.equal(dupVehicle.error.code, 'CONFLICT');

    // Cannot manually force RENTED without active contract
    const fakeRented = await invoke(IPC_CHANNELS.VEHICLES_UPDATE, {
      token: adminToken,
      data: { id: vehicleId, status: 'RENTED' },
    });
    assert.equal(fakeRented.ok, false);
    assert.equal(fakeRented.error.code, 'VALIDATION_ERROR');

    // Upsert vehicle administrative document
    const docSave = await invoke(IPC_CHANNELS.VEHICLES_UPSERT_DOC, {
      token: adminToken,
      data: {
        vehicleId,
        docType: 'ASSURANCE',
        documentNumber: 'CAAT-2026-881',
        issueDate: '2026-01-01',
        expirationDate: '2027-01-01',
        reminderDays: 30,
      },
    });
    assert.equal(docSave.ok, true);
    assert.equal(docSave.data.docType, 'ASSURANCE');

    // Blocked period creation & conflict check
    const blk1 = await invoke(IPC_CHANNELS.VEHICLES_CREATE_BLOCK, {
      token: adminToken,
      data: {
        vehicleId,
        blockType: 'ADMIN_HOLD',
        startDate: '2026-12-01T08:00',
        endDate: '2026-12-05T18:00',
        reason: 'Visite technique annuelle',
      },
    });
    assert.equal(blk1.ok, true);

    // Overlapping block rejected
    const blkOverlap = await invoke(IPC_CHANNELS.VEHICLES_CREATE_BLOCK, {
      token: adminToken,
      data: {
        vehicleId,
        blockType: 'MAINTENANCE',
        startDate: '2026-12-03T10:00',
        endDate: '2026-12-06T10:00',
        reason: 'Vidange',
      },
    });
    assert.equal(blkOverlap.ok, false);
    assert.equal(blkOverlap.error.code, 'CONFLICT');

    // Release block
    const rel = await invoke(IPC_CHANNELS.VEHICLES_RELEASE_BLOCK, {
      token: adminToken,
      data: { blockId: blk1.data.id },
    });
    assert.equal(rel.ok, true);

    // 3. Customers: Create Individual & Company (using 2026 Wilaya 60 Barika)
    const indRes = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: agentToken,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Yacine Brahimi',
        phone: '0550112233',
        wilayaCode: '60',
        commune: 'Barika',
        cniNumber: '100020003000',
        drivingLicenceNumber: 'DL-2020-6001',
        drivingLicenceIssueDate: '2020-05-01',
        drivingLicenceExpirationDate: '2030-05-01',
      },
    });
    assert.equal(indRes.ok, true);
    const customerId = indRes.data.customer.id as number;

    const compRes = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: agentToken,
      data: {
        customerType: 'COMPANY',
        fullName: 'Nabil Mansouri',
        phone: '0661223344',
        wilayaCode: '16',
        company: {
          companyName: 'SARL Atlas Logistics',
          legalRepresentative: 'Nabil Mansouri',
          rcNumber: '16/00-987654B24',
          nifNumber: '002416098765432',
        },
      },
    });
    assert.equal(compRes.ok, true);
    assert.equal(compRes.data.company.companyName, 'SARL Atlas Logistics');

    // 4. Encrypted Customer Document Vault round-trip
    const secretPayload = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('CONFIDENTIAL_ALGERIA_CNI_SCAN_BYTES_2026'),
    ]);
    const upDoc = await invoke(IPC_CHANNELS.CUSTOMERS_UPLOAD_DOC, {
      token: agentToken,
      data: {
        customerId,
        docCategory: 'CNI',
        originalFileName: 'cni_yacine.png',
        mimeType: 'image/png',
        base64Data: secretPayload.toString('base64'),
      },
    });
    assert.equal(upDoc.ok, true);
    const encryptedDiskPath = path.join(root, 'vault', upDoc.data.encryptedFilePath);
    const diskBytes = fs.readFileSync(encryptedDiskPath);
    // Stored bytes on disk MUST NOT contain plaintext
    assert.equal(diskBytes.includes(secretPayload), false);

    const readDoc = await invoke(IPC_CHANNELS.CUSTOMERS_READ_DOC, {
      token: agentToken,
      data: { docId: upDoc.data.id },
    });
    assert.equal(readDoc.ok, true);
    assert.equal(readDoc.data.base64Data, secretPayload.toString('base64'));

    // 5. Customer Risk Escalation + Admin-only Resolution
    const addRisk = await invoke(IPC_CHANNELS.CUSTOMERS_ADD_RISK, {
      token: agentToken,
      data: {
        customerId,
        riskLevel: 'BLACKLISTED',
        reason: 'UNPAID_DEBT',
        description: 'Solde impayé suite sinistre mineur',
        incidentDate: '2026-11-10',
      },
    });
    assert.equal(addRisk.ok, true);

    const elig = await invoke(IPC_CHANNELS.CUSTOMERS_CHECK_ELIGIBILITY, {
      token: agentToken,
      data: { customerId, rentalEndDate: '2026-12-20' },
    });
    assert.equal(elig.ok, true);
    assert.equal(elig.data.requiresBlacklistOverride, true);
    assert.equal(elig.data.riskStatus, 'BLACKLISTED');

    // Agent CANNOT resolve blacklist risk record
    const agentResolve = await invoke(IPC_CHANNELS.CUSTOMERS_RESOLVE_RISK, {
      token: agentToken,
      data: {
        riskRecordId: addRisk.data.id,
        resolutionNotes: 'Tentative agent non autorisée',
        nextCustomerRiskStatus: 'LOW',
      },
    });
    assert.equal(agentResolve.ok, false);
    assert.equal(agentResolve.error.code, 'FORBIDDEN');

    // Admin resolves risk record
    const adminResolve = await invoke(IPC_CHANNELS.CUSTOMERS_RESOLVE_RISK, {
      token: adminToken,
      data: {
        riskRecordId: addRisk.data.id,
        resolutionNotes: 'Régularisé en agence avec quittance',
        nextCustomerRiskStatus: 'LOW',
      },
    });
    assert.equal(adminResolve.ok, true);
    assert.equal(adminResolve.data.isResolved, true);
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
