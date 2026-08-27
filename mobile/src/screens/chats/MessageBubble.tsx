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

function MessageContent({ message, textColor }: { message: Message; textColor: string }) {
  const { typography } = useTheme();

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
  const bubbleColor = isOut ? colors.bubbleSent : colors.bubbleReceived;
  const textColor = isOut ? colors.bubbleSentText : colors.bubbleReceivedText;
  const isFailed = message.status === 'FAILED';

  const activeReactions = reactions ? [reactions.IN, reactions.OUT].filter((e): e is string => Boolean(e)) : [];

  // A soft "tail" corner (WhatsApp/iMessage-style, without copying either's
  // exact bubble shape) — the corner nearest the sender's own side of the
  // screen is pinched in, giving each bubble a subtle directional read even
  // at a glance, before the alignment itself registers.
  const bubbleRadius = {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: isOut ? radius.lg : radius.sm,
    borderBottomRightRadius: isOut ? radius.sm : radius.lg,
  };

  return (
    <View style={[styles.row, { justifyContent: isOut ? 'flex-end' : 'flex-start', paddingHorizontal: spacing.md }]}>
      <Pressable
        onLongPress={onLongPress}
        onPress={isFailed ? onRetry : undefined}
        style={[
          styles.bubble,
          bubbleRadius,
          {
            backgroundColor: bubbleColor,
            paddingHorizontal: spacing.sm + 4,
            paddingVertical: spacing.xs + 4,
            marginVertical: 2,
            borderWidth: isFailed ? 1 : 0,
            borderColor: colors.danger,
          },
        ]}
      >
        {replyTarget ? (
          <View
            style={[
              styles.replyBlock,
              { borderLeftColor: isOut ? colors.bubbleSentText : colors.primary, marginBottom: spacing.xs },
            ]}
          >
            <Text style={[typography.caption, { color: isOut ? colors.bubbleSentText : colors.textSecondary, opacity: 0.85 }]} numberOfLines={1}>
              {replyTarget.text || `[${replyTarget.type}]`}
            </Text>
          </View>
        ) : null}

        <MessageContent message={message} textColor={textColor} />

        <View style={styles.footer}>
          {isFailed ? (
            <Text style={[typography.caption, { color: colors.danger, marginRight: 4 }]}>Failed · tap to retry</Text>
          ) : null}
          <Text style={[typography.caption, { color: textColor, opacity: 0.7 }]}>
            {formatMessageTime(message.createdAt)}
          </Text>
          {isOut ? (
            <View style={{ marginLeft: 4 }}>
              <MessageStatusIcon status={message.status} />
            </View>
          ) : null}
        </View>

        {activeReactions.length > 0 ? (
          <View
            style={[
              styles.reactions,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              styles.reactionsShadow,
            ]}
          >
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
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  reactionsShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  reactionText: { fontSize: 12 },
});
