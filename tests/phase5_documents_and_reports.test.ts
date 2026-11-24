import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { IPC_CHANNELS } from '../electron/ipc/contracts.ts';
import { startDesktopKernel, type DesktopKernel } from '../electron/main/appKernel.ts';
import type { DesktopPrintAdapter, PrintPdfRequest, PrintPdfResult } from '../electron/main/printService.ts';
import { createPreloadBridge } from '../electron/preload/bridge.ts';
import { createPreviewExpressApp } from '../server.ts';
import { PREVIEW_ENDPOINTS } from '../shared/api/previewContracts.ts';
import type { DocumentKind } from '../shared/types/domain.ts';

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAALUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    .length > 0
    ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    : '';

function setupDesktop(printAdapter?: DesktopPrintAdapter): {
  root: string;
  kernel: DesktopKernel;
  invoke: (ch: (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS], payload?: any) => Promise<any>;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase5-docs-'));
  const kernel = startDesktopKernel({
    productionDbPath: path.join(root, 'data', 'agency_erp.db'),
    migrationsDir: path.resolve('electron/database/migrations'),
    vaultRootDir: path.join(root, 'vault'),
    printAdapter,
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

async function parsePdfBytes(pdfBytes: Uint8Array): Promise<{
  numPages: number;
  pages: Array<{ width: number; height: number; text: string; normalizedText: string }>;
  fullText: string;
  normalizedFullText: string;
}> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    useWorkerFetch: false,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  const pages: Array<{ width: number; height: number; text: string; normalizedText: string }> = [];

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const text = (content.items as Array<{ str?: string }>)
      .map((item) => item.str ?? '')
      .join(' ');
    pages.push({
      width: viewport.width,
      height: viewport.height,
      text,
      normalizedText: text.normalize('NFKC'),
    });
  }

  if (typeof (doc as any).destroy === 'function') {
    await (doc as any).destroy();
  } else {
    await loadingTask.destroy();
  }
  const fullText = pages.map((p) => p.text).join('\n');
  return {
    numPages: pages.length,
    pages,
    fullText,
    normalizedFullText: fullText.normalize('NFKC'),
  };
}

test('Phase 5 Documents, PDF Engine (FR/AR RTL & Thermal), Immutability, Customer Docs, Printing & Reports via Desktop IPC & Preview API', async () => {
  const printedCalls: PrintPdfRequest[] = [];
  let failNextPrint = false;

  const mockPrintAdapter: DesktopPrintAdapter = {
    async listPrinters() {
      return [
        {
          name: 'HP LaserJet Pro',
          displayName: 'HP LaserJet Pro MFP',
          description: 'Bureau Principal',
          status: 0,
          isDefault: true,
        },
        {
          name: 'EPSON TM-T20III',
          displayName: 'EPSON TM-T20III 80mm',
          description: 'Caisse Thermique',
          status: 0,
          isDefault: false,
        },
      ];
    },
    async printPdf(req: PrintPdfRequest): Promise<PrintPdfResult> {
      printedCalls.push(req);
      if (failNextPrint) {
        throw new Error('Imprimante hors ligne (simulé)');
      }
      return {
        printed: true,
        printerName: req.printerName ?? 'HP LaserJet Pro',
        copies: req.copies ?? 1,
        message: 'Document envoyé avec succès.',
      };
    },
  };

  const { root, kernel, invoke } = setupDesktop(mockPrintAdapter);

  try {
    // 1. Verify Migration 008 schema tables, columns, permissions, and seeded settings
    const genDocCols = kernel.db
      .prepare<[], { name: string }>('PRAGMA table_info(generated_documents)')
      .all()
      .map((r) => r.name);
    for (const col of [
      'is_copy',
      'source_document_id',
      'metadata_snapshot_json',
      'template_snapshot_json',
      'sha256_hash',
      'customer_id',
      'vehicle_id',
      'maintenance_record_id',
      'expense_id',
      'cash_session_id',
      'last_printed_at',
    ]) {
      assert.ok(genDocCols.includes(col), `Missing column ${col} in generated_documents`);
    }

    const invCols = kernel.db
      .prepare<[], { name: string }>('PRAGMA table_info(invoices)')
      .all()
      .map((r) => r.name);
    for (const col of ['discount_minor', 'currency', 'tax_rate_percent', 'notes']) {
      assert.ok(invCols.includes(col), `Missing column ${col} in invoices`);
    }

    const custDocCols = kernel.db
      .prepare<[], { name: string }>('PRAGMA table_info(customer_documents)')
      .all()
      .map((r) => r.name);
    for (const col of [
      'document_number',
      'issue_date',
      'expiration_date',
      'reminder_days',
      'is_archived',
      'replaces_doc_id',
      'replaced_by_doc_id',
    ]) {
      assert.ok(custDocCols.includes(col), `Missing column ${col} in customer_documents`);
    }

    const phase5Perms = kernel.db
      .prepare<[], { code: string }>(
        "SELECT code FROM permissions WHERE code IN ('documents:view', 'documents:reprint', 'documents:manage_templates', 'reports:export')"
      )
      .all()
      .map((r) => r.code);
    assert.equal(phase5Perms.length, 4);

    // 2. Bootstrap Admin & create Agent
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_doc', fullName: 'Admin Documents', password: 'AdminPassword2026!' },
    });
    assert.equal(boot.ok, true);
    const adminToken = boot.data.token as string;

    const agentCreate = await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent_doc',
        fullName: 'Agent Comptoir',
        password: 'AgentPassword2026!',
        roleCode: 'AGENT',
      },
    });
    assert.equal(agentCreate.ok, true);

    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_doc', password: 'AgentPassword2026!' },
    });
    assert.equal(agentLogin.ok, true);
    const agentToken = agentLogin.data.token as string;

    // Configure agency settings (including NIF/RC/NIS/ART and name)
    const setRes = await invoke(IPC_CHANNELS.SETTINGS_UPDATE_BATCH, {
      token: adminToken,
      data: {
        updates: [
          { key: 'agency.name', group: 'agency', value: 'El Djazair Rent Car' },
          { key: 'agency.phone', group: 'agency', value: '+213 21 60 70 80' },
          { key: 'agency.address', group: 'agency', value: 'Hydra, Alger' },
          { key: 'agency.rc', group: 'agency', value: 'RC-16/00-991122' },
          { key: 'agency.nif', group: 'agency', value: '002616009911224' },
          { key: 'agency.nis', group: 'agency', value: '0026160099112' },
          { key: 'agency.art', group: 'agency', value: '1610099112' },
        ],
      },
    });
    assert.equal(setRes.ok, true, JSON.stringify(setRes.error));

    // 3. Seed realistic business data across Fleet, Customers, Cash, Contracts, Inspections, Maintenance, Expenses
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token: adminToken,
      data: {
        internalCode: 'V-P5-01',
        matricule: '00777-126-16',
        brand: 'Dacia',
        model: 'Sandero Stepway',
        year: 2026,
        color: 'Bleu',
        category: 'Compacte',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 12000,
        defaultDailyRateMinor: 700000,
      },
    });
    assert.equal(vRes.ok, true, JSON.stringify(vRes.error));
    const vehicleId = vRes.data.id as number;

    const cRes = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token: adminToken,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Yacine Brahimi',
        phone: '0551998877',
        wilayaCode: '16',
        commune: 'Cheraga',
        cniNumber: '1600112233',
        drivingLicenceNumber: 'DL-16-554433',
        drivingLicenceIssueDate: '2021-01-10',
        drivingLicenceExpirationDate: isoDateDaysOffset(365),
      },
    });
    assert.equal(cRes.ok, true, JSON.stringify(cRes.error));
    const customerId = cRes.data.customer.id as number;

    // Customer doc expiring soon -> alert lifecycle test
    const docSoonDate = isoDateDaysOffset(10);
    const upDoc1 = await invoke(IPC_CHANNELS.CUSTOMERS_UPLOAD_DOC, {
      token: agentToken,
      data: {
        customerId,
        docCategory: 'CNI',
        originalFileName: 'cni_yacine.png',
        mimeType: 'image/png',
        base64Data: SAMPLE_PNG_BASE64,
        documentNumber: 'CNI-16-001122',
        issueDate: '2016-05-01',
        expirationDate: docSoonDate,
        reminderDays: 30,
        notes: 'Première numérisation',
      },
    });
    assert.equal(upDoc1.ok, true, JSON.stringify(upDoc1.error));
    const custDoc1Id = upDoc1.data.id as number;
    assert.equal(upDoc1.data.documentNumber, 'CNI-16-001122');
    assert.equal(upDoc1.data.expirationDate, docSoonDate);
    assert.equal(upDoc1.data.isArchived, false);

    // Update customer doc meta to expired -> CRITICAL alert
    const expiredDate = isoDateDaysOffset(-3);
    const updMeta = await invoke(IPC_CHANNELS.CUSTOMERS_UPDATE_DOC_META, {
      token: agentToken,
      data: {
        docId: custDoc1Id,
        expirationDate: expiredDate,
        notes: 'Expirée il y a 3 jours',
      },
    });
    assert.equal(updMeta.ok, true, JSON.stringify(updMeta.error));
    assert.equal(updMeta.data.expirationDate, expiredDate);

    const syncAlerts1 = await invoke(IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS, {
      token: adminToken,
      data: { referenceDate: isoDateDaysOffset(0) },
    });
    assert.equal(syncAlerts1.ok, true);
    const docAlert = syncAlerts1.data.find(
      (a: any) => a.category === 'CUSTOMER_DOCUMENT' && a.entityId === customerId && a.severity === 'CRITICAL'
    );
    assert.ok(docAlert, 'Expected CRITICAL CUSTOMER_DOCUMENT alert for expired CNI');

    // Non-destructive replacement with valid future expiration -> alert auto-resolves
    const farDate = isoDateDaysOffset(900);
    const upDoc2 = await invoke(IPC_CHANNELS.CUSTOMERS_UPLOAD_DOC, {
      token: agentToken,
      data: {
        customerId,
        docCategory: 'CNI',
        originalFileName: 'cni_yacine_renouvelee.png',
        mimeType: 'image/png',
        base64Data: SAMPLE_PNG_BASE64,
        documentNumber: 'CNI-16-998877',
        issueDate: isoDateDaysOffset(-1),
        expirationDate: farDate,
        reminderDays: 30,
        replaceDocId: custDoc1Id,
      },
    });
    assert.equal(upDoc2.ok, true, JSON.stringify(upDoc2.error));
    assert.equal(upDoc2.data.replacesDocId, custDoc1Id);

    const custProfileAfterReplace = await invoke(IPC_CHANNELS.CUSTOMERS_GET, {
      token: agentToken,
      data: { id: customerId },
    });
    assert.equal(custProfileAfterReplace.ok, true);
    const oldDocRow = custProfileAfterReplace.data.documents.find((d: any) => d.id === custDoc1Id);
    assert.equal(oldDocRow.isArchived, true);
    assert.equal(oldDocRow.replacedByDocId, upDoc2.data.id);

    const syncAlerts2 = await invoke(IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS, {
      token: adminToken,
      data: { referenceDate: isoDateDaysOffset(0) },
    });
    assert.equal(syncAlerts2.ok, true);
    const remainingCritCustDoc = syncAlerts2.data.find(
      (a: any) => a.category === 'CUSTOMER_DOCUMENT' && a.entityId === customerId && !a.isResolved
    );
    assert.equal(remainingCritCustDoc, undefined, 'Replaced customer doc alert should auto-resolve');

    // Archive second doc cleanly
    const archDoc2 = await invoke(IPC_CHANNELS.CUSTOMERS_ARCHIVE_DOC, {
      token: agentToken,
      data: { docId: upDoc2.data.id, reason: 'Doublon test' },
    });
    assert.equal(archDoc2.ok, true);
    assert.equal(archDoc2.data.isArchived, true);

    // Open Cash Session
    const today = isoDateDaysOffset(0);
    const openCash = await invoke(IPC_CHANNELS.FINANCE_CASH_SESSION_OPEN, {
      token: agentToken,
      data: { sessionDate: today, openingBalanceMinor: 5_000_000, openingNotes: 'Ouverture test' },
    });
    assert.equal(openCash.ok, true);
    const cashSessionId = openCash.data.session.id as number;

    // Create Contract with Deposit (caution MUST NOT count as revenue) + Initial Payment
    const cCreate = await invoke(IPC_CHANNELS.CONTRACTS_CREATE, {
      token: agentToken,
      data: {
        customerId,
        vehicleId,
        startDate: `${today}T09:00:00`,
        expectedReturnDate: `${isoDateDaysOffset(4)}T09:00:00`,
        departureOdometerKm: 12000,
        mileageMode: 'UNLIMITED',
        extraKmRateMinor: 0,
        currency: 'DZD',
        baseRentalTotalMinor: 2_800_000, // 28,000 DA
        discountMinor: 0,
        depositAmountMinor: 4_000_000, // 40,000 DA caution (liability!)
        depositCurrency: 'DZD',
        initialPaymentMinor: 1_500_000, // 15,000 DA
        initialPaymentMethod: 'CASH',
        initialStatus: 'ACTIVE',
      },
    });
    assert.equal(cCreate.ok, true, JSON.stringify(cCreate.error));
    const contractId = cCreate.data.contract.id as number;
    const depositId = cCreate.data.deposit.id as number;

    // Fetch payment id for PAYMENT_RECEIPT
    const cDet = await invoke(IPC_CHANNELS.CONTRACTS_GET, {
      token: agentToken,
      data: { id: contractId },
    });
    assert.equal(cDet.ok, true);
    const paymentId = cDet.data.payments[0].id as number;

    // Extend Contract (CONTRACT_AMENDMENT)
    const extRes = await invoke(IPC_CHANNELS.CONTRACTS_EXTEND, {
      token: agentToken,
      data: {
        contractId,
        newReturnDate: `${isoDateDaysOffset(6)}T09:00:00`,
        additionalAmountMinor: 1_400_000,
        additionalKmAllowance: 0,
        notes: 'Prolongation client 2 jours',
      },
    });
    assert.equal(extRes.ok, true, JSON.stringify(extRes.error));
    const extensionId = extRes.data.extensions[0].id as number;

    // Departure & Return Inspections with new damage (for DEPARTURE_INSPECTION, RETURN_INSPECTION, DAMAGE_REPORT)
    const depInsp = await invoke(IPC_CHANNELS.INSPECTIONS_CREATE, {
      token: agentToken,
      data: {
        contractId,
        stage: 'DEPARTURE',
        odometerKm: 12000,
        fuelLevelPercent: 80,
        exteriorNotes: 'Véhicule propre au départ',
        finalizeNow: true,
        items: [
          {
            category: 'EXTERIOR',
            itemKey: 'BODY',
            labelFr: 'Carrosserie',
            labelAr: 'هيكل المركبة',
            condition: 'GOOD',
          },
        ],
      },
    });
    assert.equal(depInsp.ok, true, JSON.stringify(depInsp.error));
    const depInspectionId = depInsp.data.inspection.id as number;

    const retInsp = await invoke(IPC_CHANNELS.INSPECTIONS_CREATE, {
      token: agentToken,
      data: {
        contractId,
        stage: 'RETURN',
        odometerKm: 12650,
        fuelLevelPercent: 60,
        exteriorNotes: 'Rayure pare-chocs arrière droit',
        finalizeNow: true,
        items: [
          {
            category: 'EXTERIOR',
            itemKey: 'BUMPER_REAR',
            labelFr: 'Pare-chocs arrière',
            labelAr: 'الصدام الخلفي',
            condition: 'DAMAGED',
          },
        ],
        damages: [
          {
            zoneCode: 'REAR_BUMPER',
            damageType: 'SCRATCH',
            severity: 'MODERATE',
            description: 'Rayure profonde 15cm',
            isNewlyDiscovered: true,
            estimatedRepairCostMinor: 800_000,
          },
        ],
      },
    });
    assert.equal(retInsp.ok, true, JSON.stringify(retInsp.error));
    const retInspectionId = retInsp.data.inspection.id as number;

    // Settle deposit (partial deduction for damage -> DEPOSIT_SETTLEMENT)
    const settleDep = await invoke(IPC_CHANNELS.FINANCE_SETTLE_DEPOSIT, {
      token: adminToken,
      data: {
        depositId,
        deductedAmountMinor: 800_000,
        refundedAmountMinor: 3_200_000,
        chargeCategory: 'DAMAGE',
        deductionReason: 'Réparation pare-chocs arrière',
        refundMethod: 'CASH',
      },
    });
    assert.equal(settleDep.ok, true, JSON.stringify(settleDep.error));

    // Expense (EXPENSE_RECEIPT) — include formula-like vendor/notes string later or clean description
    const expRes = await invoke(IPC_CHANNELS.FINANCE_RECORD_EXPENSE, {
      token: adminToken,
      data: {
        category: 'CLEANING',
        vehicleId,
        amountMinor: 250_000,
        currency: 'DZD',
        expenseDate: today,
        paymentMethod: 'CASH',
        description: '=HYPERLINK("http://evil") Lavage complet',
      },
    });
    assert.equal(expRes.ok, true, JSON.stringify(expRes.error));
    const expenseId = expRes.data.id as number;

    const expResPlus = await invoke(IPC_CHANNELS.FINANCE_RECORD_EXPENSE, {
      token: adminToken,
      data: {
        category: 'CLEANING',
        vehicleId,
        amountMinor: 50_000,
        currency: 'DZD',
        expenseDate: today,
        paymentMethod: 'BANK_TRANSFER',
        description: '+1+1 Test injection CSV',
      },
    });
    assert.equal(expResPlus.ok, true, JSON.stringify(expResPlus.error));

    // Maintenance record (MAINTENANCE_REPORT)
    const mTypes = await invoke(IPC_CHANNELS.MAINTENANCE_TYPES_LIST, {
      token: agentToken,
      data: { includeInactive: false },
    });
    assert.equal(mTypes.ok, true);
    const mCreate = await invoke(IPC_CHANNELS.MAINTENANCE_CREATE, {
      token: agentToken,
      data: {
        vehicleId,
        maintenanceTypeId: mTypes.data[0].id,
        status: 'COMPLETED',
        workDescription: 'Révision freins et vidange',
        performedDate: today,
        odometerKm: 12650,
        laborCostMinor: 300_000,
        partsCostMinor: 400_000,
        blockVehicle: false,
        recordInFinance: false,
      },
    });
    assert.equal(mCreate.ok, true, JSON.stringify(mCreate.error));
    const maintenanceRecordId = mCreate.data.record.id as number;

    // Close Cash Register Session (CASH_REGISTER_CLOSING)
    const closeCash = await invoke(IPC_CHANNELS.FINANCE_CASH_SESSION_CLOSE, {
      token: agentToken,
      data: {
        sessionId: cashSessionId,
        actualClosingMinor: 6_250_000,
        discrepancyNotes: 'Clôture fin journée',
      },
    });
    assert.equal(closeCash.ok, true, JSON.stringify(closeCash.error));

    // 4. Upload Agency Logo (ADMIN) and enable showLogo + fiscal compliance on INVOICE
    const upLogo = await invoke(IPC_CHANNELS.DOCUMENTS_LOGO_UPLOAD, {
      token: adminToken,
      data: {
        originalFileName: 'logo_agence.png',
        mimeType: 'image/png',
        base64Data: SAMPLE_PNG_BASE64,
      },
    });
    assert.equal(upLogo.ok, true, JSON.stringify(upLogo.error));
    assert.ok(upLogo.data.logoVaultPath.includes('agency_logo_'));

    const readLogo = await invoke(IPC_CHANNELS.DOCUMENTS_LOGO_READ, { token: agentToken });
    assert.equal(readLogo.ok, true);
    assert.equal(readLogo.data.mimeType, 'image/png');

    // Toggle fiscal compliance ON and TVA 19%
    const updTpl = await invoke(IPC_CHANNELS.DOCUMENTS_TEMPLATES_UPDATE, {
      token: adminToken,
      data: {
        showLogo: true,
        invoiceFiscallyCompliant: true,
        invoiceTaxRatePercent: 19,
        footerFr: 'Mention légale personnalisée 2026',
      },
    });
    assert.equal(updTpl.ok, true);
    assert.equal(updTpl.data.invoiceFiscallyCompliant, true);
    assert.equal(updTpl.data.invoiceTaxRatePercent, 19);

    // 5. Generate & Archive ALL 16 DocumentKinds
    const allKindsToParams: Array<{ kind: DocumentKind; params: Record<string, any> }> = [
      { kind: 'RENTAL_CONTRACT', params: { contractId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'CONTRACT_AMENDMENT', params: { contractId, extensionId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'DEPARTURE_INSPECTION', params: { inspectionId: depInspectionId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'RETURN_INSPECTION', params: { inspectionId: retInspectionId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'DAMAGE_REPORT', params: { contractId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'PAYMENT_RECEIPT', params: { paymentId, format: 'THERMAL_80MM', language: 'fr' } },
      { kind: 'DEPOSIT_RECEIPT', params: { depositId, format: 'THERMAL_58MM', language: 'fr' } },
      { kind: 'DEPOSIT_SETTLEMENT', params: { depositId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'INVOICE', params: { contractId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'EXPENSE_RECEIPT', params: { expenseId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'MAINTENANCE_REPORT', params: { maintenanceRecordId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'VEHICLE_HISTORY', params: { vehicleId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'CUSTOMER_STATEMENT', params: { customerId, format: 'A4_PDF', language: 'fr' } },
      { kind: 'CASH_REGISTER_CLOSING', params: { cashSessionId, format: 'THERMAL_80MM', language: 'fr' } },
      {
        kind: 'FINANCIAL_SUMMARY',
        params: {
          format: 'A4_LANDSCAPE_PDF',
          language: 'fr',
          dateFrom: isoDateDaysOffset(-7),
          dateTo: isoDateDaysOffset(7),
        },
      },
      {
        kind: 'CUSTOM_REPORT',
        params: {
          format: 'A4_LANDSCAPE_PDF',
          language: 'fr',
          reportFilter: {
            category: 'CUSTOM',
            dateFrom: isoDateDaysOffset(-7),
            dateTo: isoDateDaysOffset(7),
            includeSections: ['revenue_payments', 'fleet_utilization', 'contracts'],
          },
        },
      },
    ];

    const generatedDocs = new Map<DocumentKind, any>();
    for (const item of allKindsToParams) {
      const res = await invoke(IPC_CHANNELS.DOCUMENTS_GENERATE, {
        token: agentToken,
        data: { documentKind: item.kind, ...item.params },
      });
      assert.equal(res.ok, true, `Failed generating ${item.kind}: ${JSON.stringify(res.error)}`);
      generatedDocs.set(item.kind, res.data);

      // Verify vault encrypted file exists and is non-empty
      const absVaultFile = path.join(root, 'vault', res.data.document.filePath);
      assert.ok(fs.existsSync(absVaultFile), `Vault file missing for ${item.kind}`);
      const pdfBytes = Buffer.from(res.data.pdfBase64, 'base64');
      assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');
    }

    // Verify INVOICE record created in DB with TVA 19% + isFiscallyCompliant = true
    const invResult = generatedDocs.get('INVOICE');
    assert.ok(invResult.invoice);
    assert.equal(invResult.invoice.isFiscallyCompliant, true);
    assert.equal(invResult.invoice.taxRatePercent, 19);
    const invParsed = await parsePdfBytes(Buffer.from(invResult.pdfBase64, 'base64'));
    assert.ok(invParsed.fullText.includes('RC-16/00-991122'));
    assert.ok(invParsed.fullText.includes('002616009911224'));

    // Verify all 4 format dimensions with real pdfjs-dist parser
    const a4Parsed = await parsePdfBytes(Buffer.from(generatedDocs.get('RENTAL_CONTRACT').pdfBase64, 'base64'));
    assert.ok(Math.abs(a4Parsed.pages[0].width - 595.28) < 2, `A4 width: ${a4Parsed.pages[0].width}`);
    assert.ok(Math.abs(a4Parsed.pages[0].height - 841.89) < 2, `A4 height: ${a4Parsed.pages[0].height}`);

    const landscapeParsed = await parsePdfBytes(
      Buffer.from(generatedDocs.get('FINANCIAL_SUMMARY').pdfBase64, 'base64')
    );
    assert.ok(landscapeParsed.pages[0].width > landscapeParsed.pages[0].height, 'Expected landscape width > height');
    assert.ok(Math.abs(landscapeParsed.pages[0].width - 841.89) < 2);

    const t80Parsed = await parsePdfBytes(Buffer.from(generatedDocs.get('PAYMENT_RECEIPT').pdfBase64, 'base64'));
    assert.ok(Math.abs(t80Parsed.pages[0].width - 226.77) < 2, `80mm width: ${t80Parsed.pages[0].width}`);

    const t58Parsed = await parsePdfBytes(Buffer.from(generatedDocs.get('DEPOSIT_RECEIPT').pdfBase64, 'base64'));
    assert.ok(Math.abs(t58Parsed.pages[0].width - 164.41) < 2, `58mm width: ${t58Parsed.pages[0].width}`);

    // 6. Arabic RTL PDF + Eastern Numerals + LTR token preservation check
    const arContractRes = await invoke(IPC_CHANNELS.DOCUMENTS_GENERATE, {
      token: agentToken,
      data: {
        documentKind: 'RENTAL_CONTRACT',
        contractId,
        format: 'A4_PDF',
        language: 'ar',
        numeralSystem: 'arabic',
      },
    });
    assert.equal(arContractRes.ok, true, JSON.stringify(arContractRes.error));
    const arParsed = await parsePdfBytes(Buffer.from(arContractRes.data.pdfBase64, 'base64'));
    // Note: Arabic shaper uses Presentation Forms B; normalize('NFKC') folds back to standard Arabic letters
    assert.ok(
      arParsed.normalizedFullText.includes('عقد') || arParsed.normalizedFullText.includes('كراء'),
      `Expected Arabic text in PDF, got: ${arParsed.normalizedFullText.slice(0, 200)}`
    );
    // Technical LTR matricule & contract number MUST NOT be reversed inside RTL Arabic text
    assert.ok(
      arParsed.normalizedFullText.includes('00777-126-16'),
      'Matricule 00777-126-16 should stay intact (not reversed) in Arabic PDF'
    );
    assert.ok(
      arParsed.normalizedFullText.includes(cDet.data.contract.contractNumber),
      'Contract number should stay intact (not reversed) in Arabic PDF'
    );

    // 7. Original vs Certified Copy Immutability & Snapshot Frozen Verification
    const origContract = generatedDocs.get('RENTAL_CONTRACT').document;
    const origVaultPath = path.join(root, 'vault', origContract.filePath);
    const origBytesBefore = fs.readFileSync(origVaultPath);
    const origEncSha256Before = crypto.createHash('sha256').update(origBytesBefore).digest('hex');

    // Mutate customer name & vehicle color in DB AFTER original archival
    const mutCust = await invoke(IPC_CHANNELS.CUSTOMERS_UPDATE, {
      token: adminToken,
      data: { id: customerId, fullName: 'NOM MODIFIE APRES COUP' },
    });
    assert.equal(mutCust.ok, true);

    const reprintRes = await invoke(IPC_CHANNELS.DOCUMENTS_REPRINT, {
      token: agentToken,
      data: { sourceDocumentId: origContract.id },
    });
    assert.equal(reprintRes.ok, true, JSON.stringify(reprintRes.error));
    const copyDoc = reprintRes.data.document;
    assert.equal(copyDoc.isCopy, true);
    assert.equal(copyDoc.sourceDocumentId, origContract.id);
    assert.equal(copyDoc.documentNumber, `${origContract.documentNumber}-C01`);

    // Verify original encrypted file bytes untouched & reprintCount incremented
    const origBytesAfter = fs.readFileSync(origVaultPath);
    const origEncSha256After = crypto.createHash('sha256').update(origBytesAfter).digest('hex');
    assert.equal(origEncSha256After, origEncSha256Before);

    const origMetaAfter = await invoke(IPC_CHANNELS.DOCUMENTS_GET, {
      token: agentToken,
      data: { id: origContract.id },
    });
    assert.equal(origMetaAfter.ok, true);
    assert.equal(origMetaAfter.data.reprintCount, 1);

    // Decrypted copy PDF MUST render watermark + ORIGINAL frozen name ("Yacine Brahimi"), NOT mutated name!
    const copyParsed = await parsePdfBytes(Buffer.from(reprintRes.data.pdfBase64, 'base64'));
    assert.ok(copyParsed.fullText.includes('COPIE CONFORME'));
    assert.ok(copyParsed.fullText.includes('Yacine Brahimi'));
    assert.equal(copyParsed.fullText.includes('NOM MODIFIE APRES COUP'), false);

    // Missing vault file -> clean NOT_FOUND error on DOCUMENTS_READ
    const arVaultPath = path.join(root, 'vault', arContractRes.data.document.filePath);
    fs.unlinkSync(arVaultPath);
    const missingRead = await invoke(IPC_CHANNELS.DOCUMENTS_READ, {
      token: agentToken,
      data: { id: arContractRes.data.document.id },
    });
    assert.equal(missingRead.ok, false);
    assert.equal(missingRead.error.code, 'NOT_FOUND');

    // 8. Printing adapter & audit verification
    const printersRes = await invoke(IPC_CHANNELS.DOCUMENTS_LIST_PRINTERS, { token: agentToken });
    assert.equal(printersRes.ok, true);
    assert.equal(printersRes.data.length, 2);
    assert.equal(printersRes.data[0].name, 'HP LaserJet Pro');

    const printSuccess = await invoke(IPC_CHANNELS.DOCUMENTS_PRINT, {
      token: agentToken,
      data: {
        documentId: origContract.id,
        printerName: 'HP LaserJet Pro',
        silent: true,
        copies: 2,
      },
    });
    assert.equal(printSuccess.ok, true, JSON.stringify(printSuccess.error));
    assert.equal(printedCalls.length, 1);
    assert.equal(printedCalls[0].printerName, 'HP LaserJet Pro');
    assert.equal(printedCalls[0].copies, 2);
    assert.ok(printSuccess.data.document.lastPrintedAt);

    // Audit log recorded DOCUMENT_PRINTED
    const printLogs = kernel.db
      .prepare<[], any>("SELECT * FROM audit_logs WHERE operation = 'DOCUMENT_PRINTED'")
      .all();
    assert.equal(printLogs.length, 1);

    // Failing print returns clean error and does not emit extra audit row
    failNextPrint = true;
    const printFail = await invoke(IPC_CHANNELS.DOCUMENTS_PRINT, {
      token: agentToken,
      data: { documentId: origContract.id, printerName: 'HP LaserJet Pro', copies: 1 },
    });
    assert.equal(printFail.ok, false);
    failNextPrint = false;

    const printLogsAfterFail = kernel.db
      .prepare<[], any>("SELECT * FROM audit_logs WHERE operation = 'DOCUMENT_PRINTED'")
      .all();
    assert.equal(printLogsAfterFail.length, 1);

    // 9. Multi-page pagination check via PDF export of dense CUSTOM_REPORT
    // Add 35 extra expenses to force multi-page table pagination cleanly
    for (let i = 0; i < 35; i += 1) {
      const r = await invoke(IPC_CHANNELS.FINANCE_RECORD_EXPENSE, {
        token: adminToken,
        data: {
          category: 'ADMINISTRATIVE',
          vehicleId,
          amountMinor: 10_000 + i * 100,
          currency: 'DZD',
          expenseDate: today,
          paymentMethod: 'BANK_TRANSFER',
          description: `Frais pagination dossier #${i + 1}`,
        },
      });
      assert.equal(r.ok, true);
    }

    const multiPagePdf = await invoke(IPC_CHANNELS.REPORTS_EXPORT_FILE, {
      token: adminToken,
      data: {
        filter: {
          category: 'FINANCIAL',
          dateFrom: isoDateDaysOffset(-7),
          dateTo: isoDateDaysOffset(7),
        },
        exportFormat: 'PDF',
        pdfFormat: 'A4_PDF',
        language: 'fr',
        numeralSystem: 'latin',
      },
    });
    assert.equal(multiPagePdf.ok, true, JSON.stringify(multiPagePdf.error));
    const multiParsed = await parsePdfBytes(Buffer.from(multiPagePdf.data.base64Data, 'base64'));
    assert.ok(multiParsed.numPages >= 2, `Expected multi-page report (>=2), got ${multiParsed.numPages}`);

    // 10. Centralized Reports (ALL categories) + Caution exclusion + CSV Formula Neutralization + ExcelJS XLSX validation
    for (const category of ['FINANCIAL', 'FLEET', 'OPERATIONAL', 'CUSTOM'] as const) {
      const rep = await invoke(IPC_CHANNELS.REPORTS_GENERATE, {
        token: adminToken,
        data: {
          category,
          dateFrom: isoDateDaysOffset(-7),
          dateTo: isoDateDaysOffset(7),
          language: 'fr',
        },
      });
      assert.equal(rep.ok, true, `Report ${category} failed`);
      assert.ok(rep.data.sections.length >= 1);
    }

    // Verify Caution (40,000 DA) is EXCLUDED from rental revenue KPI (contracted = 28,000 + 14,000 ext = 42,000 DA)
    const finReport = await invoke(IPC_CHANNELS.REPORTS_GENERATE, {
      token: adminToken,
      data: {
        category: 'FINANCIAL',
        dateFrom: isoDateDaysOffset(-7),
        dateTo: isoDateDaysOffset(7),
        language: 'fr',
      },
    });
    assert.equal(finReport.ok, true);
    const contractedKpi = finReport.data.kpis.find((k: any) => k.key === 'contracted_revenue');
    assert.ok(contractedKpi);
    assert.equal(contractedKpi.numericValue, 42_000); // 4,200,000 minor = 42,000 DA (deposit 40,000 DA strictly excluded)

    // CSV Export check: UTF-8 BOM + Formula Injection Neutralization ('=HYPERLINK...)
    const csvExport = await invoke(IPC_CHANNELS.REPORTS_EXPORT_FILE, {
      token: adminToken,
      data: {
        filter: { category: 'FINANCIAL', dateFrom: isoDateDaysOffset(-7), dateTo: isoDateDaysOffset(7) },
        exportFormat: 'CSV',
        language: 'fr',
        numeralSystem: 'latin',
      },
    });
    assert.equal(csvExport.ok, true);
    const csvText = Buffer.from(csvExport.data.base64Data, 'base64').toString('utf8');
    assert.ok(csvText.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');
    assert.ok(csvText.includes("'=HYPERLINK"), 'Formula injection starting with = must be prefixed with single quote');
    assert.ok(csvText.includes("'+1+1 Test injection CSV"), 'Formula injection starting with + must be neutralized');

    // ExcelJS XLSX check: numeric cells + Arabic RTL sheet view + formula neutralization
    const xlsxExportAr = await invoke(IPC_CHANNELS.REPORTS_EXPORT_FILE, {
      token: adminToken,
      data: {
        filter: { category: 'FINANCIAL', dateFrom: isoDateDaysOffset(-7), dateTo: isoDateDaysOffset(7) },
        exportFormat: 'XLSX',
        language: 'ar',
        numeralSystem: 'latin',
      },
    });
    assert.equal(xlsxExportAr.ok, true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xlsxExportAr.data.base64Data, 'base64') as any);
    assert.ok(wb.worksheets.length >= 2);
    const summarySheet = wb.worksheets[0];
    assert.equal(summarySheet.views[0]?.rightToLeft, true, 'Arabic XLSX worksheet must enable rightToLeft');

    // Find a numeric KPI value cell & verify numeric type + neutralized string in expenses sheet
    let foundNumericCell = false;
    summarySheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'number' && cell.value === 42000) {
          foundNumericCell = true;
        }
      });
    });
    assert.ok(foundNumericCell, 'Expected numeric KPI cell 42000 in XLSX summary sheet');

    let foundNeutralizedFormulaInXlsx = false;
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string' && cell.value.startsWith("'=HYPERLINK")) {
            foundNeutralizedFormulaInXlsx = true;
          }
        });
      });
    }
    assert.ok(foundNeutralizedFormulaInXlsx, 'Expected neutralized formula text in XLSX');

    // 11. Desktop IPC RBAC boundary: AGENT forbidden on Admin-only endpoints
    const agentTplUpdate = await invoke(IPC_CHANNELS.DOCUMENTS_TEMPLATES_UPDATE, {
      token: agentToken,
      data: { footerFr: 'Tentative agent' },
    });
    assert.equal(agentTplUpdate.ok, false);
    assert.equal(agentTplUpdate.error.code, 'FORBIDDEN');

    const agentLogoUpload = await invoke(IPC_CHANNELS.DOCUMENTS_LOGO_UPLOAD, {
      token: agentToken,
      data: { originalFileName: 'x.png', mimeType: 'image/png', base64Data: SAMPLE_PNG_BASE64 },
    });
    assert.equal(agentLogoUpload.ok, false);
    assert.equal(agentLogoUpload.error.code, 'FORBIDDEN');

    const agentReportGen = await invoke(IPC_CHANNELS.REPORTS_GENERATE, {
      token: agentToken,
      data: { category: 'FINANCIAL' },
    });
    assert.equal(agentReportGen.ok, false);
    assert.equal(agentReportGen.error.code, 'FORBIDDEN');

    const agentReportExp = await invoke(IPC_CHANNELS.REPORTS_EXPORT_FILE, {
      token: agentToken,
      data: { filter: { category: 'FINANCIAL' }, exportFormat: 'CSV', language: 'fr' },
    });
    assert.equal(agentReportExp.ok, false);
    assert.equal(agentReportExp.error.code, 'FORBIDDEN');

    // 12. Preview Express API isolation & Phase 5 HTTP endpoint RBAC verification
    const preview = createPreviewExpressApp(path.join(root, 'preview_isolated_p5', 'preview.sqlite'));
    const server = preview.app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', () => resolve());
        server.once('error', reject);
      });
      const addr = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${addr.port}`;

      // Bootstrap admin in isolated preview DB
      const pBoot = await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'prev_admin',
          fullName: 'Preview Admin',
          password: 'PreviewPassword2026!',
        }),
      }).then((r) => r.json());
      assert.equal(pBoot.ok, true);
      const prevAdminToken = pBoot.data.token as string;

      // Create Agent in preview DB
      const pAgentCreate = await fetch(`${base}${PREVIEW_ENDPOINTS.USERS}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${prevAdminToken}`,
        },
        body: JSON.stringify({
          username: 'prev_agent',
          fullName: 'Preview Agent',
          password: 'AgentPreview2026!',
          roleCode: 'AGENT',
        }),
      }).then((r) => r.json());
      assert.equal(pAgentCreate.ok, true);

      const pAgentLogin = await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_LOGIN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'prev_agent', password: 'AgentPreview2026!' }),
      }).then((r) => r.json());
      assert.equal(pAgentLogin.ok, true);
      const prevAgentToken = pAgentLogin.data.token as string;

      // Verify Preview Agent receives HTTP 403 FORBIDDEN on Admin-only template/logo/report routes
      const prevTplForbidden = await fetch(`${base}${PREVIEW_ENDPOINTS.DOCUMENTS}/templates`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${prevAgentToken}`,
        },
        body: JSON.stringify({ footerFr: 'Blocked' }),
      });
      assert.equal(prevTplForbidden.status, 403);

      const prevRepForbidden = await fetch(`${base}${PREVIEW_ENDPOINTS.REPORTS}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${prevAgentToken}`,
        },
        body: JSON.stringify({ filter: { category: 'FINANCIAL' }, exportFormat: 'CSV', language: 'fr' }),
      });
      assert.equal(prevRepForbidden.status, 403);

      // Verify Preview Admin succeeds on REPORTS /generate & /export and DOCUMENTS /templates
      const prevRepOk = await fetch(`${base}${PREVIEW_ENDPOINTS.REPORTS}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${prevAdminToken}`,
        },
        body: JSON.stringify({ category: 'FLEET', language: 'fr' }),
      });
      assert.equal(prevRepOk.status, 200);
      const prevRepJson = await prevRepOk.json();
      assert.equal(prevRepJson.ok, true);

      // Verify desktop documents are completely isolated from preview DB
      const prevDocList = await fetch(`${base}${PREVIEW_ENDPOINTS.DOCUMENTS}`, {
        headers: { Authorization: `Bearer ${prevAdminToken}` },
      }).then((r) => r.json());
      assert.equal(prevDocList.ok, true);
      assert.equal(prevDocList.data.length, 0, 'Preview DB must remain isolated from Desktop documents');
    } finally {
      server.close();
      if (preview.db.open) preview.db.close();
      fs.rmSync(path.dirname(preview.previewDbPath), { recursive: true, force: true });
    }
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
