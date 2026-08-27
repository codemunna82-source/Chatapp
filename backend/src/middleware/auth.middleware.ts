import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/ApiError';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveAuthContextFromToken } from '../modules/auth/authContext.service';

/**
 * HTTP entry point for the shared auth-context resolution (see
 * authContext.service.ts) — the Socket.IO gateway (Phase 4) applies the
 * identical checks at handshake and on periodic re-validation.
 */
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('AUTH_REQUIRED', 'Missing or malformed Authorization header');
  }
  const token = header.slice('Bearer '.length);

  req.auth = await resolveAuthContextFromToken(token);
  next();
});
