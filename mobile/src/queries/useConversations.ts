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
