import { useState } from 'react';
import { Linking } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as callsApi from '../api/endpoints/calls';
import { queryKeys } from './keys';

export function useCallHistory() {
  return useInfiniteQuery({
    queryKey: queryKeys.calls,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => callsApi.listCalls({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function flattenCalls(data: ReturnType<typeof useCallHistory>['data']) {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

function useInitiateCall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: callsApi.initiateCall,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calls'] });
    },
  });
}

/**
 * Logs the call via POST /api/calls, then hands off to the real WhatsApp
 * app via its wa.me deep link (Linking.openURL). `linkError` is set only
 * when the device itself can't open that link — almost always because
 * WhatsApp isn't installed — which is a real, checkable device condition,
 * not a guess.
 */
export function usePlaceCall() {
  const initiateCall = useInitiateCall();
  const [linkError, setLinkError] = useState<string | null>(null);

  /** Returns true only once the deep link was actually opened — callers should act on this return value, not on state read right after calling it (which would still reflect the previous attempt). */
  const placeCall = async (contactId: string): Promise<boolean> => {
    setLinkError(null);
    try {
      const result = await initiateCall.mutateAsync(contactId);
      const canOpen = await Linking.canOpenURL(result.deepLink);
      if (!canOpen) {
        setLinkError('Could not open WhatsApp — is it installed on this device?');
        return false;
      }
      await Linking.openURL(result.deepLink);
      return true;
    } catch {
      // initiateCall.error is populated by useMutation for the caller to render.
      return false;
    }
  };

  return {
    placeCall,
    isPending: initiateCall.isPending,
    apiError: initiateCall.error,
    linkError,
  };
}
