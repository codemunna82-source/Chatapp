import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { getOrCreateWallet, listWalletTransactions } from './wallet.repository';

export const getWalletHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const wallet = await getOrCreateWallet(auth.tenantId);
  res.status(200).json({ success: true, data: wallet });
});

export const listWalletTransactionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const result = await listWalletTransactions(auth.tenantId, req.query as never);
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});
