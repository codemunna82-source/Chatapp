import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { formatMessageTime } from '../../utils/formatTime';
import { MessageStatusIcon } from './MessageStatusIcon';
import { MediaImage } from './MediaImage';
import { MediaFileChip } from './MediaFileChip';
import type { Message } from '../../api/types';
import type { ReactionSummary } from './deriveConversationView';

interface MessageBubbleProps {
  message: Message;
  replyTarget?: Message;
  reactions?: ReactionSummary;
  onLongPress: () => void;
  onRetry: () => void;
}

function MessageContent({ message }: { message: Message }) {
  const { colors, typography } = useTheme();
  const textColor = message.direction === 'OUT' ? colors.textOnPrimary : colors.textPrimary;

  if (message.type === 'image' && message.mediaId) {
    return (
      <View>
        <MediaImage mediaId={message.mediaId} />
        {message.text ? <Text style={[typography.body, { color: textColor, marginTop: 6 }]}>{message.text}</Text> : null}
      </View>
    );
  }
  if ((message.type === 'video' || message.type === 'audio' || message.type === 'document') && message.mediaId) {
    return <MediaFileChip mediaId={message.mediaId} type={message.type} />;
  }
  return <Text style={[typography.body, { color: textColor }]}>{message.text || `[${message.type}]`}</Text>;
}

export function MessageBubble({ message, replyTarget, reactions, onLongPress, onRetry }: MessageBubbleProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const isOut = message.direction === 'OUT';
  const bubbleColor = isOut ? colors.primary : colors.surface;

  const activeReactions = reactions ? [reactions.IN, reactions.OUT].filter((e): e is string => Boolean(e)) : [];

  return (
    <View style={[styles.row, { justifyContent: isOut ? 'flex-end' : 'flex-start', paddingHorizontal: spacing.md }]}>
      <Pressable
        onLongPress={onLongPress}
        onPress={message.status === 'FAILED' ? onRetry : undefined}
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleColor,
            borderRadius: radius.md,
            padding: spacing.sm,
            marginVertical: 2,
          },
        ]}
      >
        {replyTarget ? (
          <View
            style={[
              styles.replyBlock,
              { borderLeftColor: isOut ? colors.textOnPrimary : colors.primary, marginBottom: spacing.xs },
            ]}
          >
            <Text style={[typography.caption, { color: isOut ? colors.textOnPrimary : colors.textSecondary }]} numberOfLines={1}>
              {replyTarget.text || `[${replyTarget.type}]`}
            </Text>
          </View>
        ) : null}

        <MessageContent message={message} />

        <View style={styles.footer}>
          <Text style={[typography.caption, { color: isOut ? colors.textOnPrimary : colors.textSecondary, opacity: 0.8 }]}>
            {formatMessageTime(message.createdAt)}
          </Text>
          {isOut ? (
            <View style={{ marginLeft: 4 }}>
              <MessageStatusIcon status={message.status} />
            </View>
          ) : null}
        </View>

        {activeReactions.length > 0 ? (
          <View style={[styles.reactions, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={styles.reactionText}>{activeReactions.join(' ')}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '80%' },
  replyBlock: { borderLeftWidth: 2, paddingLeft: 6 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  reactions: {
    position: 'absolute',
    bottom: -10,
    right: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  reactionText: { fontSize: 12 },
});
