import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { getSubscriptionHandler } from './subscription.controller';

export const subscriptionRouter = Router();

// Tenant-level billing/plan status, same MASTER_ADMIN-only scoping as the
// wallet — renewal/payment is out of scope here (no payment gateway is
// wired up, real or otherwise); this is read-only status visibility.
subscriptionRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

subscriptionRouter.get('/', getSubscriptionHandler);
