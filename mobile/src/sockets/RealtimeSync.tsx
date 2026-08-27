import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from './useSocketEvent';
import { upsertMessageInCache, patchMessageStatusInCache } from '../queries/useMessages';
import { queryKeys } from '../queries/keys';
import type { Message, Conversation, MessageStatus } from '../api/types';

interface MessageStatusPayload {
  conversationId: string;
  messageId: string;
  status: MessageStatus;
}

/**
 * No UI — mounted once (see RootNavigator) for the lifetime of a signed-in
 * session, translating Socket.IO events (spec §22) into TanStack Query
 * cache updates so every screen showing affected data updates live without
 * each one managing its own socket subscriptions.
 */
export function RealtimeSync(): null {
  const queryClient = useQueryClient();

  useSocketEvent<Message>(
    'message:new',
    (message) => {
      upsertMessageInCache(queryClient, message.conversationId, message);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(message.conversationId) });
    },
    [queryClient],
  );

  useSocketEvent<Message>(
    'message:updated',
    (message) => {
      upsertMessageInCache(queryClient, message.conversationId, message);
    },
    [queryClient],
  );

  useSocketEvent<MessageStatusPayload>(
    'message:status',
    (payload) => {
      patchMessageStatusInCache(queryClient, payload.conversationId, payload.messageId, payload.status);
    },
    [queryClient],
  );

  useSocketEvent<Conversation>(
    'conversation:updated',
    (conversation) => {
      // Merge rather than replace — the socket payload doesn't carry the
      // populated `contact` field the REST response does, and a naive
      // overwrite would make it flicker away until the next refetch.
      queryClient.setQueryData<Conversation>(queryKeys.conversation(conversation.id), (old) =>
        old ? { ...old, ...conversation, contact: old.contact } : conversation,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
    [queryClient],
  );

  useSocketEvent<{ conversationId: string; byUserId: string }>(
    'conversation:read',
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
    [queryClient],
  );

  return null;
}
