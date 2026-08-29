import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as conversationsApi from '../api/endpoints/conversations';
import type { ListConversationsParams } from '../api/endpoints/conversations';
import type { Conversation, ConversationStatus } from '../api/types';
import { queryKeys } from './keys';

export function useConversations(params: Omit<ListConversationsParams, 'cursor'> = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations(params),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      conversationsApi.listConversations({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Flattens the infinite-query pages into one list for FlashList. */
export function flattenConversations(data: ReturnType<typeof useConversations>['data']): Conversation[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.conversation(id ?? ''),
    queryFn: () => conversationsApi.getConversation(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Starts (or reopens) the chat with a contact. Idempotent server-side, so
 * picking the same contact twice lands on the same thread.
 */
export function useStartConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => conversationsApi.startConversation(contactId),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(conversation.id), conversation);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => conversationsApi.deleteConversation(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.conversation(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

export function usePinConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; pinned: boolean }) =>
      conversationsApi.setConversationPinned(vars.id, vars.pinned),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(conversation.id), conversation);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

export function useArchiveConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: ConversationStatus }) =>
      conversationsApi.setConversationStatus(vars.id, vars.status),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(conversation.id), conversation);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

/** "Mark as unread" — the inverse of opening the chat, which clears it. */
export function useMarkConversationUnread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => conversationsApi.markConversationUnread(id),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(conversation.id), conversation);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

/**
 * One action across a selection of chats.
 *
 * The whole list is invalidated rather than patched: a bulk archive or
 * delete changes which rows belong in the current view at all, and
 * reconciling that by hand across an infinite query's pages is more likely
 * to leave a ghost row than a refetch is to be slow.
 */
export function useBulkConversations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { ids: string[]; action: conversationsApi.BulkConversationAction }) =>
      conversationsApi.bulkUpdateConversations(vars.ids, vars.action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}
