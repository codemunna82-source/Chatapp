import { Types } from 'mongoose';
import { Wallet, type WalletDoc } from './wallet.model';
import { WalletTransaction, type WalletTransactionDoc, type WalletTransactionType } from './walletTransaction.model';
import { ApiError } from '../../lib/ApiError';

export async function getOrCreateWallet(tenantId: string): Promise<WalletDoc> {
  const existing = await Wallet.findOne({ tenantId });
  if (existing) return existing;
  return Wallet.create({ tenantId, balance: 0 });
}

export async function listWalletTransactions(
  tenantId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ items: WalletTransactionDoc[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const filter: Record<string, unknown> = { tenantId };
  if (opts.cursor && Types.ObjectId.isValid(opts.cursor)) {
    filter._id = { $lt: new Types.ObjectId(opts.cursor) };
  }
  const items = await WalletTransaction.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? String(page[page.length - 1]!._id) : null };
}

/**
 * Applies a signed balance change atomically at the document level ($inc)
 * and records the corresponding ledger entry. Note: the balance update and
 * the ledger insert are two separate writes, not a single multi-document
 * transaction — acceptable for Phase 2's scope. If a hosting deployment
 * runs MongoDB as a replica set (the default on Atlas and most managed
 * providers), wrap both writes in a `session.withTransaction()` for strict
 * atomicity before this ships real metered billing.
 */
async function applyTransaction(
  tenantId: string,
  type: WalletTransactionType,
  amount: number,
  reason: string,
  referenceId?: string,
): Promise<{ wallet: WalletDoc; transaction: WalletTransactionDoc }> {
  if (amount <= 0) {
    throw ApiError.badRequest('INVALID_AMOUNT', 'Wallet transaction amount must be positive');
  }
  const wallet = await getOrCreateWallet(tenantId);
  const delta = type === 'CREDIT' ? amount : -amount;

  if (type === 'DEBIT' && wallet.balance + delta < 0) {
    throw ApiError.badRequest('INSUFFICIENT_BALANCE', 'Wallet balance is insufficient for this debit');
  }

  const updated = await Wallet.findOneAndUpdate(
    { _id: wallet._id, tenantId },
    { $inc: { balance: delta } },
    { new: true },
  );
  if (!updated) {
    throw ApiError.internal('WALLET_UPDATE_FAILED', 'Failed to update wallet balance');
  }

  const transaction = await WalletTransaction.create({
    tenantId,
    walletId: wallet._id,
    type,
    amount,
    reason,
    referenceId,
  });

  return { wallet: updated, transaction };
}

export async function creditWallet(tenantId: string, amount: number, reason: string, referenceId?: string) {
  return applyTransaction(tenantId, 'CREDIT', amount, reason, referenceId);
}

export async function debitWallet(tenantId: string, amount: number, reason: string, referenceId?: string) {
  return applyTransaction(tenantId, 'DEBIT', amount, reason, referenceId);
}
