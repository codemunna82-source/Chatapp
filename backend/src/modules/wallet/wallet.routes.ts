import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { listWalletTransactionsQuerySchema } from './wallet.validation';
import { getWalletHandler, listWalletTransactionsHandler } from './wallet.controller';

export const walletRouter = Router();

// The wallet is a tenant-level billing ledger (spec §7) — a sub-user's
// per-chat permissions don't extend to seeing the tenant's balance/spend,
// so this is MASTER_ADMIN only rather than gated by a chat permission.
walletRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

walletRouter.get('/', getWalletHandler);
walletRouter.get('/transactions', validate({ query: listWalletTransactionsQuerySchema }), listWalletTransactionsHandler);
