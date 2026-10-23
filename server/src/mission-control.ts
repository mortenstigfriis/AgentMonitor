import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthRoutes, requireAuth } from './auth.js';
import { config } from './config.js';
import { missionControlRoutes } from './routes/missionControl.js';

const HOST = '127.0.0.1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMissionControlApp() {
  if (config.password.length < 16) {
    throw new Error('DASHBOARD_PASSWORD must contain at least 16 characters');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.set('query parser', 'simple');
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', createAuthRoutes());
  app.use('/api', requireAuth);
  app.use('/api/mission-control', missionControlRoutes());
  app.all('/api/*', (_req, res) => res.status(404).json({ error: 'API not available in read-only mode' }));

  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: 0 }));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'mission-control.html')));
  } else {
    app.get('*', (_req, res) => res.status(404).json({ error: 'Mission Control client not built' }));
  }
  return app;
}

const isMain = process.argv[1]?.endsWith('mission-control.ts')
  || process.argv[1]?.endsWith('mission-control.js');
if (isMain) {
  const app = createMissionControlApp();
  app.listen(config.port, HOST, () => {
    console.log(`Talifly Mission Control listening on ${HOST}:${config.port}`);
  });
}
