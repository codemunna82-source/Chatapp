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
}

export function ChatListItem({ conversation, onPress, onTogglePin }: ChatListItemProps) {
  const { colors, spacing, typography } = useTheme();
  const label = conversation.contact?.name || conversation.contact?.phone || 'Unknown contact';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { padding: spacing.md, backgroundColor: pressed ? colors.surface : colors.background },
      ]}
    >
      <Avatar label={label} />
      <View style={[styles.middle, { marginLeft: spacing.md }]}>
        <View style={styles.topLine}>
          {conversation.pinned ? (
            <Ionicons name="pin" size={13} color={colors.textSecondary} style={{ marginRight: 4 }} />
          ) : null}
          <Text style={[typography.bodyMedium, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {formatChatListTime(conversation.lastMessageAt)}
          </Text>
        </View>
        <View style={styles.topLine}>
          <Text style={[typography.body, { color: colors.textSecondary, flex: 1 }]} numberOfLines={1}>
            {conversation.lastMessagePreview || 'No messages yet'}
          </Text>
          <Badge count={conversation.unreadCount} />
        </View>
      </View>
      <Pressable hitSlop={10} onPress={onTogglePin} style={{ marginLeft: spacing.xs, padding: spacing.xs }}>
        <Ionicons
          name={conversation.pinned ? 'pin' : 'pin-outline'}
          size={18}
          color={conversation.pinned ? colors.primary : colors.textSecondary}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  middle: { flex: 1 },
  topLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
});
