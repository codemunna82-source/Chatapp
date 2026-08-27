import { useQuery } from '@tanstack/react-query';
import * as subscriptionApi from '../api/endpoints/subscription';
import { queryKeys } from './keys';

export function useSubscription(enabled = true) {
  return useQuery({
    queryKey: queryKeys.subscription,
    queryFn: subscriptionApi.getSubscription,
    enabled,
    retry: (failureCount, error: unknown) => {
      // 404 = no subscription record yet, not a transient failure — don't retry it.
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) return false;
      return failureCount < 2;
    },
  });
}
