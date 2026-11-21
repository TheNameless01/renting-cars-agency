import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IPC_CHANNELS } from '../electron/ipc/contracts.ts';
import { startDesktopKernel, type DesktopKernel } from '../electron/main/appKernel.ts';
import { createPreloadBridge } from '../electron/preload/bridge.ts';

function setupKernel(): { root: string; kernel: DesktopKernel; invoke: (ch: any, payload?: any) => Promise<any> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase2-ui-fixes-'));
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

function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsxFiles(full));
    } else if (entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

test('Dialog & UI architecture invariants: centralized ModalDialog, z-index layering, sticky switcher, and zero legacy modals', () => {
  const srcRoot = path.resolve('src');
  const files = collectTsxFiles(srcRoot);

  const legacyOverlayFiles: string[] = [];
  for (const file of files) {
    const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');
    if (
      rel !== 'components/ModalDialog.tsx' &&
      rel !== 'features/auth/LockOverlay.tsx' &&
      rel !== 'components/Toast.tsx'
    ) {
      if (/fixed\s+inset-0/.test(content) || /\bz-50\b/.test(content)) {
        legacyOverlayFiles.push(rel);
      }
    }
  }
  assert.deepEqual(
    legacyOverlayFiles,
    [],
    `Found leftover unmigrated raw fixed overlays or z-50 modals: ${legacyOverlayFiles.join(', ')}`
  );

  const modalSrc = fs.readFileSync(path.join(srcRoot, 'components/ModalDialog.tsx'), 'utf8');
  assert.ok(modalSrc.includes('createPortal'), 'ModalDialog must render via React portal to document.body');
  assert.ok(modalSrc.includes("document.body.style.overflow = 'hidden'"), 'ModalDialog must lock body scroll');
  assert.ok(modalSrc.includes('max-h-[calc(100dvh-'), 'ModalDialog must clamp panel height to dynamic viewport');
  assert.ok(modalSrc.includes('overflow-y-auto overscroll-contain'), 'ModalDialog body must scroll internally');
  assert.ok(modalSrc.includes("e.key === 'Escape'"), 'ModalDialog must handle Escape on topmost modal');
  assert.ok(modalSrc.includes('previousFocusRef'), 'ModalDialog must preserve original trigger focus across nested dialogs');
  assert.ok(modalSrc.includes('dir={dir}'), 'ModalDialog must propagate RTL/LTR dir attribute');

  const toastSrc = fs.readFileSync(path.join(srcRoot, 'components/Toast.tsx'), 'utf8');
  assert.ok(toastSrc.includes('z-[250]'), 'Toast must sit above modals and lock overlay');

  const lockSrc = fs.readFileSync(path.join(srcRoot, 'features/auth/LockOverlay.tsx'), 'utf8');
  assert.ok(lockSrc.includes('z-[200]'), 'LockOverlay must sit above modals');
  assert.ok(lockSrc.includes('createPortal'), 'LockOverlay must portal to document.body');

  const cssSrc = fs.readFileSync(path.join(srcRoot, 'index.css'), 'utf8');
  assert.ok(cssSrc.includes('color-scheme: light'), 'CSS must configure light color-scheme for native controls');
  assert.ok(cssSrc.includes('color-scheme: dark'), 'CSS must configure dark color-scheme for native controls');

  // Verify CustomersPage and CustomerProfilePage place INDIVIDUAL/COMPANY toggle in sticky subHeader
  for (const custFile of ['features/customers/CustomersPage.tsx', 'features/customers/CustomerProfilePage.tsx']) {
    const content = fs.readFileSync(path.join(srcRoot, custFile), 'utf8');
    assert.ok(content.includes('subHeader={'), `${custFile} must pin customer type switcher inside ModalDialog subHeader`);
    assert.ok(content.includes('bonDeCommandeNumber'), `${custFile} must expose bonDeCommandeNumber input`);
  }

  // Verify NewContractWizardPage does not re-run initial fetch when customerId/vehicleId change
  const wizardSrc = fs.readFileSync(path.join(srcRoot, 'features/contracts/NewContractWizardPage.tsx'), 'utf8');
  assert.ok(
    !wizardSrc.includes('[customerId, vehicleId, showError'),
    'NewContractWizardPage initial settings fetch must not depend on [customerId, vehicleId]'
  );
  assert.ok(wizardSrc.includes('ConfirmDialog'), 'NewContractWizardPage must confirm handover/blacklist overrides');

  // Verify ConfirmDialog usage on critical pages
  for (const guardedPage of [
    'features/vehicles/VehicleProfilePage.tsx',
    'features/customers/CustomerProfilePage.tsx',
    'features/planning/PlanningPage.tsx',
    'features/contracts/ContractDetailPage.tsx',
    'features/contracts/ContractsPage.tsx',
  ]) {
    const content = fs.readFileSync(path.join(srcRoot, guardedPage), 'utf8');
    assert.ok(content.includes('ConfirmDialog'), `${guardedPage} must use ConfirmDialog for critical actions`);
  }
});

test('Phase 2 Dialog backend workflows: vehicle doc edit by id, customer type round-trip, reservation update/cancel, and contract extension check', async () => {
  const { root, kernel, invoke } = setupKernel();

  try {
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_dlg', fullName: 'Admin Dialogs', password: 'AdminPassword2026!' },
    });
    assert.equal(boot.ok, true);
    const token = boot.data.token as string;

    // 1. Vehicle creation & editing existing document by id (no duplicate row created)
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token,
      data: {
        internalCode: 'V-DLG-1',
        matricule: '00456-124-16',
        vin: 'VF1TEST00000456',
        brand: 'Dacia',
        model: 'Stepway',
        year: 2025,
        color: 'Gris',
        category: 'Compacte',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 12000,
        defaultDailyRateMinor: 650000,
      },
    });
    assert.equal(vRes.ok, true);
    const vehicleId = vRes.data.id as number;

    const doc1 = await invoke(IPC_CHANNELS.VEHICLES_UPSERT_DOC, {
      token,
      data: {
        vehicleId,
        docType: 'ASSURANCE',
        documentNumber: 'ASSUR-001',
        issueDate: '2026-01-01',
        expirationDate: '2027-01-01',
        reminderDays: 30,
      },
    });
    assert.equal(doc1.ok, true);

    const doc1Updated = await invoke(IPC_CHANNELS.VEHICLES_UPSERT_DOC, {
      token,
      data: {
        id: doc1.data.id,
        vehicleId,
        docType: 'ASSURANCE',
        documentNumber: 'ASSUR-001-REV2',
        issueDate: '2026-01-01',
        expirationDate: '2027-06-01',
        reminderDays: 45,
      },
    });
    assert.equal(doc1Updated.ok, true);
    assert.equal(doc1Updated.data.id, doc1.data.id);
    assert.equal(doc1Updated.data.documentNumber, 'ASSUR-001-REV2');

    // 2. Customer INDIVIDUAL <-> COMPANY round-trip switching & bonDeCommandeNumber persistence
    const custCreate = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token,
      data: {
        customerType: 'COMPANY',
        fullName: 'Karim Ziani',
        phone: '0550998877',
        wilayaCode: '16',
        company: {
          companyName: 'EURL Horizon Mobility',
          legalRepresentative: 'Karim Ziani',
          rcNumber: '16/00-112233B25',
          bonDeCommandeNumber: 'BC-2026-09',
        },
      },
    });
    assert.equal(custCreate.ok, true);
    const customerId = custCreate.data.customer.id as number;
    assert.equal(custCreate.data.company.bonDeCommandeNumber, 'BC-2026-09');

    // Switch COMPANY -> INDIVIDUAL
    const switchToInd = await invoke(IPC_CHANNELS.CUSTOMERS_UPDATE, {
      token,
      data: {
        id: customerId,
        customerType: 'INDIVIDUAL',
        fullName: 'Karim Ziani',
        phone: '0550998877',
        company: null,
      },
    });
    assert.equal(switchToInd.ok, true);
    assert.equal(switchToInd.data.customer.customerType, 'INDIVIDUAL');
    assert.equal(switchToInd.data.company, null);

    // Switch back INDIVIDUAL -> COMPANY
    const switchBackToComp = await invoke(IPC_CHANNELS.CUSTOMERS_UPDATE, {
      token,
      data: {
        id: customerId,
        customerType: 'COMPANY',
        fullName: 'Karim Ziani',
        phone: '0550998877',
        company: {
          companyName: 'SARL Horizon Plus',
          legalRepresentative: 'Karim Ziani',
          bonDeCommandeNumber: 'BC-2026-10',
        },
      },
    });
    assert.equal(switchBackToComp.ok, true);
    assert.equal(switchBackToComp.data.customer.customerType, 'COMPANY');
    assert.equal(switchBackToComp.data.company.companyName, 'SARL Horizon Plus');
    assert.equal(switchBackToComp.data.company.bonDeCommandeNumber, 'BC-2026-10');

    // 3. Reservation edit (status + notes) & Cancel confirmation backend
    const resCreate = await invoke(IPC_CHANNELS.RESERVATIONS_CREATE, {
      token,
      data: {
        customerId,
        vehicleId,
        startDate: '2026-07-01T09:00',
        expectedReturnDate: '2026-07-04T09:00',
        estimatedTotalMinor: 1950000,
        status: 'PENDING',
        notes: 'Initial note',
      },
    });
    assert.equal(resCreate.ok, true);

    const resEdit = await invoke(IPC_CHANNELS.RESERVATIONS_UPDATE_STATUS, {
      token,
      data: {
        reservationId: resCreate.data.id,
        status: 'CONFIRMED',
        notes: 'Confirmed with client by phone',
      },
    });
    assert.equal(resEdit.ok, true);
    assert.equal(resEdit.data.status, 'CONFIRMED');
    assert.equal(resEdit.data.notes, 'Confirmed with client by phone');

    const resCancel = await invoke(IPC_CHANNELS.RESERVATIONS_UPDATE_STATUS, {
      token,
      data: {
        reservationId: resCreate.data.id,
        status: 'CANCELLED',
      },
    });
    assert.equal(resCancel.ok, true);
    assert.equal(resCancel.data.status, 'CANCELLED');

    // 4. Contract creation, availability exclusion during extension, and completion
    const contractRes = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token,
      data: {
        customerId,
        vehicleId,
        startDate: '2026-08-01T10:00',
        expectedReturnDate: '2026-08-04T10:00',
        departureOdometerKm: 12000,
        mileageMode: 'DAILY_ALLOWANCE',
        dailyMileageAllowanceKm: 300,
        extraKmRateMinor: 1500,
        currency: 'DZD',
        baseRentalTotalMinor: 1950000,
        discountMinor: 0,
        depositAmountMinor: 5000000,
        depositCurrency: 'DZD',
        initialPaymentMinor: 500000,
        initialPaymentMethod: 'CASH',
        initialStatus: 'ACTIVE',
      },
    });
    assert.equal(contractRes.ok, true);
    const contractId = contractRes.data.contract.id as number;

    const extAvail = await invoke(IPC_CHANNELS.PLANNING_CHECK_AVAILABILITY, {
      token,
      data: {
        vehicleId,
        startDate: '2026-08-04T10:00',
        endDate: '2026-08-06T10:00',
        excludeContractId: contractId,
      },
    });
    assert.equal(extAvail.ok, true);
    assert.equal(extAvail.data.available, true);

    const extRes = await invoke(IPC_CHANNELS.CONTRACTS_EXTEND, {
      token,
      data: {
        contractId,
        newReturnDate: '2026-08-06T10:00',
        additionalAmountMinor: 1300000,
        additionalKmAllowance: 600,
        notes: 'Client extended 2 days',
      },
    });
    assert.equal(extRes.ok, true);
    assert.equal(extRes.data.contract.originalEndDate, '2026-08-04T10:00');
    assert.equal(extRes.data.contract.expectedReturnDate, '2026-08-06T10:00');

    const compRes = await invoke(IPC_CHANNELS.CONTRACTS_COMPLETE, {
      token,
      data: {
        contractId,
        actualReturnDate: '2026-08-06T10:30',
        returnOdometerKm: 13700, // 1700 km driven, 1500 km included => 200 km extra
        lateFeeMinor: 0,
        damageChargeMinor: 0,
        otherChargesMinor: 0,
      },
    });
    assert.equal(compRes.ok, true);
    assert.equal(compRes.data.contract.status, 'COMPLETED');
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Live preview server (port 3000) serves HTML app shell cleanly', async () => {
  const res = await fetch('http://127.0.0.1:3000/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<div id="root"></div>'), 'HTML shell must contain React root mount');
});
