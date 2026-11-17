import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as guestChatApi from '../api/endpoints/guestChat';
import { queryKeys } from './keys';

/** Whether this chat has a live web window — drives whether replying outside Meta's window is offered at all. */
export function useGuestLinkStatus(conversationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.guestLink(conversationId ?? ''),
    queryFn: () => guestChatApi.getGuestLinkStatus(conversationId as string),
    enabled: Boolean(conversationId),
    // A link is issued and revoked by hand, minutes apart at the fastest.
    staleTime: 60_000,
  });
}

export function useIssueGuestLink(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => guestChatApi.issueGuestLink(conversationId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.guestLink(conversationId ?? '') });
    },
  });
}

/**
 * Sends the invitation by hand.
 *
 * Invalidates the link status because this can create the session that
 * status reports on — a customer who was never successfully invited has no
 * live link until this succeeds.
 */
export function useSendGuestLinkInvitation(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => guestChatApi.sendGuestLinkInvitation(conversationId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.guestLink(conversationId ?? '') });
    },
  });
}

export function useRevokeGuestLink(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => guestChatApi.revokeGuestLink(conversationId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.guestLink(conversationId ?? '') });
    },
  });
}

/**
 * Sends into the web window. The thread refreshes from the socket like any
 * other send, so nothing is patched into the cache here.
 */
export function useSendGuestReply(conversationId: string | undefined) {
  return useMutation({
    mutationFn: (text: string) => guestChatApi.sendGuestReply(conversationId as string, text),
  });
}
