import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as walletApi from '../api/endpoints/wallet';
import { queryKeys } from './keys';

export function useWallet(enabled = true) {
  return useQuery({
    queryKey: queryKeys.wallet,
    queryFn: walletApi.getWallet,
    enabled,
  });
}

export function useWalletTransactions() {
  return useInfiniteQuery({
    queryKey: queryKeys.walletTransactions,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => walletApi.listWalletTransactions({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function flattenWalletTransactions(data: ReturnType<typeof useWalletTransactions>['data']) {
  return data?.pages.flatMap((page) => page.items) ?? [];
}
