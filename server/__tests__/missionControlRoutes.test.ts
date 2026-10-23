import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { missionControlRoutes } from '../src/routes/missionControl.js';

describe('Mission Control read-only proxy', () => {
  let adapter: Server;
  let dashboard: Server;
  let dashboardUrl = '';
  let tempDir = '';
  let observedAuthorization = '';

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-control-'));
    const tokenFile = path.join(tempDir, 'adapter.token');
    fs.writeFileSync(tokenFile, 'a'.repeat(64), { mode: 0o600 });

    adapter = http.createServer((req, res) => {
      observedAuthorization = req.headers.authorization || '';
      if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', read_only: true }));
        return;
      }
      if (observedAuthorization !== `Bearer ${'a'.repeat(64)}`) {
        res.statusCode = 401;
        res.end('{}');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/snapshot') {
        res.end(JSON.stringify({ api_version: '1', tasks: [], agents: [] }));
      } else {
        res.end(JSON.stringify({ events: [], next_after: 0 }));
      }
    });
    await new Promise<void>((resolve) => adapter.listen(0, '127.0.0.1', resolve));
    const adapterAddress = adapter.address();
    if (!adapterAddress || typeof adapterAddress === 'string') throw new Error('Bad adapter address');
    config.missionControl.adapterUrl = `http://127.0.0.1:${adapterAddress.port}`;
    config.missionControl.tokenFile = tokenFile;

    const app = express();
    app.use('/api/mission-control', missionControlRoutes());
    dashboard = http.createServer(app);
    await new Promise<void>((resolve) => dashboard.listen(0, '127.0.0.1', resolve));
    const dashboardAddress = dashboard.address();
    if (!dashboardAddress || typeof dashboardAddress === 'string') throw new Error('Bad dashboard address');
    dashboardUrl = `http://127.0.0.1:${dashboardAddress.port}`;
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolve) => adapter.close(() => resolve())),
      new Promise<void>((resolve) => dashboard.close(() => resolve())),
    ]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('proxies a sanitized snapshot with server-side bearer auth', async () => {
    const response = await fetch(`${dashboardUrl}/api/mission-control/snapshot`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ api_version: '1', tasks: [], agents: [] });
    expect(observedAuthorization).toBe(`Bearer ${'a'.repeat(64)}`);
  });

  it('keeps health free of the adapter bearer token', async () => {
    const response = await fetch(`${dashboardUrl}/api/mission-control/health`);
    expect(response.status).toBe(200);
    expect(observedAuthorization).toBe('');
  });

  it('rejects writes and invalid event cursors', async () => {
    const write = await fetch(`${dashboardUrl}/api/mission-control/snapshot`, { method: 'POST' });
    expect(write.status).toBe(405);
    const invalid = await fetch(`${dashboardUrl}/api/mission-control/events?after=-1`);
    expect(invalid.status).toBe(400);
  });

  it('fails closed for a non-loopback adapter URL', async () => {
    const original = config.missionControl.adapterUrl;
    config.missionControl.adapterUrl = 'https://example.com';
    const response = await fetch(`${dashboardUrl}/api/mission-control/snapshot`);
    config.missionControl.adapterUrl = original;
    expect(response.status).toBe(503);
  });
});
