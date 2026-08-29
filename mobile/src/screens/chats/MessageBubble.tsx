import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { formatMessageTime } from '../../utils/formatTime';
import { MessageStatusIcon } from './MessageStatusIcon';
import { MediaImage } from './MediaImage';
import { MediaFileChip } from './MediaFileChip';
import { AudioMessageBubble } from './AudioMessageBubble';
import type { Message } from '../../api/types';
import type { ReactionSummary } from './deriveConversationView';

interface MessageBubbleProps {
  message: Message;
  replyTarget?: Message;
  reactions?: ReactionSummary;
  /**
   * These take the message rather than closing over it so the parent can
   * pass one stable callback for the whole list — an inline arrow per row
   * would change identity every render and defeat the React.memo below.
   */
  onLongPress: (message: Message) => void;
  onRetry: (message: Message) => void;
  /** Swipe right. Omit to disable the gesture for this row. */
  onReply?: (message: Message) => void;
  /** Swipe left. Omit if this message can't be forwarded. */
  onForward?: (message: Message) => void;
  /** Tapping a photo opens it full-screen; receives the cached local uri. */
  onOpenImage?: (localUri: string) => void;
  /** True while the screen is in multi-select mode. */
  selectable?: boolean;
  selected?: boolean;
  onSelectTap?: (message: Message) => void;
}

// How far the bubble must travel before the swipe counts as a reply, and how
// far it is allowed to travel at all.
const REPLY_TRIGGER_X = 56;
const REPLY_MAX_X = 76;

function MessageContent({
  message,
  textColor,
  onOpenImage,
}: {
  message: Message;
  textColor: string;
  onOpenImage?: (localUri: string) => void;
}) {
  const { typography } = useTheme();

  if (message.type === 'image' && (message.mediaId || message.localUri)) {
    return (
      <View>
        <MediaImage mediaId={message.mediaId} localUri={message.localUri} onOpen={onOpenImage} />
        {message.text ? <Text style={[typography.body, { color: textColor, marginTop: 6 }]}>{message.text}</Text> : null}
      </View>
    );
  }
  if (message.type === 'audio' && message.mediaId) {
    return <AudioMessageBubble mediaId={message.mediaId} tint={textColor} />;
  }
  if ((message.type === 'video' || message.type === 'document') && message.mediaId) {
    return <MediaFileChip mediaId={message.mediaId} type={message.type} />;
  }
  return <Text style={[typography.body, { color: textColor }]}>{message.text || `[${message.type}]`}</Text>;
}

