import { Router } from 'express';
import mongoose from 'mongoose';

export const healthRouter = Router();

/** Liveness — process is up. Does not touch dependencies. */
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok' } });
});

/** Readiness — dependencies (MongoDB) are reachable; used by orchestrators/load balancers. */
healthRouter.get('/ready', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  if (!mongoReady) {
    res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'MongoDB not connected' } });
    return;
  }
  res.status(200).json({ success: true, data: { status: 'ready' } });
});
