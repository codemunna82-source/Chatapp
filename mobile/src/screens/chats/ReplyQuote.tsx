import React, { useEffect, useState } from 'react';
import { Image, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { downloadMedia } from './mediaCache';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';
import type { Message } from '../../api/types';

/**
 * The quoted message inside a reply.
 *
 * One component for both places a quote appears — above the composer
 * while a reply is being written, and inside the bubble once it is sent —
 * because they are the same thing seen twice, and they had drifted into
 * saying it differently.
 *
 * What it replaces: both printed `message.text || "[image]"`. A reply to a
 * photo therefore quoted the literal word "[image]", which tells the
 * reader nothing about WHICH photo — and in a thread where someone has
 * just sent nine of them, that is the entire question.
 */

/** The thumbnail's side, in layout units. Big enough to recognise a face
 *  in, small enough that two lines of text still fit beside it. */
const THUMB = 38;

/** Media kinds that have a picture worth showing. A document or a voice
 *  note has no frame to put here, and an icon says more than a grey box. */
function thumbnailIdOf(message: Message): string | undefined {
  if (message.revokedAt) return undefined;
  if (message.type !== 'image') return undefined;
  return message.mediaId;
}

/**
 * The line beside the thumbnail.
 *
 * A caption wins over the type word: someone who wrote "the blue one" on a
 * photo has already said what it is better than "Photo" can.
 */
function describe(message: Message): { label: string; icon?: keyof typeof Ionicons.glyphMap } {
  if (message.revokedAt) return { label: 'This message was deleted', icon: 'ban-outline' };
  if (message.text) {
    switch (message.type) {
      case 'image':
        return { label: message.text, icon: 'image' };
      case 'video':
        return { label: message.text, icon: 'videocam' };
      default:
        return { label: message.text };
    }
  }
  switch (message.type) {
    case 'image':
      return { label: 'Photo', icon: 'image' };
    case 'video':
      return { label: 'Video', icon: 'videocam' };
    case 'audio':
      return { label: 'Voice message', icon: 'mic' };
    case 'document':
      return { label: 'Document', icon: 'document-text' };
    case 'location':
      return { label: 'Location', icon: 'location' };
    case 'sticker':
      return { label: 'Sticker', icon: 'happy-outline' };
    default:
      return { label: `[${message.type}]` };
  }
}

/**
 * The quoted photo itself.
 *
 * Downloaded through the same cache the bubble uses, so quoting a photo
 * that is already on screen costs nothing — and asks the server for a
 * thumbnail-sized copy rather than the full picture, which is the whole
 * reason this does not simply reuse MediaImage.
 *
 * Draws nothing until it has the file. A spinner in a 38px box is a grey
 * smear, and the label beside it already says a photo is there.
 *
 * Remounted per photo by its `key` at the call site rather than clearing
 * its own state when the id changes. FlashList recycles these rows, so
 * the same instance is handed a different photo as the thread scrolls,
 * and a reset inside the effect body would be a setState during render —
 * the React-recommended way to reset state on a prop change is the key
 * (the same shape Avatar uses, for the same reason).
 */
function QuoteThumbnail({ mediaId }: { mediaId: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { colors, radius } = useTheme();
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const file = await downloadMedia(
          mediaId,
          accessToken,
          PixelRatio.getPixelSizeForLayoutSize(THUMB),
        );
        if (!cancelled) setUri(file);
      } catch {
        // No photo, offline, or a session that has expired. The label
        // beside this still says what was quoted.
      }
    })();
    return () => {
      // The row can scroll away mid-download; FlashList recycles these.
      cancelled = true;
    };
  }, [mediaId, accessToken]);

  return (
    <View
      style={[
        styles.thumb,
        { borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
      ]}
    >
      {uri ? <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" /> : null}
    </View>
  );
}

export function ReplyQuote({
  target,
  /** The accent down the leading edge and on the icon. */
  tint,
  /** The label colour, so this reads on both bubble colours. */
  textColor,
}: {
  target: Message;
  tint: string;
  textColor: string;
}) {
  const { spacing, typography, radius } = useTheme();
  const thumbnailId = thumbnailIdOf(target);
  const { label, icon } = describe(target);

  return (
    <View style={[styles.row, { borderRadius: radius.sm }]}>
      <View style={[styles.bar, { backgroundColor: tint }]} />
      <View style={[styles.body, { paddingHorizontal: spacing.sm }]}>
        <Text
          style={[typography.caption, { color: textColor, opacity: 0.85 }]}
          numberOfLines={thumbnailId ? 2 : 1}
        >
          {icon ? (
            <Text>
              <Ionicons name={icon} size={12} color={textColor} />
              {'  '}
            </Text>
          ) : null}
          {label}
        </Text>
      </View>
      {thumbnailId ? <QuoteThumbnail key={thumbnailId} mediaId={thumbnailId} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden', minHeight: THUMB },
  bar: { width: 3, alignSelf: 'stretch' },
  body: { flex: 1, justifyContent: 'center', paddingVertical: 4 },
  thumb: { width: THUMB, height: THUMB, overflow: 'hidden', alignSelf: 'center' },
  thumbImage: { width: '100%', height: '100%' },
});
