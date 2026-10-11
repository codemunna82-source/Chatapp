import React, { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { useTheme } from '../../theme/ThemeProvider';
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
 * per text, newest at the bottom, a box to reply from.
 *
 * Not a real conversation: there is no backend conversation or message
 * behind this screen at all. Everything it shows comes straight from the
 * device's own SMS inbox (useLocalSmsThreads), and a reply here just
 * sends another SMS off the agent's own SIM — this screen's only job is
 * to make that read like a thread instead of a bare SMS app. See the
 * "device only" choice this was built for: no server history, nothing a
 * teammate on another phone would see.
 */
export function SmsThreadScreen({ route, navigation }: Props) {
  const { phone } = route.params;
  const { colors, spacing, radius, typography } = useTheme();
  const { threads } = useLocalSmsThreads();
  const thread = threads.find((t) => t.phone === phone);
  const [text, setText] = useState('');
  // Optimistic: the OS inbox query won't see a just-sent SMS as "inbox"
  // (it's outbox), so a reply is held here until the next natural refresh.
  const [sentDrafts, setSentDrafts] = useState<OutgoingDraft[]>([]);

  useEffect(() => {
    navigation.setOptions({ title: formatPhoneForDisplay(phone) || phone });
  }, [navigation, phone]);

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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
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
                    backgroundColor: item.outgoing ? colors.primary : colors.surfaceAlt,
                    borderRadius: radius.lg,
                  },
                ]}
              >
                <Text style={[typography.body, { color: item.outgoing ? colors.textOnPrimary : colors.textPrimary }]}>
                  {item.body}
                </Text>
                <Text
                  style={[
                    typography.caption,
                    {
                      color: item.outgoing ? colors.textOnPrimary : colors.textTertiary,
                      opacity: 0.8,
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
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sourceNote: { flexDirection: 'row', alignItems: 'center' },
  bubbleRow: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '80%', paddingHorizontal: 12, paddingVertical: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
