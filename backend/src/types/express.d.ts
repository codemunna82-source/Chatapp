import type { UserRole } from '../lib/jwt';
import type { Permission } from '../modules/users/permission';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by requireAuth. Never trust any tenantId from req.body/query — use this. */
      auth?: AuthContext;
    }
  }
}

export {};
