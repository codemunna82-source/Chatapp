import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { KeyboardState, useAnimatedKeyboard, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { MessageListSkeleton } from '../../components/Skeleton';
import { MessageBubble } from './MessageBubble';
import { ChatWallpaper } from './ChatWallpaper';
import { DateSeparator } from './DateSeparator';
import { Composer } from './Composer';
import { ChatHeaderTitle } from './ChatHeaderTitle';
import { ThemeProvider, useResolvedScheme } from '../../theme/ThemeProvider';
import { chatLightColors, chatDarkColors, chatHeaderBackground, chatHeaderForeground } from '../../theme/chatTheme';
import { touchTarget } from '../../theme/spacing';
import { formatPhoneForDisplay, smsAddressToE164 } from '../../utils/formatPhone';
import { dayKey } from '../../utils/formatTime';
import { LOCAL_SMS_ID_PREFIX, useLocalSmsMessages, useMarkSmsThreadRead, useSendLocalSms } from '../../queries/useLocalSms';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../queries/keys';
import { getSmsInviteLink } from '../../api/endpoints/sms';
import { deleteSmsMessage, getSmsStoreDiagnostics } from '../../native/smsStore';
import { getApiErrorMessage } from '../../api/client';
import { buildInvitationSmsText, getInvitationSmsTemplate } from '../../storage/invitationSmsTemplate';
import type { ChatsStackParamList } from '../../navigation/types';
import type { Message } from '../../api/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'SmsThread'>;

type RenderItem = { kind: 'message'; id: string; message: Message } | { kind: 'separator'; id: string; iso: string };

const SCREEN_EDGES: Edge[] = [];
const KEYBOARD_GAP = 8;
const keyExtractor = (item: RenderItem) => item.id;
const getItemType = (item: RenderItem) => item.kind;
const noop = () => {};

function buildRenderItems(newestFirst: Message[]): RenderItem[] {
  const items: RenderItem[] = [];
  let lastDay: string | null = null;
  for (const m of [...newestFirst].reverse()) {
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      items.push({ kind: 'separator', id: `sep-${day}`, iso: m.createdAt });
      lastDay = day;
    }
    items.push({ kind: 'message', id: m.id, message: m });
  }
  return items.reverse();
}

/**
 * One SMS thread, read from the on-device store (VoxoSmsStore) — the same
 * wallpaper, bubbles, date separators, header and composer as a WhatsApp
 * chat, without the server features (templates, media, reactions) SMS does
 * not have. Reached from the Chats list, from the native SMS notification
 * (voxo://sms-thread/<phone>), and from a legacy SMS-only server conversation.
 */
