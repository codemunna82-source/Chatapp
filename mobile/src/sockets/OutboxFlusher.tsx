import { useEffect, useRef } from 'react';
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as messagesApi from '../api/endpoints/messages';
import { isOfflineError } from '../api/client';
import { useOutboxStore, MAX_OUTBOX_ATTEMPTS } from '../store/outboxStore';
import {
  upsertMessageInCache,
  removeMessageFromCache,
  patchMessageStatusInCache,
} from '../queries/useMessages';
import { queryKeys } from '../queries/keys';
import { playSentSound } from './useMessageAlert';
import { captureHandledError } from '../lib/sentry';

/**
 * Drains the offline outbox one message at a time, oldest first.
 *
 * Sequential on purpose: these are messages to the same customers in the
 * order they were typed, and firing them in parallel would let the network
 * decide what order a conversation reads in.
 *
 * A single in-flight guard (`running`) rather than a lock per item —
 * connectivity can flap several times in a second, and each flap would
 * otherwise start its own pass over the same queue and send everything
 * twice.
 */
let running = false;

async function flushOutbox(queryClient: QueryClient): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Re-read the queue each iteration rather than snapshotting it: the
    // user can keep typing while this runs, and anything they add should
    // go out in this same pass instead of waiting for the next flap.
    for (;;) {
      const item = useOutboxStore.getState().items[0];
      if (!item) return;

      useOutboxStore.getState().recordAttempt(item.id);
      try {
        const message = await messagesApi.sendMessage(item.conversationId, item.body);
        useOutboxStore.getState().remove(item.id);
        removeMessageFromCache(queryClient, item.conversationId, item.id);
        upsertMessageInCache(queryClient, item.conversationId, message);
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
        playSentSound();
      } catch (err) {
        if (isOfflineError(err) && item.attempts + 1 < MAX_OUTBOX_ATTEMPTS) {
          // Still no connection. Stop the whole pass rather than moving on
          // to the next item — order matters, and the next one would fail
          // for the same reason anyway.
          return;
        }
        // Either the server answered and rejected it (a closed 24-hour
        // window, a deleted conversation) or it has been retried past the
        // point of usefulness. Leave the bubble visible and FAILED so the
        // user can see what didn't go, and drop it from the queue so it
        // stops being retried behind their back.
        //
        // Worth reporting because this is a message the user believed was
        // sent, queued while offline, and then permanently lost — the
        // worst outcome this app has, and completely invisible otherwise.
        captureHandledError(err, {
          stage: 'outboxFlush',
          messageType: item.body.type,
          attempts: item.attempts + 1,
          queuedAt: item.queuedAt,
        });
        useOutboxStore.getState().remove(item.id);
        patchMessageStatusInCache(queryClient, item.conversationId, item.id, 'FAILED');
      }
    }
  } finally {
    running = false;
  }
}

/**
 * No UI — mounted alongside RealtimeSync for a signed-in session.
 *
 * Flushes on mount (covering messages queued in a previous run of the app)
 * and on every online transition reported by React Query's onlineManager,
 * which RealtimeSync wires to NetInfo.
 */
export function OutboxFlusher(): null {
  const queryClient = useQueryClient();
  const wasOnline = useRef(onlineManager.isOnline());

  useEffect(() => {
    if (onlineManager.isOnline()) void flushOutbox(queryClient);

    return onlineManager.subscribe((online) => {
      const cameBack = online && !wasOnline.current;
      wasOnline.current = online;
      if (cameBack) void flushOutbox(queryClient);
    });
  }, [queryClient]);

  return null;
}
