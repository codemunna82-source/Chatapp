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
      /** Raw request body bytes, captured by express.json()'s `verify` hook in app.ts — needed for HMAC signature verification (Meta webhooks), which must hash the exact wire bytes. */
      rawBody?: Buffer;
    }
  }
}

export {};
