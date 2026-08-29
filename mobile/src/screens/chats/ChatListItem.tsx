import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { useTheme } from '../../theme/ThemeProvider';
import { formatChatListTime } from '../../utils/formatTime';
import type { Conversation } from '../../api/types';

interface ChatListItemProps {
  conversation: Conversation;
  onPress: (conversation: Conversation) => void;
  /** Long-press opens the chat's action sheet (pin / archive / delete),
   *  or starts a multi-selection when the list is not already selecting. */
  onLongPress: (conversation: Conversation) => void;
  /** While selecting, a plain tap toggles this row instead of opening it. */
  selectable?: boolean;
  selected?: boolean;
}

function ChatListItemImpl({
  conversation,
  onPress,
  onLongPress,
  selectable = false,
  selected = false,
}: ChatListItemProps) {
  const handlePress = useCallback(() => onPress(conversation), [onPress, conversation]);
  const handleLongPress = useCallback(() => onLongPress(conversation), [onLongPress, conversation]);
  const { colors, spacing, typography } = useTheme();
  const label = conversation.contact?.name || conversation.contact?.phone || 'Unknown contact';
  // A manually-unread chat reads as unread without claiming a message count
  // it does not have — see Conversation.manuallyUnread.
  const unread = conversation.unreadCount > 0 || conversation.manuallyUnread;

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      accessibilityRole="button"
      accessibilityState={selectable ? { selected } : undefined}
      style={({ pressed }) => [
        styles.row,
        {
          paddingVertical: spacing.sm + 4,
          paddingHorizontal: spacing.md,
          backgroundColor: selected ? colors.primaryMuted : pressed ? colors.surface : colors.background,
        },
      ]}
    >
      <View>
        <Avatar label={label} size={52} />
        {selectable && selected ? (
          <View style={[styles.checkMark, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Ionicons name="checkmark" size={12} color={colors.textOnPrimary} />
          </View>
        ) : null}
      </View>
      <View style={[styles.middle, { marginLeft: spacing.md }]}>
        <View style={styles.topLine}>
          {conversation.pinned ? (
            <Ionicons name="pin" size={12} color={colors.textTertiary} style={{ marginRight: 4 }} />
          ) : null}
          <Text
            style={[unread ? typography.bodyMedium : typography.body, { color: colors.textPrimary, flex: 1 }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Text style={[typography.caption, { color: unread ? colors.primary : colors.textTertiary }]}>
            {formatChatListTime(conversation.lastMessageAt)}
          </Text>
        </View>
        <View style={styles.topLine}>
          <Text
            style={[typography.body, { color: unread ? colors.textPrimary : colors.textSecondary, flex: 1 }]}
            numberOfLines={1}
          >
            {conversation.lastMessagePreview || 'No messages yet'}
          </Text>
          {/* The badge stays the REAL count: a manually-unread chat with
              nothing actually unread shows the dot below, not a "1". */}
          {conversation.unreadCount > 0 ? (
            <Badge count={conversation.unreadCount} />
          ) : conversation.manuallyUnread ? (
            <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
          ) : null}
        </View>
      </View>
      {conversation.pinned ? (
        <View style={styles.pinnedMark}>
          <Ionicons name="pin" size={14} color={colors.textTertiary} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Memoized: list rows re-render whenever the screen above them does (search
 * text, a refetch, a sheet opening). The callbacks take their item rather
 * than closing over it so the parent can pass one stable function per list.
 */
export const ChatListItem = React.memo(ChatListItemImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  middle: { flex: 1 },
  topLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  pinnedMark: { marginLeft: 6 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 6 },
  checkMark: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