function MessageBubbleImpl({
  message,
  replyTarget,
  reactions,
  onLongPress,
  onRetry,
  onReply,
  onForward,
  onOpenImage,
  selectable = false,
  selected = false,
  onSelectTap,
}: MessageBubbleProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const isOut = message.direction === 'OUT';
  const bubbleColor = isOut ? colors.bubbleSent : colors.bubbleReceived;
  const textColor = isOut ? colors.bubbleSentText : colors.bubbleReceivedText;
  const isFailed = message.status === 'FAILED';

  // Bound inside the memoized component, so these closures are recreated
  // only when this row actually re-renders.
  const handleLongPress = useCallback(() => onLongPress(message), [onLongPress, message]);
  // While selecting, a plain tap toggles this row instead of doing whatever
  // it normally would (retrying a failed send, opening a photo).
  const handlePress = useCallback(() => {
    if (selectable) {
      onSelectTap?.(message);
      return;
    }
    if (isFailed) onRetry(message);
  }, [selectable, onSelectTap, message, isFailed, onRetry]);

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

  // --- swipe-to-reply -----------------------------------------------------
  const translateX = useSharedValue(0);
  const triggered = useSharedValue(0);

  const fireReply = useCallback(() => {
    onReply?.(message);
  }, [onReply, message]);
  const fireForward = useCallback(() => {
    onForward?.(message);
  }, [onForward, message]);

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        // Only claim the touch once it is clearly horizontal: activeOffsetX
        // lets a vertical drag through to the message list untouched, and
        // failOffsetY hard-fails this gesture the moment the finger commits
        // to scrolling. Without both, the swipe fights the list.
        .activeOffsetX([-14, 14])
        .failOffsetY([-12, 12])
        .enabled(Boolean(onReply || onForward))
        .onUpdate((e) => {
          /* eslint-disable react-hooks/immutability -- shared-value writes in a worklet are Reanimated's documented pattern */
          // Right = reply, left = forward, the same way round for every
          // message regardless of who sent it. Travel is clamped so a
          // bubble can never be dragged off-screen, and a direction with no
          // handler simply doesn't move.
          const raw = e.translationX;
          const allowed = raw > 0 ? Boolean(onReply) : Boolean(onForward);
          if (!allowed) {
            translateX.value = 0;
            triggered.value = 0;
            return;
          }
          translateX.value = Math.abs(raw) > REPLY_MAX_X ? Math.sign(raw) * REPLY_MAX_X : raw;
          triggered.value = Math.abs(translateX.value) >= REPLY_TRIGGER_X ? Math.sign(translateX.value) : 0;
          /* eslint-enable react-hooks/immutability */
        })
        .onEnd(() => {
          if (triggered.value === 1) {
            runOnJS(fireReply)();
          } else if (triggered.value === -1) {
            runOnJS(fireForward)();
          }
          /* eslint-disable react-hooks/immutability */
          translateX.value = withTiming(0, { duration: 160 });
          triggered.value = 0;
          /* eslint-enable react-hooks/immutability */
        }),
    [fireReply, fireForward, onReply, onForward, translateX, triggered],
  );

  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const replyHintStyle = useAnimatedStyle(() => ({
    opacity: translateX.value > 0 ? Math.min(1, translateX.value / REPLY_TRIGGER_X) : 0,
  }));
  const forwardHintStyle = useAnimatedStyle(() => ({
    opacity: translateX.value < 0 ? Math.min(1, -translateX.value / REPLY_TRIGGER_X) : 0,
  }));

  return (
    <GestureDetector gesture={swipeGesture}>
      <Animated.View
        style={[
          styles.row,
          {
            justifyContent: isOut ? 'flex-end' : 'flex-start',
            paddingHorizontal: spacing.md,
            // A tinted band across the full row makes the selection read at
            // a glance, the way it does in a mail client.
            backgroundColor: selected ? colors.primaryMuted : 'transparent',
          },
        ]}
      >
        {/* The reply arrow sits behind the bubble and fades in as it slides. */}
        {/* Reply arrow on the left (revealed by a right swipe), forward
            arrow on the right (revealed by a left swipe). */}
        <Animated.View style={[styles.replyHint, styles.hintLeft, replyHintStyle]} pointerEvents="none">
          <Ionicons name="arrow-undo" size={18} color={colors.textSecondary} />
        </Animated.View>
        <Animated.View style={[styles.replyHint, styles.hintRight, forwardHintStyle]} pointerEvents="none">
          <Ionicons name="arrow-redo" size={18} color={colors.textSecondary} />
        </Animated.View>
        {selectable ? (
          <View style={[styles.checkWrap, isOut ? styles.checkOut : styles.checkIn]}>
            <Ionicons
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={selected ? colors.primary : colors.textTertiary}
            />
          </View>
        ) : null}
        <Animated.View style={[styles.bubbleShift, bubbleStyle, isOut ? styles.shiftOut : styles.shiftIn]}>
      <Pressable
        onLongPress={handleLongPress}
        onPress={selectable || isFailed ? handlePress : undefined}
        accessibilityState={selectable ? { selected } : undefined}
        style={[
          styles.bubble,
          bubbleRadius,
          {
            backgroundColor: bubbleColor,
            paddingHorizontal: spacing.sm + 4,
            paddingVertical: spacing.xs + 4,
            marginVertical: 2,
            // Every bubble carries a themed border (gold, per the chat
            // screen's own palette in chatTheme.ts) — a failed send
            // overrides it with the danger color to keep that state visible.
            borderWidth: 1,
            borderColor: isFailed ? colors.danger : colors.border,
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

        <MessageContent message={message} textColor={textColor} onOpenImage={onOpenImage} />

        <View style={styles.footer}>
          {message.starredAt ? (
            <Ionicons name="star" size={11} color={textColor} style={styles.starMark} />
          ) : null}
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
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Memoized: a conversation renders one of these per message, and the screen
 * above re-renders on unrelated state (typing indicator, reply target,
 * toasts). Without this every bubble — including its images, audio players
 * and gesture handlers — was rebuilt each time. All props are either stable
 * identities from the react-query cache or the stable callbacks described
 * in MessageBubbleProps, so the default shallow compare is correct here.
 */
export const MessageBubble = React.memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  // Sits with the timestamp rather than over the text: it marks the message
  // without competing with what the message says.
  starMark: { marginRight: 4, opacity: 0.75 },
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '100%' },
  bubbleShift: { maxWidth: '80%' },
  shiftOut: { alignItems: 'flex-end' },
  shiftIn: { alignItems: 'flex-start' },
  replyHint: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  hintLeft: { left: 4 },
  hintRight: { right: 4 },
  checkWrap: { justifyContent: 'center' },
  checkIn: { marginRight: 6 },
  checkOut: { marginRight: 6 },
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
