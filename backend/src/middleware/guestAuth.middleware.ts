import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/ApiError';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveGuestContextFromToken } from '../modules/guest/guest.service';
import type { GuestContext } from '../modules/guest/guest.service';

/**
 * Authenticates a customer holding a web-chat link.
 *
 * Sets req.guest, never req.auth. Keeping them in separate fields is the
 * point: getTenantContext() throws if req.auth is missing, so an ordinary
 * authenticated route can never be satisfied by a guest token, no matter
 * how it is mounted or which middleware order a later change introduces.
 */
export const requireGuest = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('GUEST_LINK_REQUIRED', 'Missing chat link token');
  }
  req.guest = await resolveGuestContextFromToken(header.slice('Bearer '.length));
  next();
});

/** Asserts requireGuest has run and hands back the resolved session. */
export function getGuestContext(req: Request): GuestContext {
  if (!req.guest) {
    throw ApiError.internal(
      'GUEST_CONTEXT_MISSING',
      'getGuestContext() called before requireGuest middleware ran',
    );
  }
  return req.guest;
}
