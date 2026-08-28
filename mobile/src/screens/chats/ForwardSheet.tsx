import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetFlatList, type BottomSheetModal } from '@gorhom/bottom-sheet';
import { AppBottomSheet } from '../../components/AppBottomSheet';
import { Avatar } from '../../components/Avatar';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { useConversations, flattenConversations } from '../../queries/useConversations';
import { sendMessage as sendMessageRequest } from '../../api/endpoints/messages';
import { getApiErrorMessage } from '../../api/client';
import type { SendMessageBody } from '../../api/endpoints/messages';
import type { Conversation, Message } from '../../api/types';

interface ForwardSheetProps {
  visible: boolean;
  /** The message being forwarded; null closes the sheet. */
  message: Message | null;
  /** Excluded from the target list — forwarding into the current chat is pointless. */
  currentConversationId: string;
  onClose: () => void;
  onForwarded: (conversationName: string) => void;
}

/**
 * Turns a message into the send body needed to re-send it elsewhere.
 * Returns null for anything that can't meaningfully be forwarded.
 *
 * Media forwards by re-using the same stored mediaId rather than
 * re-uploading: the backend's media records are tenant-scoped, and both
 * conversations belong to the same tenant, so the second send resolves the
 * very same asset.
 */
export function buildForwardBody(message: Message): SendMessageBody | null {
  if (message.type === 'text') {
    return message.text ? { type: 'text', text: message.text } : null;
  }
  if (
    (message.type === 'image' || message.type === 'video' || message.type === 'audio' || message.type === 'document') &&
    message.mediaId
  ) {
    // The caption travels with the media, the reply reference deliberately
    // does not — the message it pointed at doesn't exist in the target chat.
    return { type: message.type, mediaId: message.mediaId, caption: message.text || undefined };
  }
  // Reactions and templates aren't forwardable: a reaction is meaningless
  // without its target, and a template send needs its own name/language
  // payload that the stored message doesn't carry back.
  return null;
}

export function ForwardSheet({ visible, message, currentConversationId, onClose, onForwarded }: ForwardSheetProps) {
  const { colors, spacing, typography } = useTheme();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const conversationsQuery = useConversations({});
  const conversations = flattenConversations(conversationsQuery.data);

  const targets = useMemo(
    () => conversations.filter((c) => c.id !== currentConversationId),
    [conversations, currentConversationId],
  );

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const handleSheetChange = (index: number) => {
    if (index >= 0) setError(null);
  };

  const handlePick = async (target: Conversation) => {
    if (!message || sendingTo) return;
    const body = buildForwardBody(message);
    if (!body) {
      setError('This message type can’t be forwarded.');
      return;
    }
    setSendingTo(target.id);
    setError(null);
    try {
      await sendMessageRequest(target.id, body);
      onForwarded(target.contact?.name || target.contact?.phone || 'that chat');
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not forward that message.'));
    } finally {
      setSendingTo(null);
    }
  };

  const renderItem = ({ item }: { item: Conversation }) => {
    const label = item.contact?.name || item.contact?.phone || 'Unknown contact';
    // Outside the 24h customer-service window only templates may be sent, so
    // a forward there would be rejected by the backend. Show it, but say why
    // it's unavailable rather than letting the tap fail.
    const blocked = !item.withinCustomerServiceWindow;
    const isSending = sendingTo === item.id;

    return (
      <Pressable
        onPress={() => handlePick(item)}
        disabled={blocked || Boolean(sendingTo)}
        style={[styles.row, { paddingHorizontal: spacing.lg }]}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
        accessibilityLabel={blocked ? `${label} — outside the 24 hour reply window` : `Forward to ${label}`}
      >
        {({ pressed }) => (
          <View style={[styles.rowInner, { opacity: blocked ? 0.45 : pressed ? 0.6 : 1 }]}>
            <Avatar label={label} size={40} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
                {label}
              </Text>
              {blocked ? (
                <Text style={[typography.caption, { color: colors.textTertiary }]} numberOfLines={1}>
                  Outside the 24h reply window
                </Text>
              ) : null}
            </View>
            {isSending ? <ActivityIndicator color={colors.primary} size="small" /> : null}
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <AppBottomSheet ref={sheetRef} snapPoints={SNAP_POINTS} onDismiss={onClose} onChange={handleSheetChange}>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Text style={[typography.heading, { color: colors.textPrimary }]}>Forward to</Text>
        {error ? <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
      </View>

      {conversationsQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : targets.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="chatbubbles-outline" size={28} color={colors.textTertiary} />
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>
            No other conversations to forward to.
          </Text>
        </View>
      ) : (
        <BottomSheetFlatList
          data={targets}
          keyExtractor={(item: Conversation) => item.id}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      )}
    </AppBottomSheet>
  );
}

const SNAP_POINTS = ['60%'];

const styles = StyleSheet.create({
  list: { flex: 1 },
  row: { minHeight: touchTarget.min + 12, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  centered: { alignItems: 'center', padding: 24 },
});
