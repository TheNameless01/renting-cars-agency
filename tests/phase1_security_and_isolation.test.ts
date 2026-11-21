import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveDatabasePath } from '../electron/database/connection.ts';
import { startDesktopKernel } from '../electron/main/appKernel.ts';
import { buildSecureWindowOptions, isAllowedRendererNavigation } from '../electron/main/windowConfig.ts';
import { createPreloadBridge, isAllowedIpcChannel } from '../electron/preload/bridge.ts';
import {
  decryptBuffer,
  encryptBuffer,
  getOrCreateLocalVaultKey,
  resolveConfinedPath,
} from '../electron/security/crypto.ts';
import { IPC_CHANNELS } from '../electron/ipc/contracts.ts';
import { createPreviewExpressApp } from '../server.ts';

test('Database scope strictly isolates browser preview temp DB from desktop production DB', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-iso-test-'));
  try {
    const prodPath = path.join(tempRoot, 'desktop_user_data', 'agency_erp.db');
    const resolvedProd = resolveDatabasePath({ scope: 'desktop_production', productionDbPath: prodPath });
    const resolvedPreview = resolveDatabasePath({ scope: 'browser_preview_temp' });

    assert.equal(resolvedProd, path.resolve(prodPath));
    assert.ok(resolvedPreview.startsWith(os.tmpdir()));
    assert.notEqual(resolvedPreview, resolvedProd);
    assert.throws(() => resolveDatabasePath({ scope: 'desktop_production' }));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Desktop and Preview databases & authentication sessions remain completely isolated', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-dual-iso-'));
  const desktopKernel = startDesktopKernel({
    productionDbPath: path.join(tempRoot, 'desktop', 'agency.db'),
    migrationsDir: path.resolve('electron/database/migrations'),
    vaultRootDir: path.join(tempRoot, 'desktop', 'vault'),
  });
  const preview = createPreviewExpressApp(path.join(tempRoot, 'preview', 'temp_preview.sqlite'));

  try {
    // Bootstrap desktop admin
    const desktopBoot = await desktopKernel.handlers[IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN]({
      data: { username: 'desktop_admin', fullName: 'Desktop Owner', password: 'StrongDesktopPassword1!' },
    });
    assert.equal(desktopBoot.ok, true);

    // Preview DB MUST still show needsBootstrap: true (zero visibility into desktop DB)
    const previewStatus = preview.db.prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM users').get();
    assert.equal(previewStatus?.cnt, 0);

    // Desktop session token MUST NOT exist in preview SessionStore
    const desktopToken = (desktopBoot.data as { token: string }).token;
    assert.equal(preview.previewSessionStore.get(desktopToken), null);
  } finally {
    desktopKernel.shutdown();
    preview.db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Vault encryption round-trip and path traversal protection', () => {
  const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-vault-test-'));
  try {
    const key = getOrCreateLocalVaultKey(tempVault);
    assert.equal(key.length, 32);

    const sensitiveCni = Buffer.from('CNI-ALGERIA-SECRET-IMAGE-BYTES-123456', 'utf8');
    const encrypted = encryptBuffer(sensitiveCni, key);
    assert.notEqual(encrypted.toString('utf8'), sensitiveCni.toString('utf8'));
    const decrypted = decryptBuffer(encrypted, key);
    assert.deepEqual(decrypted, sensitiveCni);

    // Tampered ciphertext must fail authentication tag check
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;
    assert.throws(() => decryptBuffer(tampered, key));

    // Path traversal blocked
    assert.throws(() => resolveConfinedPath(tempVault, '../outside.txt'), /SECURITY_PATH_TRAVERSAL_BLOCKED/);
    assert.throws(() => resolveConfinedPath(tempVault, '/etc/passwd'), /SECURITY_PATH_TRAVERSAL_BLOCKED/);
    const safeFile = resolveConfinedPath(tempVault, 'customers/cni_01.enc');
    assert.ok(safeFile.startsWith(tempVault + path.sep));
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

test('Electron BrowserWindow security options and Preload IPC channel allowlist', async () => {
  const opts = buildSecureWindowOptions('electron/preload/index.js');
  assert.equal(opts.webPreferences?.contextIsolation, true);
  assert.equal(opts.webPreferences?.nodeIntegration, false);
  assert.equal(opts.webPreferences?.sandbox, true);
  assert.equal(opts.webPreferences?.webSecurity, true);
  assert.equal(opts.webPreferences?.allowRunningInsecureContent, false);

  assert.equal(isAllowedRendererNavigation('file:///app/dist/index.html', false), true);
  assert.equal(isAllowedRendererNavigation('https://evil.example.com/steal', false), false);
  assert.equal(isAllowedRendererNavigation('javascript:alert(1)', true, 'http://localhost:3000'), false);

  let invoked = false;
  const bridge = createPreloadBridge(async () => {
    invoked = true;
    return { ok: true };
  });

  // Unregistered channel must be blocked before calling ipcRenderer
  const blocked = await bridge.invoke('unsafe:shellExec' as any, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error?.code, 'FORBIDDEN');
  assert.equal(invoked, false);

  assert.equal(isAllowedIpcChannel(IPC_CHANNELS.AUTH_LOGIN), true);
  assert.equal(isAllowedIpcChannel('arbitrary:channel'), false);
});
