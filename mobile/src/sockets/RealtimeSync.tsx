import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from './useSocketEvent';
import { useSocketConnection } from './useSocketConnected';
import { useMessageAlert } from './useMessageAlert';
import { useActiveConversationStore } from '../store/activeConversationStore';
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

  // React Query ships browser implementations of both managers; in React
  // Native nothing drives them unless it is wired here, which is why
  // refetchOnWindowFocus/refetchOnReconnect were previously inert.
  useEffect(() => {
    const onAppStateChange = (status: AppStateStatus) => {
      focusManager.setFocused(status === 'active');
    };
    const sub = AppState.addEventListener('change', onAppStateChange);
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      // isInternetReachable is null while it is still being determined —
      // treat that as online rather than pausing every query on a value
      // that simply hasn't resolved yet.
      onlineManager.setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    return () => {
      sub.remove();
      unsubscribeNetInfo();
    };
  }, []);

  // A dropped socket is a hole in the realtime stream: anything that
  // happened while it was down was never delivered and never will be, since
  // Socket.IO replays nothing on reconnect. Refetching closes the hole.
  // Skipped on the first connect, where the screens' own queries have just
  // loaded the same data.
  const { generation } = useSocketConnection();
  const lastGeneration = useRef(0);
  useEffect(() => {
    if (generation === 0) return;
    const isReconnect = lastGeneration.current > 0 && generation > lastGeneration.current;
    lastGeneration.current = generation;
    if (!isReconnect) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    void queryClient.invalidateQueries({ queryKey: queryKeys.messagesAll });
  }, [generation, queryClient]);

  const alert = useMessageAlert();

  useSocketEvent<Message>(
    'message:new',
    (message) => {
      upsertMessageInCache(queryClient, message.conversationId, message);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(message.conversationId) });

      // Only for messages FROM the customer, and only when the user is not
      // already looking at that conversation. An echo of your own send, or
      // a chime for the bubble appearing in front of you, is noise — and
      // noise is what makes people turn alerts off entirely.
      const activeId = useActiveConversationStore.getState().activeConversationId;
      if (message.direction === 'IN' && message.conversationId !== activeId) {
        alert();
      }
    },
    [queryClient, alert],
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
