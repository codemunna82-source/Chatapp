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
import { VideoMessageBubble } from './VideoMessageBubble';
import { AudioMessageBubble } from './AudioMessageBubble';
import type { Message } from '../../api/types';
import { impactLight, impactMedium } from '../../utils/haptics';
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

/** Hairline of bubble colour left around edge-to-edge media, so the bubble still frames it. */
const BLEED_FRAME = 3;

/**
 * True for the message shapes whose media fills the bubble edge to edge.
 *
 * Those get a thin frame instead of the usual padding, so a photo or video
 * reads as the message rather than as an illustration inside a text
 * bubble — and the caption below it gets its own padded strip, visually
 * separate from the media instead of butting straight against it.
 */
function isEdgeToEdgeMedia(message: Message): boolean {
  if (message.type === 'image') return Boolean(message.mediaId || message.localUri);
  if (message.type === 'video') return Boolean(message.mediaId || message.localUri);
  return false;
}

/** Whether MessageContent will render something for this message, as opposed to falling through to a type label. */
function hasRenderableMedia(message: Message): boolean {
  if (message.type === 'image' || message.type === 'video') return Boolean(message.mediaId || message.localUri);
  if (message.type === 'audio' || message.type === 'document') return Boolean(message.mediaId);
  return false;
}

function MessageContent({
  message,
  textColor,
  onOpenImage,
  onLongPress,
}: {
  message: Message;
  /** Tint for media chrome that sits on the bubble rather than on the media itself (the audio scrubber). */
  textColor: string;
  onOpenImage?: (localUri: string) => void;
  /**
   * Forwarded into every media child that renders its own Pressable.
   *
   * A nested Pressable becomes the touch responder and swallows the long
   * press, so the bubble's own onLongPress never fires — which is why the
   * action sheet worked on text messages (no inner Pressable) but not on a
   * photo, a voice note or a file. Handing the same handler down is what
   * makes long-press work everywhere; the children keep their own onPress
   * for opening, playing and sharing.
   */
  onLongPress: () => void;
}) {
  if (message.type === 'image' && (message.mediaId || message.localUri)) {
    return (
      <MediaImage
        mediaId={message.mediaId}
        localUri={message.localUri}
        onOpen={onOpenImage}
        onLongPress={onLongPress}
      />
    );
  }
  if (message.type === 'video' && (message.mediaId || message.localUri)) {
    return <VideoMessageBubble mediaId={message.mediaId} localUri={message.localUri} onLongPress={onLongPress} />;
  }
  if (message.type === 'audio' && message.mediaId) {
    return <AudioMessageBubble mediaId={message.mediaId} tint={textColor} onLongPress={onLongPress} />;
  }
  if (message.type === 'document' && message.mediaId) {
    return <MediaFileChip mediaId={message.mediaId} type={message.type} onLongPress={onLongPress} />;
  }
  return null;
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
  const bleed = isEdgeToEdgeMedia(message);
  // Applied to the caption, the reply quote and the footer when the media
  // is edge-to-edge, so they sit on the same left margin they would have
  // had in a plain text bubble.
  const insetWhenBleeding = bleed ? { paddingHorizontal: spacing.xs, paddingTop: spacing.xs } : null;

  // Bound inside the memoized component, so these closures are recreated
  // only when this row actually re-renders.
  const handleLongPress = useCallback(() => {
    // The one place a tick genuinely earns its keep: a long press has no
    // visual feedback until the sheet actually appears, so without it the
    // user cannot tell whether the gesture registered.
    impactMedium();
    onLongPress(message);
  }, [onLongPress, message]);
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
    // Fired from the gesture's onEnd via runOnJS, so this confirms the
    // swipe crossed the threshold — the bubble has already sprung back by
    // the time anything else appears.
    impactLight();
    onReply?.(message);
  }, [onReply, message]);
  const fireForward = useCallback(() => {
    impactLight();
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
            // A photo or video fills the bubble, leaving only a hairline
            // frame of bubble colour around it; everything else keeps the
            // normal text padding. The caption and footer below re-add
            // their own inset so they never touch the media's edge.
            paddingHorizontal: bleed ? BLEED_FRAME : spacing.sm + 4,
            paddingVertical: bleed ? BLEED_FRAME : spacing.xs + 4,
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
              bleed ? styles.replyBlockBleeding : null,
            ]}
          >
            <Text style={[typography.caption, { color: isOut ? colors.bubbleSentText : colors.textSecondary, opacity: 0.85 }]} numberOfLines={1}>
              {replyTarget.text || `[${replyTarget.type}]`}
            </Text>
          </View>
        ) : null}

        <MessageContent
          message={message}
          textColor={textColor}
          onOpenImage={onOpenImage}
          onLongPress={handleLongPress}
        />

        {/* The caption is its own block under the media rather than text
            crammed against the photo's bottom edge — which is what made a
            captioned photo read as one undifferentiated smudge. For a
            plain text message this IS the message, and the branch is the
            same either way. */}
        {message.text ? (
          <View style={insetWhenBleeding}>
            <Text style={[typography.body, { color: textColor }]}>{message.text}</Text>
          </View>
        ) : null}

        {/* A media message with no caption still needs something in the
            bubble when the media type isn't one this app can render. */}
        {!message.text && !hasRenderableMedia(message) ? (
          <Text style={[typography.body, { color: textColor }]}>{`[${message.type}]`}</Text>
        ) : null}

        <View style={[styles.footer, insetWhenBleeding]}>
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
  // The quote would otherwise start at the media's own left edge, with no
  // gap at all, once the bubble's padding is gone.
  replyBlockBleeding: { marginLeft: 4, marginTop: 3, marginRight: 4 },
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
