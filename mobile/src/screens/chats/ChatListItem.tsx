import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { useTheme } from '../../theme/ThemeProvider';
import { formatChatListTime } from '../../utils/formatTime';
import type { Conversation } from '../../api/types';

interface ChatListItemProps {
  conversation: Conversation;
  onPress: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
}

export function ChatListItem({ conversation, onPress, onTogglePin, onArchive }: ChatListItemProps) {
  const { colors, spacing, typography } = useTheme();
  const label = conversation.contact?.name || conversation.contact?.phone || 'Unknown contact';
  const unread = conversation.unreadCount > 0;

  return (
    <Pressable
      onPress={onPress}
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
        <Pressable hitSlop={10} onPress={onTogglePin} style={styles.actionButton} accessibilityLabel="Pin conversation">
          <Ionicons
            name={conversation.pinned ? 'pin' : 'pin-outline'}
            size={17}
            color={conversation.pinned ? colors.primary : colors.textTertiary}
          />
        </Pressable>
        <Pressable hitSlop={10} onPress={onArchive} style={styles.actionButton} accessibilityLabel="Archive conversation">
          <Ionicons name="archive-outline" size={17} color={colors.textTertiary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  middle: { flex: 1 },
  topLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  actions: { marginLeft: 4 },
  actionButton: { padding: 6 },
});
