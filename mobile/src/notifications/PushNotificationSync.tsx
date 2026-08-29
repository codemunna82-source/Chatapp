import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import type { NavigationContainerRef } from '@react-navigation/native';
import { registerForPushNotifications } from './pushRegistration';
import { useActiveConversationStore } from '../store/activeConversationStore';
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

  useEffect(() => {
    void registerForPushNotifications();
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
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = (notification.request.content.data ?? {}) as PushData;
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
    return {
      shouldShowBanner: !isCurrentChat,
      shouldShowList: true,
      // Sound and vibration in the foreground are the in-app alert's job
      // (useMessageAlert), which already respects the Settings toggles. Two
      // systems both making a noise for one message is a bug.
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});
