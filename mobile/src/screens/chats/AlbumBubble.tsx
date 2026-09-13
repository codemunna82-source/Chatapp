import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { MediaImage } from './MediaImage';
import { MessageStatusIcon } from './MessageStatusIcon';
import { formatMessageTime } from '../../utils/formatTime';
import type { Message } from '../../api/types';

/** Past this the grid stops adding cells and the last one carries a +N. */
const MAX_TILES = 4;

/**
 * Several photos sent together, as one grid instead of a column.
 *
 * Sending five pictures produced five full-width bubbles, so the thread
 * became a vertical strip of photographs and whatever was said before
 * them scrolled out of reach. Every messenger groups them, for that
 * reason: the point of an album is that it occupies the space of roughly
 * one message.
 *
 * Only the first four are drawn. The fourth carries "+N" over it and
 * opens the same viewer as the rest, which is where the others are — a
 * grid that grew to sixteen tiles would be the original problem again in
 * a different shape.
 */
export function AlbumBubble({
  messages,
  onOpenImage,
  onLongPress,
}: {
  /** Oldest first: the order they were sent, which is the order they are read. */
  messages: Message[];
  onOpenImage?: (localUri: string) => void;
  onLongPress: (message: Message) => void;
}) {
  const { colors, radius, typography } = useTheme();
  const { width } = useWindowDimensions();

  const mine = messages[0]?.direction === 'OUT';
  const tiles = messages.slice(0, MAX_TILES);
  const hidden = messages.length - tiles.length;

  // Sized from the live window for the same reason a single photo is: a
  // hardcoded width overflows a 320dp phone and leaves dead space on a
  // 430dp one. Two columns plus the hairline between them.
  const side = Math.round(Math.min(Math.max(width * 0.58, 160), 280));
  const cell = Math.floor((side - 2) / 2);

  // The album's own stamp is the LAST photo's: that is when the batch
  // finished arriving, and it is the status the whole group is waiting on.
  const last = messages[messages.length - 1];
  // buildRenderItems only emits an album for two or more, so this cannot
  // happen — but the compiler does not know that, and an album of nothing
  // has nothing to draw either way.
  if (!last) return null;

  return (
    <View style={[styles.row, mine ? styles.mine : styles.theirs]}>
      <View
        style={[
          styles.frame,
          {
            width: side,
            borderRadius: radius.md,
            backgroundColor: mine ? colors.primary : colors.surfaceElevated,
          },
        ]}
      >
        <View style={styles.grid}>
          {tiles.map((m, i) => (
            <Pressable
              key={m.id}
              onLongPress={() => onLongPress(m)}
              style={[styles.cell, { width: cell, height: cell }]}
            >
              <MediaImage
                mediaId={m.mediaId}
                localUri={m.localUri}
                uploadProgress={m.uploadProgress}
                onOpen={onOpenImage}
                onLongPress={() => onLongPress(m)}
                size={cell}
              />
              {/* On the last drawn tile only, and only when there are more
                  behind it. Tapping it opens the viewer like any other —
                  the rest are in there. */}
              {i === MAX_TILES - 1 && hidden > 0 ? (
                <View style={styles.more} pointerEvents="none">
                  <Text style={[typography.title, styles.moreText]}>+{hidden}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={[typography.caption, { color: mine ? colors.textOnPrimary : colors.textSecondary }]}>
            {formatMessageTime(last.createdAt)}
          </Text>
          {mine ? (
            <View style={styles.tick}>
              <MessageStatusIcon status={last.status} size={13} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 10, marginVertical: 2 },
  mine: { justifyContent: 'flex-end' },
  theirs: { justifyContent: 'flex-start' },
  frame: { overflow: 'hidden', padding: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  cell: { overflow: 'hidden', borderRadius: 3 },
  more: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  moreText: { color: '#FFFFFF' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingTop: 3, paddingRight: 3 },
  tick: { marginLeft: 4 },
});
