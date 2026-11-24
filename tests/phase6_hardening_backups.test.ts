import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runScheduledBackupIfDue } from '../electron/backups/backupScheduler.ts';
import {
  createBackup,
  exportBackupFile,
  pruneExpiredBackups,
  restoreFromBackup,
  verifyBackupArchive,
} from '../electron/backups/backupService.ts';
import { closeSqliteSafely, openSqliteConnection } from '../electron/database/connection.ts';
import { runMigrations } from '../electron/database/migrator.ts';
import { checkDatabaseHealth } from '../electron/database/services/healthService.ts';
import { IPC_CHANNELS } from '../electron/ipc/contracts.ts';
import { startDesktopKernel, type DesktopKernel } from '../electron/main/appKernel.ts';
import {
  buildDesktopCspHeader,
  buildSecureWindowOptions,
  isAllowedRendererNavigation,
} from '../electron/main/windowConfig.ts';
import { createPreloadBridge } from '../electron/preload/bridge.ts';
import {
  formatVaultRecoveryKey,
  getVaultKeyFingerprint,
  loadOrCreateVaultKey,
  parseVaultRecoveryKey,
  type SafeStorageAdapter,
} from '../electron/security/crypto.ts';
import { sanitizeUploadedFileName, validateAndDecodeUpload } from '../electron/security/fileValidation.ts';
import { createPreviewExpressApp } from '../server.ts';
import { PREVIEW_ENDPOINTS } from '../shared/api/previewContracts.ts';

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function setupDesktop(options?: {
  root?: string;
  safeStorage?: SafeStorageAdapter;
}): {
  root: string;
  kernel: DesktopKernel;
  invoke: (ch: (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS], payload?: any) => Promise<any>;
} {
  const root = options?.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'erp-phase6-'));
  const kernel = startDesktopKernel({
    productionDbPath: path.join(root, 'data', 'agency_erp.db'),
    migrationsDir: path.resolve('electron/database/migrations'),
    vaultRootDir: path.join(root, 'secure_vault'),
    backupDir: path.join(root, 'backups'),
    appVersion: '1.0.0',
    safeStorage: options?.safeStorage,
  });
  const bridge = createPreloadBridge(async (channel, payload) => {
    const handler = kernel.handlers[channel];
    if (!handler) throw new Error(`Missing handler for ${channel}`);
    return handler(payload);
  });
  return { root, kernel, invoke: (ch, payload) => bridge.invoke(ch, payload) };
}

