import React, { useEffect, useState } from 'react';
import { FlatList, Keyboard, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { KeyboardState, useAnimatedKeyboard, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { Avatar } from '../../components/Avatar';
import { ThemeProvider, useTheme, useResolvedScheme } from '../../theme/ThemeProvider';
import { chatLightColors, chatDarkColors, chatHeaderBackground, chatHeaderForeground } from '../../theme/chatTheme';
import { formatMessageTime } from '../../utils/formatTime';
import { formatPhoneForDisplay } from '../../utils/formatPhone';
import { sendSmsAutomatically } from '../../utils/sendSms';
import { useLocalSmsThreads, type LocalSmsMessage } from './useLocalSmsThreads';
import type { ChatsStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'SmsThread'>;

interface OutgoingDraft {
  id: string;
  body: string;
  date: number;
}

/**
 * A lead SMS thread, shown the way a real conversation is — one bubble
 * per text, newest at the bottom, a box to reply from. Same chat palette
 * (chatLightColors/chatDarkColors) and header shape as the real
 * ConversationDetailScreen, so the two don't read as two different
 * products.
 *
 * Not a real conversation: there is no backend conversation or message
 * behind this screen at all. Everything it shows comes straight from the
 * device's own SMS inbox (useLocalSmsThreads), and a reply here just
 * sends another SMS off the agent's own SIM — this screen's only job is
 * to make that read like a thread instead of a bare SMS app. See the
 * "device only" choice this was built for: no server history, nothing a
 * teammate on another phone would see.
 *
 * No video call icon, ever, on purpose — video calling needs the private
 * chat's own live web session, which a pure SMS lead has never had. The
 * voice call icon dials the number as an ordinary phone call instead of
 * opening a web call, the same fallback ConversationDetailScreen itself
 * uses whenever there is no private chat window to ring into. If this
 * contact later moves to a real private chat, that promotes them to an
 * actual conversation — this screen stops being where they are reached at
 * all, and the real screen's full header (video icon included) applies.
 */
export function SmsThreadScreen(props: Props) {
  const scheme = useResolvedScheme();
  const chatColors = scheme === 'dark' ? chatDarkColors : chatLightColors;
  return (
    <ThemeProvider colors={chatColors}>
      <SmsThreadScreenInner {...props} />
    </ThemeProvider>
  );
}

function SmsThreadScreenInner({ route, navigation }: Props) {
  const scheme = useResolvedScheme();
  const { colors, spacing, radius, typography } = useTheme();
  const { phone } = route.params;

  // Same fix as ConversationDetailScreen's keyboardPadStyle, for the same
  // reason: plain KeyboardAvoidingView does not work on this app's
  // edge-to-edge (targetSdk 36) Android build — the composer stayed
  // pinned under the keyboard instead of rising above it, which is
  // exactly "the input hides" reported on this screen. useAnimatedKeyboard
  // reads the IME inset straight off WindowInsets on the UI thread, the
  // one source that stays correct under edge-to-edge.
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
  const { threads } = useLocalSmsThreads();
  const thread = threads.find((t) => t.phone === phone);
  const [text, setText] = useState('');
  // Optimistic: the OS inbox query won't see a just-sent SMS as "inbox"
  // (it's outbox), so a reply is held here until the next natural refresh.
  const [sentDrafts, setSentDrafts] = useState<OutgoingDraft[]>([]);

  const headerBg = chatHeaderBackground[scheme];
  const headerFg = chatHeaderForeground[scheme];
  const displayName = formatPhoneForDisplay(phone) || phone;

  useEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: headerBg },
      headerTintColor: headerFg,
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Avatar label={displayName} size={36} />
          <View style={styles.headerNames}>
            <Text style={[styles.headerName, { color: headerFg }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.headerSubtitle, { color: `${headerFg}A6` }]} numberOfLines={1}>
              SMS · not a WhatsApp chat
            </Text>
          </View>
        </View>
      ),
      // Voice only — see the component doc above for why there is no
      // video icon here at all.
      headerRight: () => (
        <Pressable
          onPress={() => void Linking.openURL(`tel:${phone}`)}
          hitSlop={8}
          style={{ paddingHorizontal: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Call this number"
        >
          {({ pressed }) => <Ionicons name="call" size={22} color={headerFg} style={{ opacity: pressed ? 0.5 : 1 }} />}
        </Pressable>
      ),
    });
  }, [navigation, headerBg, headerFg, displayName, phone]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    void sendSmsAutomatically(phone, trimmed);
    setSentDrafts((prev) => [...prev, { id: `draft-${Date.now()}`, body: trimmed, date: Date.now() }]);
    setText('');
  };

  type Row = { key: string; body: string; date: number; outgoing: boolean };
  const rows: Row[] = [
    ...(thread?.messages ?? []).map(
      (m: LocalSmsMessage): Row => ({ key: `in-${m.id}`, body: m.body, date: m.date, outgoing: false }),
    ),
    ...sentDrafts.map((d): Row => ({ key: d.id, body: d.body, date: d.date, outgoing: true })),
  ].sort((a, b) => a.date - b.date);

  return (
    <Screen padded={false} edges={['bottom']}>
      <Animated.View style={[styles.flex, keyboardPadStyle]}>
        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ padding: spacing.md, flexGrow: 1, justifyContent: 'flex-end' }}
          ListHeaderComponent={
            <View style={[styles.sourceNote, { marginBottom: spacing.md }]}>
              <Ionicons name="information-circle-outline" size={14} color={colors.textTertiary} />
              <Text style={[typography.caption, { color: colors.textTertiary, marginLeft: 4, flex: 1 }]}>
                From this phone&apos;s own SMS inbox — not synced to any other device.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubbleRow,
                { justifyContent: item.outgoing ? 'flex-end' : 'flex-start' },
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  {
                    backgroundColor: item.outgoing ? colors.bubbleSent : colors.bubbleReceived,
                    borderRadius: radius.lg,
                  },
                ]}
              >
                <Text
                  style={[
                    typography.body,
                    { color: item.outgoing ? colors.bubbleSentText : colors.bubbleReceivedText },
                  ]}
                >
                  {item.body}
                </Text>
                <Text
                  style={[
                    typography.caption,
                    {
                      color: colors.textTertiary,
                      marginTop: 4,
                      alignSelf: 'flex-end',
                    },
                  ]}
                >
                  {formatMessageTime(new Date(item.date).toISOString())}
                </Text>
              </View>
            </View>
          )}
        />

        <View
          style={[
            styles.composer,
            { backgroundColor: colors.surfaceElevated, borderTopColor: colors.divider, padding: spacing.sm },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Reply by SMS…"
            placeholderTextColor={colors.textTertiary}
            multiline
            style={[
              typography.body,
              {
                flex: 1,
                maxHeight: 100,
                backgroundColor: colors.surfaceAlt,
                borderRadius: radius.md,
                paddingHorizontal: 12,
                paddingVertical: 8,
                color: colors.textPrimary,
              },
            ]}
          />
          <Pressable
            onPress={send}
            disabled={!text.trim()}
            style={{ paddingHorizontal: 10, paddingVertical: 8, opacity: text.trim() ? 1 : 0.4 }}
            accessibilityRole="button"
            accessibilityLabel="Send by SMS"
          >
            <Ionicons name="send" size={22} color={colors.primary} />
          </Pressable>
        </View>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sourceNote: { flexDirection: 'row', alignItems: 'center' },
  bubbleRow: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '80%', paddingHorizontal: 12, paddingVertical: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  headerTitle: { flexDirection: 'row', alignItems: 'center' },
  headerNames: { marginLeft: 10, flexShrink: 1 },
  headerName: { fontSize: 17, fontWeight: '600' },
  headerSubtitle: { fontSize: 11, marginTop: 1 },
});
