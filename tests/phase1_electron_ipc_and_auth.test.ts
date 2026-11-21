import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IPC_CHANNELS } from '../electron/ipc/contracts.ts';
import { startDesktopKernel, type DesktopKernel } from '../electron/main/appKernel.ts';
import { createPreloadBridge } from '../electron/preload/bridge.ts';

function setupKernel(): { root: string; kernel: DesktopKernel; invoke: (ch: any, payload?: any) => Promise<any> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-desktop-ipc-'));
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

test('Desktop Kernel startup, 69-wilaya seed, first-run Admin bootstrap, lock/unlock, logout, and RBAC enforcement', async () => {
  const { root, kernel, invoke } = setupKernel();

  try {
    // 1. Initial status requires bootstrap
    const status1 = await invoke(IPC_CHANNELS.AUTH_STATUS);
    assert.equal(status1.ok, true);
    assert.equal(status1.data.needsBootstrap, true);
    assert.equal(status1.data.runtimeMode, 'desktop');

    // 2. Malformed bootstrap rejected by Zod
    const badBoot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'a', fullName: 'X', password: '123' },
    });
    assert.equal(badBoot.ok, false);
    assert.equal(badBoot.error.code, 'VALIDATION_ERROR');

    // 3. First-run Admin bootstrap succeeds
    const bootRes = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'admin_dz', fullName: 'Directeur Agence', password: 'AdminPassword2026!' },
    });
    assert.equal(bootRes.ok, true);
    const adminToken = bootRes.data.token;
    assert.equal(bootRes.data.user.roleCode, 'ADMIN');

    // 4. Second bootstrap attempt rejected with CONFLICT
    const dupBoot = await invoke(IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN, {
      data: { username: 'rogue', fullName: 'Rogue', password: 'RoguePassword123!' },
    });
    assert.equal(dupBoot.ok, false);
    assert.equal(dupBoot.error.code, 'CONFLICT');

    // 5. Verify 69 wilayas seeded including 11 newly created 2026 wilayas
    const wilayasRes = await invoke(IPC_CHANNELS.WILAYAS_LIST, { token: adminToken });
    assert.equal(wilayasRes.ok, true);
    assert.equal(wilayasRes.data.length, 69);
    const created2026 = wilayasRes.data.filter((w: any) => w.isNewlyCreated2026);
    assert.equal(created2026.length, 11);
    assert.equal(created2026.find((w: any) => w.code === '59')?.parentWilayaCode, '03');
    assert.equal(created2026.find((w: any) => w.code === '69')?.parentWilayaCode, '32');

    // 6. Admin edits wilaya 59 (editable reference requirement)
    const editWilaya = await invoke(IPC_CHANNELS.WILAYAS_UPSERT, {
      token: adminToken,
      data: {
        code: '59',
        nameFr: 'Aflou',
        nameAr: 'أفلو',
        isNewlyCreated2026: true,
        parentWilayaCode: '03',
        decreeReference: 'Loi n° 26-06 / Décret 26-206',
        effectiveYear: 2026,
        isActive: true,
        notes: 'Vérifiée Journal Officiel 2026',
      },
    });
    assert.equal(editWilaya.ok, true);
    assert.equal(editWilaya.data.notes, 'Vérifiée Journal Officiel 2026');

    // 7. Admin creates an AGENT user
    const createAgent = await invoke(IPC_CHANNELS.USERS_CREATE, {
      token: adminToken,
      data: {
        username: 'agent_1',
        fullName: 'Karim Benali',
        password: 'AgentPassword2026!',
        roleCode: 'AGENT',
      },
    });
    assert.equal(createAgent.ok, true);
    assert.equal(createAgent.data.roleCode, 'AGENT');

    // 8. Lock & Unlock session enforcement
    const lockRes = await invoke(IPC_CHANNELS.AUTH_LOCK, { token: adminToken });
    assert.equal(lockRes.ok, true);

    const blockedWhileLocked = await invoke(IPC_CHANNELS.USERS_LIST, { token: adminToken });
    assert.equal(blockedWhileLocked.ok, false);
    assert.equal(blockedWhileLocked.error.code, 'LOCKED');

    const badUnlock = await invoke(IPC_CHANNELS.AUTH_UNLOCK, {
      token: adminToken,
      data: { password: 'WrongPassword!' },
    });
    assert.equal(badUnlock.ok, false);
    assert.equal(badUnlock.error.code, 'UNAUTHORIZED');

    const goodUnlock = await invoke(IPC_CHANNELS.AUTH_UNLOCK, {
      token: adminToken,
      data: { password: 'AdminPassword2026!' },
    });
    assert.equal(goodUnlock.ok, true);

    const allowedAfterUnlock = await invoke(IPC_CHANNELS.USERS_LIST, { token: adminToken });
    assert.equal(allowedAfterUnlock.ok, true);
    assert.equal(allowedAfterUnlock.data.length, 2);

    // 9. Logout revokes session
    const logoutRes = await invoke(IPC_CHANNELS.AUTH_LOGOUT, { token: adminToken });
    assert.equal(logoutRes.ok, true);
    const afterLogout = await invoke(IPC_CHANNELS.USERS_LIST, { token: adminToken });
    assert.equal(afterLogout.ok, false);
    assert.equal(afterLogout.error.code, 'UNAUTHORIZED');

    // 10. Agent logs in and backend enforces RBAC restrictions
    const agentLogin = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_1', password: 'AgentPassword2026!' },
    });
    assert.equal(agentLogin.ok, true);
    const agentToken = agentLogin.data.token;

    // Agent CAN read settings and wilayas
    const agentSettingsRead = await invoke(IPC_CHANNELS.SETTINGS_GET_ALL, { token: agentToken });
    assert.equal(agentSettingsRead.ok, true);

    // Agent CANNOT access Admin-only endpoints (enforced on backend, NOT UI-only)
    const agentListUsers = await invoke(IPC_CHANNELS.USERS_LIST, { token: agentToken });
    assert.equal(agentListUsers.ok, false);
    assert.equal(agentListUsers.error.code, 'FORBIDDEN');

    const agentMutateSettings = await invoke(IPC_CHANNELS.SETTINGS_UPDATE_BATCH, {
      token: agentToken,
      data: { updates: [{ key: 'agency.name', group: 'agency', value: 'Hacked Agency' }] },
    });
    assert.equal(agentMutateSettings.ok, false);
    assert.equal(agentMutateSettings.error.code, 'FORBIDDEN');

    const agentMutateWilaya = await invoke(IPC_CHANNELS.WILAYAS_UPSERT, {
      token: agentToken,
      data: {
        code: '99',
        nameFr: 'Fake',
        nameAr: 'وهمية',
        isNewlyCreated2026: false,
        effectiveYear: 2026,
        isActive: true,
      },
    });
    assert.equal(agentMutateWilaya.ok, false);
    assert.equal(agentMutateWilaya.error.code, 'FORBIDDEN');

    const agentViewAudit = await invoke(IPC_CHANNELS.AUDIT_LIST, { token: agentToken });
    assert.equal(agentViewAudit.ok, false);
    assert.equal(agentViewAudit.error.code, 'FORBIDDEN');

    // 11. Brute-force lockout after 5 failed password attempts
    for (let i = 0; i < 4; i++) {
      const fail = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
        data: { username: 'agent_1', password: 'WrongPassword!' },
      });
      assert.equal(fail.ok, false);
      assert.equal(fail.error.code, 'UNAUTHORIZED');
    }
    const fifthFail = await invoke(IPC_CHANNELS.AUTH_LOGIN, {
      data: { username: 'agent_1', password: 'WrongPassword!' },
    });
    assert.equal(fifthFail.ok, false);
    assert.equal(fifthFail.error.code, 'LOCKED');
  } finally {
    kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
