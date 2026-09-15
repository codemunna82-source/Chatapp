import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import type { NavigationContainerRef } from '@react-navigation/native';
import { registerForPushNotifications, getPushStatus } from './pushRegistration';
import { useActiveConversationStore } from '../store/activeConversationStore';
import { useCallStore } from '../calling/callStore';
import notifee, { EventType } from '@notifee/react-native';
import { displayIncomingCall, cancelIncomingCall } from '../calling/callNotification';
import { handleCallAction } from '../calling/callActions';
import { queryKeys } from '../queries/keys';

/**
 * How a tapped notification decides where to go. Mirrors the `data` block
 * the backend attaches in push.service.ts — every value there is a string,
 * because FCM's v1 API rejects anything else rather than coercing it.
 */
interface PushData {
  type?: string;
  conversationId?: string;
  contactId?: string;
  callId?: string;
  /** Call pushes only — see push.service.ts. */
  callerName?: string;
  callType?: string;
  channelId?: string;
  ringingSince?: string;
}

interface PushNotificationSyncProps {
  navigationRef: NavigationContainerRef<ReactNavigation.RootParamList>;
}

/**
 * Registers this device for push and routes taps.
 *
 * Mounted only inside the signed-in tree (see RootNavigator), which is what
 * ties registration to having a session: registering earlier would have no
 * user to attach the token to, and the backend would reject the call.
 */
export function PushNotificationSync({ navigationRef }: PushNotificationSyncProps): null {
  const queryClient = useQueryClient();
  const handledResponse = useRef<string | null>(null);

  /**
   * Registers, and tries again when the app comes back to the front.
   *
   * It used to run exactly once, on mount, and never again for the life
   * of the session. That is fine for the failures that stay failed — a
   * build with no config, a ROM with no Play Services — and wrong for
   * every failure that does not:
   *
   * - FCM answers SERVICE_NOT_AVAILABLE when it cannot be reached, which
   *   on a phone waking on a weak signal is simply what happens. It
   *   succeeds seconds later, and nothing asked it again.
   * - The permission prompt can be answered AFTER the first attempt has
   *   already given up on it.
   * - Granting notifications in system settings takes the user out of
   *   the app; returning is the obvious moment to notice.
   *
   * Only retried while the last attempt was NOT 'registered', so a phone
   * that is already set up does nothing on every foreground — and the
   * whole point of a token is that it is registered once and kept.
   */
  useEffect(() => {
    void registerForPushNotifications();

    const onChange = (state: AppStateStatus) => {
      if (state !== 'active') return;
      if (getPushStatus() === 'registered') return;
      void registerForPushNotifications();
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const openFromData = (data: PushData) => {
      if (data.conversationId) {
        navigationRef.navigate('ChatsTab', {
          screen: 'ConversationDetail',
          params: { conversationId: data.conversationId },
        });
      }
    };

    // A notification arriving while the app is open still means new data:
    // the socket usually delivered it already, but a push can beat a
    // reconnecting socket, and refreshing costs nothing when it did not.
    /**
     * Button presses while the app IS running.
     *
     * The background handler in callBackground.ts covers the other two
     * cases; notifee routes a press to whichever of the two is live, never
     * both, so there is no risk of a call being answered twice.
     */
    const unsubscribeNotifee = notifee.onForegroundEvent(({ type, detail }) => {
      if (type !== EventType.ACTION_PRESS) return;
      const actionId = detail.pressAction?.id;
      const callId = detail.notification?.data?.callId as string | undefined;
      if (!actionId || !callId) return;
      void handleCallAction(actionId, callId);
    });

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = (notification.request.content.data ?? {}) as PushData;

      /**
       * A call push landing while the app is awake.
       *
       * Two outcomes, and the socket decides which. If the socket already
       * put this call on screen, the push is the slower copy of news
       * already acted on and there is nothing to draw. If it did not — a
       * socket still reconnecting after a doze, which is exactly when a
       * push earns its keep — the call notification goes up here, because
       * the background task that would have drawn it does not run while
       * the app is in the foreground.
       */
      if (data.type === 'call_cancelled' && data.callId) {
        void cancelIncomingCall(data.callId);
        return;
      }
      if (data.type === 'incoming_call' && data.callId) {
        const live = useCallStore.getState();
        if (live.callId === data.callId && live.phase !== 'idle') return;
        const since = Number(data.ringingSince);
        void displayIncomingCall({
          callId: data.callId,
          callerName: data.callerName,
          callType: data.callType === 'video' ? 'video' : 'audio',
          channelId: data.channelId,
          ringingSince: Number.isFinite(since) && since > 0 ? since : undefined,
        });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
      if (data.conversationId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages(data.conversationId) });
      }
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      handledResponse.current = response.notification.request.identifier;
      openFromData((response.notification.request.content.data ?? {}) as PushData);
    });

    // Covers the cold start: tapping a notification while the app is closed
    // launches it, and by the time this listener is attached the tap has
    // already happened, so it would otherwise be lost.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      if (handledResponse.current === response.notification.request.identifier) return;
      handledResponse.current = response.notification.request.identifier;
      openFromData((response.notification.request.content.data ?? {}) as PushData);
    });

    return () => {
      unsubscribeNotifee();
      receivedSub.remove();
      responseSub.remove();
    };
  }, [navigationRef, queryClient]);

  return null;
}

/**
 * Decides whether a push that lands while the app is in the foreground
 * should draw a banner.
 *
 * It should not when the user is already looking at that conversation —
 * the message is on screen, and a banner over it is pure noise. This is
 * the same rule the in-app chime uses; without it, an open chat would both
 * ping and banner for a bubble the user just watched arrive.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as PushData;
    const activeId = useActiveConversationStore.getState().activeConversationId;
    const isCurrentChat = Boolean(data.conversationId) && data.conversationId === activeId;
    // The call push is the backup for a device that was asleep. With the
    // app open the socket has already put the full call screen up, so a
    // banner about the same call would land on top of the Answer button.
    const isRingingCall =
      data.type === 'incoming_call' && useCallStore.getState().callId === data.callId;
    return {
      shouldShowBanner: !isCurrentChat && !isRingingCall,
      shouldShowList: true,
      // Sound and vibration in the foreground are the in-app alert's job
      // (useMessageAlert), which already respects the Settings toggles. Two
      // systems both making a noise for one message is a bug.
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});
