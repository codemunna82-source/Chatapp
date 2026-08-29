import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints/quickReplies';
import { queryKeys } from './keys';

export function useQuickReplies() {
  return useQuery({
    queryKey: queryKeys.quickReplies,
    queryFn: api.listQuickReplies,
    // A hand-curated list that changes rarely — no reason to refetch it
    // every time the composer's picker is opened.
    staleTime: 5 * 60_000,
  });
}

export function useCreateQuickReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createQuickReply,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quickReplies }),
  });
}

export function useUpdateQuickReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string; title?: string; body?: string }) =>
      api.updateQuickReply(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quickReplies }),
  });
}

export function useDeleteQuickReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteQuickReply,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quickReplies }),
  });
}

/**
 * Records that a reply was used, for the picker's most-used ordering.
 * Failures are swallowed on purpose: the message has already been sent by
 * the time this runs, and an error toast about a usage counter would be
 * noise about something the user never asked for.
 */
export function recordQuickReplyUse(id: string): void {
  void api.recordQuickReplyUse(id).catch(() => undefined);
}