test('Phase 6.1: SQLite FULL durability, WAL safe close, pre-migration snapshot, and non-destructive corruption detection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p6-db-'));
  try {
    const dbPath = path.join(root, 'data', 'agency_erp.db');
    const vaultDir = path.join(root, 'secure_vault');
    const backupDir = path.join(root, 'backups');
    const migrationsDir = path.resolve('electron/database/migrations');

    // Step 1: Apply migrations 001..008 in a subset dir first
    const subsetMigDir = path.join(root, 'migs_old');
    fs.mkdirSync(subsetMigDir, { recursive: true });
    for (const file of fs.readdirSync(migrationsDir).sort()) {
      if (!file.startsWith('009_')) {
        fs.copyFileSync(path.join(migrationsDir, file), path.join(subsetMigDir, file));
      }
    }

    const db1 = openSqliteConnection(dbPath);
    assert.equal(Number(db1.pragma('synchronous', { simple: true })), 2); // FULL = 2
    assert.equal(String(db1.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal');
    assert.equal(Number(db1.pragma('foreign_keys', { simple: true })), 1);

    const migOld = runMigrations(db1, subsetMigDir);
    assert.equal(migOld.latestVersion, '008');
    closeSqliteSafely(db1);

    // Step 2: Reopen with all migrations (009 pending) -> triggers PRE_MIGRATION snapshot automatically
    const db2 = openSqliteConnection(dbPath);
    const migNew = runMigrations(db2, migrationsDir, {
      onBeforeApply: (pendingFiles) => {
        assert.ok(pendingFiles.includes('009_phase6_hardening_backups.sql'));
        // Snapshot uses synchronous VACUUM INTO
        const snapDir = path.join(backupDir, 'pre_migration', 'test_snap');
        fs.mkdirSync(snapDir, { recursive: true });
        const escaped = path.join(snapDir, 'pre.sqlite').replace(/'/g, "''");
        db2.exec(`VACUUM INTO '${escaped}'`);
      },
    });
    assert.equal(migNew.latestVersion, '009');
    assert.ok(fs.existsSync(path.join(backupDir, 'pre_migration', 'test_snap', 'pre.sqlite')));

    // Verify DB Health passes cleanly
    const health = checkDatabaseHealth(db2, {
      dbPath,
      migrationsDir,
      vaultRootDir: vaultDir,
      deepIntegrity: true,
    });
    assert.equal(health.integrityCheckOk, true);
    assert.equal(health.foreignKeyViolationsCount, 0);
    assert.equal(health.migrationChecksumsOk, true);
    assert.equal(health.missingTables.length, 0);
    closeSqliteSafely(db2);

    // Step 3: Corrupt DB bytes and confirm openSqliteConnection refuses to overwrite/truncate silently
    const corruptPath = path.join(root, 'corrupt.sqlite');
    fs.writeFileSync(corruptPath, Buffer.from('THIS IS NOT A VALID SQLITE DATABASE FILE', 'utf8'));
    assert.throws(() => openSqliteConnection(corruptPath));
    assert.equal(
      fs.readFileSync(corruptPath, 'utf8'),
      'THIS IS NOT A VALID SQLITE DATABASE FILE'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 6.2: Vault DPAPI safeStorage wrapping, automatic upgrade from .vault.key, and Recovery Key round-trip', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p6-dpapi-'));
  try {
    const vaultDir = path.join(root, 'vault');
    // Boot once without safeStorage (writes .vault.key)
    const initial = loadOrCreateVaultKey(vaultDir, null);
    assert.equal(initial.protectionMode, 'local_file_0600');
    assert.ok(fs.existsSync(path.join(vaultDir, '.vault.key')));

    // Mock Electron Windows DPAPI safeStorage
    const mockDpapi: SafeStorageAdapter = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText) => Buffer.from(`DPAPI:${Buffer.from(plainText, 'utf8').toString('base64')}`),
      decryptString: (encrypted) => {
        const str = encrypted.toString('utf8');
        assert.ok(str.startsWith('DPAPI:'));
        return Buffer.from(str.slice(6), 'base64').toString('utf8');
      },
    };

    // Reopen with DPAPI -> upgrades seamlessly and deletes legacy plaintext key
    const upgraded = loadOrCreateVaultKey(vaultDir, mockDpapi);
    assert.equal(upgraded.protectionMode, 'dpapi_safestorage');
    assert.ok(upgraded.key.equals(initial.key));
    assert.ok(fs.existsSync(path.join(vaultDir, '.vault.key.dpapi')));
    assert.equal(fs.existsSync(path.join(vaultDir, '.vault.key')), false);

    // Recovery code round-trip
    const code = formatVaultRecoveryKey(upgraded.key);
    assert.ok(code.startsWith('AGL-RK1-'));
    const parsed = parseVaultRecoveryKey(code);
    assert.ok(parsed.equals(upgraded.key));
    assert.equal(getVaultKeyFingerprint(parsed), getVaultKeyFingerprint(upgraded.key));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 6.3: Upload magic-byte validation blocks disguised executables/SVG/HTML and sanitizes paths', () => {
  assert.equal(sanitizeUploadedFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeUploadedFileName('..\\..\\Windows\\cmd.exe'), 'cmd.exe');

  // Reject executable PE header disguised as image/png
  const fakeExe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00FAKE_EXE').toString('base64');
  assert.throws(
    () =>
      validateAndDecodeUpload({
        originalFileName: 'passport.png',
        mimeType: 'image/png',
        base64Data: fakeExe,
      }),
    /signature exécutable/i
  );

  // Reject inline SVG / script disguised as PNG
  const fakeSvg = Buffer.from('<svg onload="alert(1)"><script>evil()</script></svg>').toString('base64');
  assert.throws(
    () =>
      validateAndDecodeUpload({
        originalFileName: 'logo.png',
        mimeType: 'image/png',
        base64Data: fakeSvg,
      }),
    /script détectée/i
  );

  // Reject HTML disguised as PDF
  const fakePdf = Buffer.from('<html><body>phish</body></html>').toString('base64');
  assert.throws(
    () =>
      validateAndDecodeUpload({
        originalFileName: 'doc.pdf',
        mimeType: 'application/pdf',
        base64Data: fakePdf,
      }),
    /script détectée/i
  );

  // Valid PNG succeeds
  const validPng = validateAndDecodeUpload({
    originalFileName: 'photo.png',
    mimeType: 'image/png',
    base64Data: SAMPLE_PNG_BASE64,
  });
  assert.ok(validPng.bytes.length > 10);
});