export function SmsThreadScreen({ route, navigation }: Props) {
  const { phone } = route.params;
  const scheme = useResolvedScheme();
  const headerBg = chatHeaderBackground[scheme];
  const headerFg = chatHeaderForeground[scheme];
  const chatColors = scheme === 'dark' ? chatDarkColors : chatLightColors;

  const messagesQuery = useLocalSmsMessages(phone);
  const { mutate: markThreadRead } = useMarkSmsThreadRead();
  const { mutate: sendSms } = useSendLocalSms(phone);
  /** Typed texts not yet confirmed by the native send, shown at once so sending never looks frozen. */
  const [pending, setPending] = useState<Message[]>([]);

  const stored = messagesQuery.data;
  // Opening the thread reads it; a message arriving while it is open is read too.
  useEffect(() => {
    markThreadRead(phone);
  }, [phone, stored, markThreadRead]);

  const renderItems = useMemo(() => buildRenderItems([...pending, ...(stored ?? [])]), [pending, stored]);

  const handleSendText = useCallback(
    (text: string) => {
      const tempId = `temp-sms-${Date.now()}`;
      setPending((prev) => [
        {
          id: tempId,
          conversationId: `${LOCAL_SMS_ID_PREFIX}${phone}`,
          direction: 'OUT',
          type: 'text',
          text,
          status: 'QUEUED',
          channel: 'sms',
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      sendSms(text, {
        // The stored row (written natively on send) replaces the placeholder.
        onSuccess: () => setPending((prev) => prev.filter((m) => m.id !== tempId)),
        onError: () =>
          setPending((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'FAILED' as const } : m))),
      });
    },
    [phone, sendSms],
  );

  const handleRetry = useCallback(
    (message: Message) => {
      if (message.id.startsWith('temp-sms-')) {
        setPending((prev) => prev.filter((m) => m.id !== message.id));
        handleSendText(message.text ?? '');
        return;
      }
      // A stored message the network refused: drop the failed copy and send the text again.
      const storedId = Number(message.id.slice(LOCAL_SMS_ID_PREFIX.length));
      if (!Number.isFinite(storedId)) return;
      const retry = () =>
        void deleteSmsMessage(storedId)
          .catch(() => {})
          .then(() => handleSendText(message.text ?? ''));
      // Say WHY it failed before trying again, so "Failed" is never a
      // mystery: the phone reported a reason when the send was refused.
      void getSmsStoreDiagnostics()
        .catch(() => null)
        .then((d) => {
          const reason = d?.lastError?.replace(/^send failed: /, '') ?? 'The phone did not say why.';
          Alert.alert('SMS not sent', reason, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: retry },
          ]);
        });
    },
    [handleSendText],
  );

  const [linkBusy, setLinkBusy] = useState(false);
  /** Texts this number the invitation template with their own private chat link. */
  const queryClient = useQueryClient();
  const handleSendLink = useCallback(() => {
    if (linkBusy) return;
    Alert.alert('Send private chat link?', `Your invitation message and a chat link go to ${phone} by SMS.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: () => {
          setLinkBusy(true);
          getSmsInviteLink(smsAddressToE164(phone))
            .then(({ url }) => {
              handleSendText(buildInvitationSmsText(getInvitationSmsTemplate(), 'there', url));
              // Minting the link also created this customer's private chat
              // on the server. Refreshing the list turns this SMS-only row
              // into the one merged row, with photos and voice available.
              void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
            })
            .catch((err: unknown) => Alert.alert('Could not create link', getApiErrorMessage(err)))
            .finally(() => setLinkBusy(false));
        },
      },
    ]);
  }, [linkBusy, phone, handleSendText, queryClient]);

  const handleLongPress = useCallback((message: Message) => {
    if (!message.text) return;
    Alert.alert('Message', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Copy', onPress: () => void Clipboard.setStringAsync(message.text ?? '') },
    ]);
  }, []);

  const name = formatPhoneForDisplay(phone) || phone;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      headerTitle: () => <ChatHeaderTitle foreground={headerFg} name={name} phone="SMS" withinWindow />,
      headerStyle: { backgroundColor: headerBg },
      headerTintColor: headerFg,
      headerTitleStyle: { color: headerFg },
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleSendLink}
            disabled={linkBusy}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Send private chat link by SMS"
          >
            {({ pressed }) => (
              <Ionicons name="link" size={23} color={headerFg} style={{ opacity: pressed || linkBusy ? 0.5 : 1 }} />
            )}
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(`tel:${phone}`)}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Call this number"
          >
            {({ pressed }) => <Ionicons name="call" size={22} color={headerFg} style={{ opacity: pressed ? 0.5 : 1 }} />}
          </Pressable>
        </View>
      ),
    });
  }, [navigation, name, phone, headerBg, headerFg, handleSendLink, linkBusy]);

  // Same keyboard handling as ConversationDetailScreen (edge-to-edge: the
  // window is not resized for the IME, so the inset is read on the UI thread).
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();
  const keyboardGone = useSharedValue(1);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      keyboardGone.value = 0;
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboardGone.value = 1;
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [keyboardGone]);
  const keyboardPadStyle = useAnimatedStyle(() => {
    const up =
      keyboardGone.value === 0 &&
      (keyboard.state.value === KeyboardState.OPEN || keyboard.state.value === KeyboardState.OPENING);
    return { paddingBottom: up ? Math.max(keyboard.height.value, insets.bottom) : insets.bottom };
  });
  const keyboardGapStyle = useAnimatedStyle(() => {
    const up =
      keyboardGone.value === 0 &&
      (keyboard.state.value === KeyboardState.OPEN || keyboard.state.value === KeyboardState.OPENING);
    return { height: up ? KEYBOARD_GAP : 0 };
  });

  const renderItem = useCallback(
    ({ item }: { item: RenderItem }) =>
      item.kind === 'separator' ? (
        <DateSeparator iso={item.iso} />
      ) : (
        <MessageBubble message={item.message} onLongPress={handleLongPress} onRetry={handleRetry} />
      ),
    [handleLongPress, handleRetry],
  );

  if (messagesQuery.isLoading) {
    return (
      <ThemeProvider colors={chatColors}>
        <Screen padded={false} edges={SCREEN_EDGES}>
          <View style={styles.flex}>
            <ChatWallpaper />
            <MessageListSkeleton />
          </View>
        </Screen>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider colors={chatColors}>
      <Screen padded={false} edges={SCREEN_EDGES}>
        <Animated.View style={[styles.flex, keyboardPadStyle, { backgroundColor: chatColors.surfaceElevated }]}>
          <View style={styles.flex}>
            <ChatWallpaper />
            <FlashList
              data={renderItems}
              inverted
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              renderItem={renderItem}
              drawDistance={600}
              contentContainerStyle={styles.listContent}
            />
            {/* The business flow's reply: one tap texts this customer the
                invitation template plus their own private chat link. */}
            <Pressable
              onPress={handleSendLink}
              disabled={linkBusy}
              accessibilityRole="button"
              accessibilityLabel="Send private chat invite by SMS"
              style={({ pressed }) => [
                styles.inviteBar,
                { backgroundColor: chatColors.surfaceElevated, borderColor: chatColors.border, opacity: pressed || linkBusy ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="link" size={18} color={chatColors.primary} />
              <Text style={[styles.inviteText, { color: chatColors.primary }]}>
                {linkBusy ? 'Preparing link…' : 'Send private chat invite'}
              </Text>
            </Pressable>
            <Composer
              conversationId={`${LOCAL_SMS_ID_PREFIX}${phone}`}
              whatsappPhoneNumberId={undefined}
              withinWindow
              sending={false}
              onSendText={handleSendText}
              onAttach={noop}
              onUseTemplate={noop}
              replyToMessageId={undefined}
              onSent={noop}
              nextNudge={null}
              whatsappRepliesLeft={null}
              onSendSms={noop}
              localOnly
            />
            <Animated.View style={keyboardGapStyle} />
          </View>
        </Animated.View>
      </Screen>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  inviteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginBottom: 6,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inviteText: { marginLeft: 8, fontSize: 14, fontWeight: '600' },
  listContent: { paddingVertical: 8, flexGrow: 1, justifyContent: 'flex-end' },
});
