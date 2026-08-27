import { apiClient } from '../client';
import type { ApiSuccess, Wallet, WalletTransaction } from '../types';

export async function getWallet(): Promise<Wallet> {
  const res = await apiClient.get<ApiSuccess<Wallet>>('/wallet');
  return res.data.data;
}

export interface ListWalletTransactionsParams {
  cursor?: string;
  limit?: number;
}

export async function listWalletTransactions(
  params: ListWalletTransactionsParams,
): Promise<{ items: WalletTransaction[]; nextCursor: string | null }> {
  const res = await apiClient.get<ApiSuccess<WalletTransaction[]>>('/wallet/transactions', { params });
  return { items: res.data.data, nextCursor: res.data.meta?.nextCursor ?? null };
}
