import { useEffect } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { resolveSmsConversation } from '../../api/endpoints/sms';
import type { ChatsStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'SmsThread'>;

/**
 * Not a screen of its own any more — an SMS lead now lives in the real
 * Chats list and opens into the real ConversationDetailScreen, the same
 * as any WhatsApp conversation (see ChatsListScreen.tsx and
 * ConversationDetailScreen's own SMS-channel handling). This route only
 * still exists because SmsAutoReplyReceiver.kt's lead-SMS notification
 * deep-links to voxo://sms-thread/<phone> — a phone number is all a
 * native BroadcastReceiver can know at the moment a text arrives — so
 * something has to resolve that into a real conversation id and hand
 * off. Kept as its own route rather than changing the native deep link
 * itself, which would need a new APK build to take effect on a phone
 * that already has a notification sitting in its tray.
 */
export function SmsThreadScreen({ route, navigation }: Props) {
  const { phone } = route.params;

  useEffect(() => {
    let cancelled = false;
    resolveSmsConversation(phone)
      .then(({ conversationId }) => {
        if (cancelled) return;
        navigation.replace('ConversationDetail', { conversationId });
      })
      .catch(() => {
        // Offline, or signed out by the time the notification was tapped.
        // Nothing useful to show here — back to wherever they were is
        // better than a dead-end screen with no way off it.
        if (cancelled) return;
        navigation.goBack();
      });
    return () => {
      cancelled = true;
    };
  }, [phone, navigation]);

  return <LoadingIndicator fullscreen />;
}
