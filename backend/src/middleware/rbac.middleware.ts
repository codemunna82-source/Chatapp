import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/ApiError';
import { getTenantContext } from './tenantContext.middleware';
import type { Permission } from '../modules/users/permission';
import type { UserRole } from '../lib/jwt';

/** Restricts a route to specific role(s). MASTER_ADMIN typically bypasses requirePermission entirely. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = getTenantContext(req);
    if (!roles.includes(auth.role)) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'You do not have access to this resource');
    }
    next();
  };
}

/**
 * Restricts a route to users holding ALL of the given permissions.
 * MASTER_ADMIN is always allowed within their own tenant (spec §9) without
 * needing permissions listed explicitly.
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = getTenantContext(req);
    if (auth.role === 'MASTER_ADMIN') {
      next();
      return;
    }
    const missing = permissions.filter((p) => !auth.permissions.includes(p));
    if (missing.length > 0) {
      throw ApiError.forbidden(
        'PERMISSION_DENIED',
        `Missing required permission(s): ${missing.join(', ')}`,
      );
    }
    next();
  };
}
