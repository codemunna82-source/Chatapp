import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/ApiError';
import type { AuthContext } from '../types/express';

/**
 * Asserts requireAuth has already run and hands back the resolved tenant
 * context. Route handlers and repositories should use this — or read
 * `req.auth` directly — rather than ever reading a `tenantId` field out of
 * `req.body`/`req.query`/`req.params`. Client-supplied tenant identifiers
 * are never trusted (spec §8, §13).
 */
export function getTenantContext(req: Request): AuthContext {
  if (!req.auth) {
    throw ApiError.internal(
      'TENANT_CONTEXT_MISSING',
      'getTenantContext() called before requireAuth middleware ran',
    );
  }
  return req.auth;
}

/** No-op guard middleware documenting the requirement at the route level. */
export function requireTenantContext(req: Request, _res: Response, next: NextFunction): void {
  getTenantContext(req); // throws if missing
  next();
}