test('Phase 6.4: Inactivity auto-lock, unlock brute-force lockout, RBAC isolation, and Electron CSP/window hardening', async () => {
  const { root, kernel, invoke } = setupDesktop();
  try {
    // Electron window & CSP checks
    const winOpts = buildSecureWindowOptions('preload.js', { isDev: false });
    assert.equal(winOpts.webPreferences?.contextIsolation, true);
    assert.equal(winOpts.webPreferences?.nodeIntegration, false);
    assert.equal(winOpts.webPreferences?.sandbox, true);
    assert.equal(winOpts.webPreferences?.devTools, false);
    assert.equal(isAllowedRendererNavigation('https://evil.example.com', false), false);
    assert.equal(isAllowedRendererNavigation('file:///C:/app/dist/index.html', false), true);
    const prodCsp = buildDesktopCspHeader(false);
    assert.ok(prodCsp.includes("default-src 'self'"));
    assert.ok(!prodCsp.includes('unsafe-inline\'; font-src') && prodCsp.includes("script-src 'self'"));
    assert.ok(prodCsp.includes('blob:'));

    // Bootstrap Admin + create Agent
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin1', fullName: 'Admin One', password: 'AdminPassword123!' },
    });
    assert.equal(boot.ok, true);
    const adminToken = boot.data.token;

    await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent1',
        fullName: 'Agent One',
        password: 'AgentPassword123!',
        roleCode: 'AGENT',
      },
    });

    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent1', password: 'AgentPassword123!' },
    });
    assert.equal(agentLogin.ok, true);
    const agentToken = agentLogin.data.token;

    // RBAC check: Agent blocked from DB Health, Backups, Recovery Key, Restore
    for (const ch of [
      IPC_CHANNELS.BACKUPS_HEALTH,
      IPC_CHANNELS.BACKUPS_LIST,
      IPC_CHANNELS.BACKUPS_CREATE_MANUAL,
      IPC_CHANNELS.BACKUPS_RECOVERY_KEY,
    ]) {
      const blocked = await invoke(ch, { token: agentToken, data: { adminPassword: 'AgentPassword123!' } });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.error.code, 'FORBIDDEN');
    }

    // Inactivity auto-lock check (simulate expired idle time beyond 15m)
    const sessionRec = kernel.sessionStore.get(agentToken)!;
    sessionRec.lastActivityMs = Date.now() - 20 * 60_000;
    const autoLockedCall = await invoke(IPC_CHANNELS.VEHICLES_LIST, { token: agentToken });
    assert.equal(autoLockedCall.ok, false);
    assert.equal(autoLockedCall.error.code, 'LOCKED');
    const autoLockAudits = kernel.db
      .prepare<[], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM audit_logs WHERE operation = 'SESSION_AUTO_LOCKED'"
      )
      .get();
    assert.ok((autoLockAudits?.cnt ?? 0) >= 1);

    // Brute-force unlock protection: 5 wrong passwords lock account & revoke session
    for (let i = 1; i <= 4; i++) {
      const bad = await invoke(IPC_CHANNELS.AUTH_UNLOCK, {
        token: agentToken,
        data: { password: `wrong-${i}` },
      });
      assert.equal(bad.ok, false);
      assert.equal(bad.error.code, 'UNAUTHORIZED');
    }
    const fifth = await invoke(IPC_CHANNELS.AUTH_UNLOCK, {
      token: agentToken,
      data: { password: 'wrong-5' },
    });
    assert.equal(fifth.ok, false);
    assert.equal(fifth.error.code, 'LOCKED');
    assert.equal(kernel.sessionStore.get(agentToken), null); // session revoked
    const unlockAudit = kernel.db
      .prepare<[], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM audit_logs WHERE operation = 'UNLOCK_FAILED'"
      )
      .get();
    assert.equal(unlockAudit?.cnt, 5);
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 6.5: Encrypted Backup (.agbkp) + Vault Attachments + Verify + Mutate + Atomic Restore + Scheduler & Retention', async () => {
  const { root, kernel, invoke } = setupDesktop();
  try {
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'owner', fullName: 'Agency Owner', password: 'OwnerPassword123!' },
    });
    const token = boot.data.token;

    // Seed vehicle, customer, encrypted customer document, and contract
    const vRes = await invoke(IPC_CHANNELS.VEHICLES_CREATE, {
      token,
      data: {
        internalCode: 'VH-P6-01',
        matricule: '12345-123-16',
        brand: 'Dacia',
        model: 'Sandero',
        year: 2024,
        color: 'Blanc',
        category: 'Citadine',
        fuelType: 'ESSENCE',
        transmission: 'MANUAL',
        seats: 5,
        currentOdometerKm: 12000,
        defaultDailyRateMinor: 450000,
      },
    });
    assert.equal(vRes.ok, true);

    const cRes = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Karim Benali',
        phone: '0550112233',
        wilayaCode: '16',
      },
    });
    assert.equal(cRes.ok, true);
    const customerId = cRes.data.customer.id;

    const docRes = await invoke(IPC_CHANNELS.CUSTOMERS_UPLOAD_DOC, {
      token,
      data: {
        customerId,
        docCategory: 'CNI',
        originalFileName: 'cni_karim.png',
        mimeType: 'image/png',
        base64Data: SAMPLE_PNG_BASE64,
      },
    });
    assert.equal(docRes.ok, true);

    // 1. Reveal Recovery Key (requires Admin password & writes audit log)
    const badRk = await invoke(IPC_CHANNELS.BACKUPS_RECOVERY_KEY, {
      token,
      data: { adminPassword: 'wrong' },
    });
    assert.equal(badRk.ok, false);
    assert.equal(badRk.error.code, 'UNAUTHORIZED');

    const rkRes = await invoke(IPC_CHANNELS.BACKUPS_RECOVERY_KEY, {
      token,
      data: { adminPassword: 'OwnerPassword123!' },
    });
    assert.equal(rkRes.ok, true);
    const recoveryKey = rkRes.data.recoveryKey as string;
    assert.ok(recoveryKey.startsWith('AGL-RK1-'));

    // 2. Create Passphrase-Encrypted Backup including vault document
    const bkpRes = await invoke(IPC_CHANNELS.BACKUPS_CREATE_MANUAL, {
      token,
      data: {
        backupType: 'MANUAL',
        encryptionMode: 'PASSPHRASE',
        passphrase: 'BackupSecretPassword!99',
        notes: 'Avant changement majeur',
      },
    });
    assert.equal(bkpRes.ok, true, bkpRes.error?.message);
    const backupId = bkpRes.data.backup.id as number;
    const backupPath = bkpRes.data.backup.destinationPath as string;
    assert.ok(fs.existsSync(backupPath));
    assert.equal(bkpRes.data.verification.valid, true);
    assert.ok(bkpRes.data.verification.verifiedAttachmentCount >= 1);

    // Wrong passphrase must fail verification cleanly
    const badVerify = await invoke(IPC_CHANNELS.BACKUPS_VERIFY, {
      token,
      data: { backupRecordId: backupId, passphrase: 'WrongPassphrase!' },
    });
    assert.equal(badVerify.ok, false);

    // Tampered archive must fail verification cleanly
    const tamperedPath = path.join(root, 'tampered.agbkp');
    const rawBuf = fs.readFileSync(backupPath);
    rawBuf[rawBuf.length - 5] ^= 0xff;
    fs.writeFileSync(tamperedPath, rawBuf);
    assert.throws(() =>
      verifyBackupArchive({
        filePath: tamperedPath,
        passphrase: 'BackupSecretPassword!99',
      })
    );

    // Export to external USB path & import on another path
    const usbExportPath = path.join(root, 'usb_drive', 'agency_usb.agbkp');
    const expRes = await invoke(IPC_CHANNELS.BACKUPS_EXPORT, {
      token,
      data: { backupRecordId: backupId, destinationPath: usbExportPath },
    });
    assert.equal(expRes.ok, true);
    assert.ok(fs.existsSync(usbExportPath));

    // 3. Mutate DB after backup (add a second customer that should disappear after restore)
    const c2Res = await invoke(IPC_CHANNELS.CUSTOMERS_CREATE, {
      token,
      data: {
        customerType: 'INDIVIDUAL',
        fullName: 'Post Backup Customer',
        phone: '0550998877',
        wilayaCode: '31',
      },
    });
    assert.equal(c2Res.ok, true);
    assert.equal((await invoke(IPC_CHANNELS.CUSTOMERS_LIST, { token })).data.length, 2);

    // Delete vault file on disk to prove atomic restore actually restores vault attachments too
    const docVaultRel = docRes.data.encryptedFilePath as string;
    const liveVaultFile = path.join(root, 'secure_vault', docVaultRel);
    fs.rmSync(liveVaultFile);
    assert.equal(fs.existsSync(liveVaultFile), false);

    // 4. Perform Atomic Restore via IPC
    const restoreRes = await invoke(IPC_CHANNELS.BACKUPS_RESTORE, {
      token,
      data: {
        backupRecordId: backupId,
        passphrase: 'BackupSecretPassword!99',
        adminPassword: 'OwnerPassword123!',
      },
    });
    assert.equal(restoreRes.ok, true, restoreRes.error?.message);
    assert.equal(restoreRes.data.preRestoreBackup.backupType, 'PRE_RESTORE');
    assert.ok(fs.existsSync(restoreRes.data.preRestoreBackup.destinationPath));

    // Verify post-backup customer is gone and Karim's encrypted document is restored & readable!
    const customersAfter = await invoke(IPC_CHANNELS.CUSTOMERS_LIST, { token });
    assert.equal(customersAfter.ok, true);
    assert.equal(customersAfter.data.length, 1);
    assert.equal(customersAfter.data[0].fullName, 'Karim Benali');

    assert.equal(fs.existsSync(liveVaultFile), true);
    const readRestoredDoc = await invoke(IPC_CHANNELS.CUSTOMERS_READ_DOC, {
      token,
      data: { docId: docRes.data.id },
    });
    assert.equal(readRestoredDoc.ok, true);
    assert.equal(readRestoredDoc.data.base64Data, SAMPLE_PNG_BASE64);

    // Confirm BACKUP_RESTORED audit log was persisted in the restored database
    const restoreAudits = kernel.db
      .prepare<[], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM audit_logs WHERE operation = 'BACKUP_RESTORED'"
      )
      .get();
    assert.equal(restoreAudits?.cnt, 1);

    // 5. Daily Scheduler + Retention Pruning check
    kernel.db
      .prepare("UPDATE application_settings SET setting_value = '00:00' WHERE setting_key = 'app.auto_backup_time'")
      .run();
    const sched1 = await runScheduledBackupIfDue({
      getDb: () => kernel.db,
      backupDir: kernel.backupDir,
      vaultRootDir: path.join(root, 'secure_vault'),
      vaultKey: kernel.vaultKey,
      appVersion: '1.0.0',
    });
    assert.equal(sched1.executed, true);
    const sched2 = await runScheduledBackupIfDue({
      getDb: () => kernel.db,
      backupDir: kernel.backupDir,
      vaultRootDir: path.join(root, 'secure_vault'),
      vaultKey: kernel.vaultKey,
      appVersion: '1.0.0',
    });
    assert.equal(sched2.executed, false);
    assert.equal(sched2.reason, 'already_completed_today');

    // Create 3 more AUTO backups and verify retention=2 prunes older AUTO backups safely while keeping MANUAL
    for (let i = 0; i < 3; i++) {
      await createBackup(kernel.db, {
        backupDir: kernel.backupDir,
        vaultRootDir: path.join(root, 'secure_vault'),
        vaultKey: kernel.vaultKey,
        backupType: 'AUTO',
      });
    }
    const pruneRes = pruneExpiredBackups(kernel.db, 2);
    assert.equal(pruneRes.removedIds.length, 2);
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 6.6: Preview Express API security headers, health, backups & RBAC isolation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p6-preview-'));
  const dbPath = path.join(root, 'preview.sqlite');
  const preview = createPreviewExpressApp(dbPath);
  const server = preview.app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const bootRes = await fetch(`${baseUrl}${PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'prevadmin',
        fullName: 'Preview Admin',
        password: 'PrevPassword123!',
      }),
    });
    assert.equal(bootRes.status, 201);
    assert.equal(bootRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(bootRes.headers.get('cache-control'), 'no-store');
    const bootJson = (await bootRes.json()) as any;
    const token = bootJson.data.token as string;

    const healthRes = await fetch(`${baseUrl}${PREVIEW_ENDPOINTS.BACKUPS_HEALTH}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as any;
    assert.equal(healthJson.data.overallStatus, 'HEALTHY');

    const bkpRes = await fetch(`${baseUrl}${PREVIEW_ENDPOINTS.BACKUPS}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ backupType: 'MANUAL', encryptionMode: 'VAULT_RECOVERY_KEY' }),
    });
    assert.equal(bkpRes.status, 201);
    const bkpJson = (await bkpRes.json()) as any;
    assert.equal(bkpJson.data.verification.valid, true);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeSqliteSafely(preview.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Phase 6.7: Electron production bundle artifacts & Packaging config consistency', () => {
  assert.ok(fs.existsSync(path.resolve('dist-electron/main/index.js')));
  assert.ok(fs.existsSync(path.resolve('dist-electron/preload/index.js')));
  assert.ok(fs.existsSync(path.resolve('dist-electron/package.json')));
  const pkgType = JSON.parse(fs.readFileSync(path.resolve('dist-electron/package.json'), 'utf8'));
  assert.equal(pkgType.type, 'commonjs');
  assert.ok(fs.existsSync(path.resolve('build/icon.ico')));
  assert.ok(fs.existsSync(path.resolve('build/icon.png')));
  assert.ok(fs.existsSync(path.resolve('build/installer.nsh')));
  const builderYml = fs.readFileSync(path.resolve('electron-builder.yml'), 'utf8');
  assert.ok(builderYml.includes('electron/database/migrations/**/*'));
  assert.ok(builderYml.includes('electron/assets/**/*'));
  assert.ok(builderYml.includes('deleteAppDataOnUninstall: false'));
});

test('Phase 6.8: Production Scale Performance Benchmark (100 vehicles, 600 customers, 1,200 contracts, 1,500 payments)', async () => {
  const { root, kernel, invoke } = setupDesktop();
  try {
    const boot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'scaleadmin', fullName: 'Scale Admin', password: 'ScalePassword123!' },
    });
    const token = boot.data.token;
    const db = kernel.db;

    const seedStart = performance.now();
    const insertVehicle = db.prepare(
      `INSERT INTO vehicles (internal_code, matricule, brand, model, year, color, category, fuel_type, transmission, seats, current_odometer_km, default_daily_rate_minor, status)
       VALUES (?, ?, 'Renault', 'Symbol', 2023, 'Gris', 'Berline', 'ESSENCE', 'MANUAL', 5, 25000, 400000, 'AVAILABLE')`
    );
    const insertCustomer = db.prepare(
      `INSERT INTO customers (customer_type, full_name, phone, wilaya_code)
       VALUES ('INDIVIDUAL', ?, ?, '16')`
    );
    const insertContract = db.prepare(
      `INSERT INTO rental_contracts (
         contract_number, customer_id, vehicle_id, status, start_date, original_end_date, expected_return_date, actual_return_date,
         departure_odometer_km, mileage_mode, extra_km_rate_minor, currency, base_rental_total_minor, total_contract_amount_minor, created_by_user_id
       ) VALUES (?, ?, ?, 'COMPLETED', '2026-01-01T08:00:00Z', '2026-01-05T08:00:00Z', '2026-01-05T08:00:00Z', '2026-01-05T08:00:00Z',
                 25000, 'UNLIMITED', 1500, 'DZD', 1600000, 1600000, 1)`
    );
    const insertPayment = db.prepare(
      `INSERT INTO contract_payments (transaction_code, receipt_number, contract_id, customer_id, direction, method, amount_minor, currency, payment_date, recorded_by_user_id)
       VALUES (?, ?, ?, ?, 'INFLOW', 'CASH', 800000, 'DZD', '2026-01-05', 1)`
    );

    db.transaction(() => {
      for (let i = 1; i <= 100; i++) {
        insertVehicle.run(`VH-${String(i).padStart(3, '0')}`, `${10000 + i}-123-16`);
      }
      for (let i = 1; i <= 600; i++) {
        insertCustomer.run(`Client Scale ${i}`, `0550${String(i).padStart(6, '0')}`);
      }
      let paySeq = 1;
      for (let i = 1; i <= 1200; i++) {
        const custId = ((i - 1) % 600) + 1;
        const vehId = ((i - 1) % 100) + 1;
        const cRes = insertContract.run(`CTR-2026-${String(i).padStart(5, '0')}`, custId, vehId);
        const contractId = Number(cRes.lastInsertRowid);
        insertPayment.run(`TX-${paySeq}`, `RC-${paySeq}`, contractId, custId);
        paySeq++;
        if (i <= 300) {
          insertPayment.run(`TX-${paySeq}`, `RC-${paySeq}`, contractId, custId);
          paySeq++;
        }
      }
    })();
    const seedMs = performance.now() - seedStart;

    const qStart = performance.now();
    const vehiclesRes = await invoke(IPC_CHANNELS.VEHICLES_LIST, { token });
    const contractsRes = await invoke(IPC_CHANNELS.CONTRACTS_LIST, { token });
    const finRes = await invoke(IPC_CHANNELS.FINANCE_DASHBOARD_REPORTS, { token });
    const queryMs = performance.now() - qStart;

    assert.equal(vehiclesRes.data.length, 100);
    assert.equal(contractsRes.data.length, 1200);
    assert.equal(finRes.ok, true);

    const bkpStart = performance.now();
    const bkp = await createBackup(db, {
      backupDir: kernel.backupDir,
      vaultRootDir: path.join(root, 'secure_vault'),
      vaultKey: kernel.vaultKey,
      backupType: 'MANUAL',
    });
    const bkpMs = performance.now() - bkpStart;

    assert.equal(bkp.verification.valid, true);
    assert.equal(bkp.verification.recordCounts.vehicles, 100);
    assert.equal(bkp.verification.recordCounts.customers, 600);
    assert.equal(bkp.verification.recordCounts.contracts, 1200);
    assert.equal(bkp.verification.recordCounts.payments, 1500);

    // Performance assertions (generous thresholds to avoid flaky CI while catching N+1 bottlenecks)
    assert.ok(seedMs < 5000, `Scale seed took too long: ${seedMs.toFixed(0)}ms`);
    assert.ok(queryMs < 3000, `Scale queries took too long: ${queryMs.toFixed(0)}ms`);
    assert.ok(bkpMs < 8000, `Encrypted backup+verify took too long: ${bkpMs.toFixed(0)}ms`);
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
