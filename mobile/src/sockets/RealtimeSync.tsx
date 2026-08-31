import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from './useSocketEvent';
import { useSocketConnection } from './useSocketConnected';
import { useMessageAlert } from './useMessageAlert';
import { useActiveConversationStore } from '../store/activeConversationStore';
import { useCallStore, type IncomingCallPayload, type CallEndedPayload } from '../calling/callStore';
import { upsertMessageInCache, patchMessageStatusInCache } from '../queries/useMessages';
import { queryKeys } from '../queries/keys';
import type { Message, Conversation, MessageStatus } from '../api/types';

/** Long enough to absorb a burst of webhooks, short enough that the list
 *  still feels live — the bubble itself already updated instantly from the
 *  socket payload, so this only governs the list row behind it. */
const CONVERSATION_LIST_COALESCE_MS = 700;

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

  /**
   * Refetches the chat list at most once per burst.
   *
   * Every inbound message, every status change and every read receipt
   * touches the chat list, and each one used to invalidate it
   * immediately — so a customer sending five messages in a row, or a
   * batch of status webhooks landing together, cost five full refetches
   * of a screen that only ends up rendering once. The list is a tab and
   * is almost always mounted, so those all went to the network.
   *
   * A trailing window rather than a leading one: the last event in a
   * burst is the one whose state the list should end up showing.
   */
  const listRefetch = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateConversations = useCallback(() => {
    if (listRefetch.current) return;
    listRefetch.current = setTimeout(() => {
      listRefetch.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    }, CONVERSATION_LIST_COALESCE_MS);
  }, [queryClient]);

  useEffect(
    () => () => {
      if (listRefetch.current) clearTimeout(listRefetch.current);
    },
    [],
  );

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
      invalidateConversations();
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
    [queryClient, alert, invalidateConversations],
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
      invalidateConversations();
    },
    [queryClient, invalidateConversations],
  );

  useSocketEvent<{ conversationId: string; byUserId: string }>(
    'conversation:read',
    () => {
      invalidateConversations();
    },
    [invalidateConversations],
  );

  // Calls are handed straight to the call store rather than to the query
  // cache: a ringing phone is not data to be refetched, and the SDP offer
  // in this payload is the only copy that will ever arrive — there is no
  // endpoint to re-read it from if it were dropped here.
  useSocketEvent<IncomingCallPayload>(
    'call:incoming',
    (payload) => {
      useCallStore.getState().ring(payload);
    },
    [],
  );

  useSocketEvent<CallEndedPayload>(
    'call:ended',
    (payload) => {
      useCallStore.getState().remoteEnded(payload);
      // The history list gains a completed call with its duration, which
      // only exists once Meta's terminate webhook has been reconciled.
      void queryClient.invalidateQueries({ queryKey: queryKeys.calls });
    },
    [queryClient],
  );

  return null;
}
