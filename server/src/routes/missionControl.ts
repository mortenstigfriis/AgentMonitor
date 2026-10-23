import { readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { Router } from 'express';
import { config } from '../config.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ADAPTER_TIMEOUT_MS = 4_000;

function adapterBaseUrl(): URL {
  const url = new URL(config.missionControl.adapterUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('TALIFLY_ADAPTER_URL must use loopback HTTP');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

function adapterToken(): string {
  const metadata = statSync(config.missionControl.tokenFile);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error('Adapter token file must be a private regular file');
  }
  const token = readFileSync(config.missionControl.tokenFile, 'utf8').trim();
  if (token.length < 32 || token.length > 4096) {
    throw new Error('Adapter token must contain 32-4096 characters');
  }
  return token;
}

async function fetchAdapter(path: string, authenticated = true): Promise<unknown> {
  const url = new URL(path, adapterBaseUrl());
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authenticated) headers.Authorization = `Bearer ${adapterToken()}`;

  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method: 'GET', headers }, (response) => {
      const declaredLength = Number(response.headers['content-length'] || '0');
      if (declaredLength > MAX_RESPONSE_BYTES) {
        response.destroy(new Error('Adapter response is too large'));
        return;
      }

      const chunks: Buffer[] = [];
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('Adapter response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const status = response.statusCode || 500;
        if (status < 200 || status >= 300) {
          reject(new Error(`Adapter returned ${status}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('Adapter returned invalid JSON'));
        }
      });
      response.on('error', reject);
    });
    outgoing.setTimeout(ADAPTER_TIMEOUT_MS, () => {
      outgoing.destroy(new Error('Adapter request timed out'));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

export function missionControlRoutes(): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      const health = await fetchAdapter('/health', false);
      res.json({ ok: true, adapter: health, readOnly: true });
    } catch {
      res.status(503).json({ ok: false, error: 'Mission Control adapter unavailable' });
    }
  });

  router.get('/snapshot', async (_req, res) => {
    try {
      res.json(await fetchAdapter('/v1/snapshot'));
    } catch {
      res.status(503).json({ error: 'Mission Control snapshot unavailable' });
    }
  });

  router.get('/events', async (req, res) => {
    const after = Number(req.query.after ?? 0);
    const limit = Number(req.query.limit ?? 100);
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      res.status(400).json({ error: 'Invalid event cursor' });
      return;
    }
    try {
      res.json(await fetchAdapter(`/v1/events?after=${after}&limit=${limit}`));
    } catch {
      res.status(503).json({ error: 'Mission Control events unavailable' });
    }
  });

  router.all('*', (_req, res) => {
    res.status(405).json({ error: 'Mission Control is read-only' });
  });

  return router;
}
