import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPreviewExpressApp } from '../server.ts';
import { PREVIEW_ENDPOINTS } from '../shared/api/previewContracts.ts';

test('Browser Preview Express API enforces Bearer auth, lock state, and Admin/Agent RBAC', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-preview-http-'));
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

    // Unauthenticated call must fail 401
    const unauth = await fetch(`${base}${PREVIEW_ENDPOINTS.USERS}`);
    assert.equal(unauth.status, 401);

    // Bootstrap first Admin
    const bootRes = await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'preview_admin',
        fullName: 'Preview Admin',
        password: 'PreviewAdminPassword1!',
      }),
    });
    assert.equal(bootRes.status, 201);
    const bootJson = (await bootRes.json()) as any;
    const adminToken = bootJson.data.token as string;

    // Create Agent
    const createAgentRes = await fetch(`${base}${PREVIEW_ENDPOINTS.USERS}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: 'preview_agent',
        fullName: 'Preview Agent',
        password: 'PreviewAgentPassword1!',
        roleCode: 'AGENT',
      }),
    });
    assert.equal(createAgentRes.status, 201);

    // Lock Admin session -> settings blocked 423 -> Unlock -> 200
    await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_LOCK}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const whileLocked = await fetch(`${base}${PREVIEW_ENDPOINTS.SETTINGS}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(whileLocked.status, 423);

    const unlockRes = await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_UNLOCK}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ password: 'PreviewAdminPassword1!' }),
    });
    assert.equal(unlockRes.status, 200);

    // Agent login
    const agentLoginRes = await fetch(`${base}${PREVIEW_ENDPOINTS.AUTH_LOGIN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'preview_agent',
        password: 'PreviewAgentPassword1!',
      }),
    });
    assert.equal(agentLoginRes.status, 200);
    const agentToken = ((await agentLoginRes.json()) as any).data.token as string;

    // Agent forbidden on Admin HTTP endpoints
    const agentForbiddenUsers = await fetch(`${base}${PREVIEW_ENDPOINTS.USERS}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert.equal(agentForbiddenUsers.status, 403);

    const agentForbiddenSettingsPut = await fetch(`${base}${PREVIEW_ENDPOINTS.SETTINGS}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({
        updates: [{ key: 'agency.name', group: 'agency', value: 'Unauthorized' }],
      }),
    });
    assert.equal(agentForbiddenSettingsPut.status, 403);

    // Unknown /api/* route returns 404
    const unknownApi = await fetch(`${base}/api/production-secret`);
    assert.equal(unknownApi.status, 404);
  } finally {
    server.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
