import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { useTheme } from '../../theme/ThemeProvider';
import { IconButton } from '../../components/IconButton';
import { touchTarget } from '../../theme/spacing';
import { formatChatListTime } from '../../utils/formatTime';
import type { Conversation } from '../../api/types';

interface ChatListItemProps {
  conversation: Conversation;
  onPress: (conversation: Conversation) => void;
  onTogglePin: (conversation: Conversation) => void;
  onArchive: (conversation: Conversation) => void;
}

function ChatListItemImpl({ conversation, onPress, onTogglePin, onArchive }: ChatListItemProps) {
  const handlePress = useCallback(() => onPress(conversation), [onPress, conversation]);
  const handleTogglePin = useCallback(() => onTogglePin(conversation), [onTogglePin, conversation]);
  const handleArchive = useCallback(() => onArchive(conversation), [onArchive, conversation]);
  const isArchived = conversation.status === 'ARCHIVED';
  const { colors, spacing, typography } = useTheme();
  const label = conversation.contact?.name || conversation.contact?.phone || 'Unknown contact';
  const unread = conversation.unreadCount > 0;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        { paddingVertical: spacing.sm + 4, paddingHorizontal: spacing.md, backgroundColor: pressed ? colors.surface : colors.background },
      ]}
    >
      <Avatar label={label} size={52} />
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
          <Badge count={conversation.unreadCount} />
        </View>
      </View>
      <View style={styles.actions}>
        <IconButton
          name={conversation.pinned ? 'pin' : 'pin-outline'}
          size={17}
          color={conversation.pinned ? colors.primary : colors.textTertiary}
          touchSize={touchTarget.compact}
          onPress={handleTogglePin}
          accessibilityLabel={conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
        />
        <IconButton
          name={isArchived ? 'arrow-undo-outline' : 'archive-outline'}
          size={17}
          color={colors.textTertiary}
          touchSize={touchTarget.compact}
          onPress={handleArchive}
          accessibilityLabel={isArchived ? 'Restore conversation' : 'Archive conversation'}
        />
      </View>
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
  actions: { marginLeft: 4 },
});
