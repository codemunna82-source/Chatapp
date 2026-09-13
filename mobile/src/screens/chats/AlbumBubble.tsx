import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { MediaImage } from './MediaImage';
import { MessageStatusIcon } from './MessageStatusIcon';
import { formatMessageTime } from '../../utils/formatTime';
import type { Message } from '../../api/types';

/**
 * Past this the album stops adding cells and the last one carries a +N.
 *
 * Three, not four. The layout below is one photo across the top and two
 * beneath it — what the messenger does — and a fourth cell would mean a
 * second full row, which is the vertical strip an album exists to avoid.
 */
const MAX_TILES = 3;

/** Frame padding, and the hairline between cells. Both are load-bearing arithmetic. */
const PAD = 3;
const GAP = 2;

/**
 * How tall the top photo is, as a fraction of the album's width.
 *
 * Wider than it is tall, so the two beneath it are not squeezed into
 * slivers and the album as a whole still occupies about one message.
 */
const LEAD_RATIO = 0.62;

/**
 * Several photos sent together, as one grid instead of a column.
 *
 * Sending five pictures produced five full-width bubbles, so the thread
 * became a vertical strip of photographs and whatever was said before
 * them scrolled out of reach. Every messenger groups them, for that
 * reason: the point of an album is that it occupies the space of roughly
 * one message.
 *
 * The shape is the messenger's own: two photos sit side by side, and
 * three or more become one across the top with two beneath it. The last
 * cell carries "+N" when there are more behind it and opens the same
 * viewer as the rest, which is where the others are — an album that grew
 * a cell per photo would be the original problem again in a different
 * shape.
 */
export function AlbumBubble({
  messages,
  onOpenImage,
  onLongPress,
}: {
  /** Oldest first: the order they were sent, which is the order they are read. */
  messages: Message[];
  /** Given the whole album, so the viewer can reach every photo — including the ones behind the +N. */
  onOpenImage?: (localUri: string, mediaId: string | undefined, album?: Message[]) => void;
  onLongPress: (message: Message) => void;
}) {
  const { colors, radius, typography } = useTheme();
  const { width } = useWindowDimensions();

  const mine = messages[0]?.direction === 'OUT';
  const pair = messages.length === 2;
  const tiles = messages.slice(0, pair ? 2 : MAX_TILES);
  const hidden = messages.length - tiles.length;

  // Sized from the live window for the same reason a single photo is: a
  // hardcoded width overflows a 320dp phone and leaves dead space on a
  // 430dp one.
  const side = Math.round(Math.min(Math.max(width * 0.58, 160), 280));
  /**
   * The width available INSIDE the frame.
   *
   * The frame's own padding has to come out before the columns are
   * divided, and it did not: two half-cells plus the gap added up to the
   * frame's full width, which is wider than its content box — so the row
   * could not fit them and flex-wrap put every photo on a line of its
   * own. That is why an album rendered as a vertical column of pictures
   * rather than as a grid.
   */
  const inner = side - PAD * 2;
  const half = Math.floor((inner - GAP) / 2);
  const leadHeight = Math.round(inner * LEAD_RATIO);

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
        {/* Two photos: one row, two columns. Three or more: the first
            across the top, the next two beneath it. */}
        {pair ? (
          <View style={styles.row2}>
            {tiles.map((m) => (
              <Tile
                key={m.id}
                message={m}
                width={half}
                height={half}
                album={messages}
                onOpenImage={onOpenImage}
                onLongPress={onLongPress}
              />
            ))}
          </View>
        ) : (
          <>
            <Tile
              message={tiles[0]!}
              width={inner}
              height={leadHeight}
              album={messages}
              onOpenImage={onOpenImage}
              onLongPress={onLongPress}
            />
            <View style={[styles.row2, { marginTop: GAP }]}>
              {tiles.slice(1).map((m, i) => (
                <Tile
                  key={m.id}
                  message={m}
                  width={half}
                  height={half}
                  album={messages}
                  // The bottom-right cell carries the count. Tapping it
                  // opens the viewer like any other — the rest are in
                  // there.
                  more={i === tiles.length - 2 && hidden > 0 ? hidden : 0}
                  onOpenImage={onOpenImage}
                  onLongPress={onLongPress}
                />
              ))}
            </View>
          </>
        )}

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

/**
 * One cell.
 *
 * Its own component because every cell needs the same three things — the
 * photo, a long-press that reaches the bubble's action sheet, and
 * optionally the +N cover — and the two layouts above would otherwise
 * spell all of that out twice.
 */
function Tile({
  message,
  width,
  height,
  more = 0,
  album,
  onOpenImage,
  onLongPress,
}: {
  message: Message;
  width: number;
  height: number;
  more?: number;
  /** Every photo in this album, forwarded to the viewer on open. */
  album: Message[];
  onOpenImage?: (localUri: string, mediaId: string | undefined, album?: Message[]) => void;
  onLongPress: (message: Message) => void;
}) {
  const { typography } = useTheme();
  return (
    <Pressable onLongPress={() => onLongPress(message)} style={[styles.cell, { width, height }]}>
      <MediaImage
        mediaId={message.mediaId}
        localUri={message.localUri}
        uploadProgress={message.uploadProgress}
        onOpen={(localUri, mediaId) => onOpenImage?.(localUri, mediaId, album)}
        onLongPress={() => onLongPress(message)}
        width={width}
        height={height}
      />
      {more > 0 ? (
        <View style={styles.more} pointerEvents="none">
          <Text style={[typography.title, styles.moreText]}>+{more}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 10, marginVertical: 2 },
  mine: { justifyContent: 'flex-end' },
  theirs: { justifyContent: 'flex-start' },
  frame: { overflow: 'hidden', padding: PAD },
  row2: { flexDirection: 'row', gap: GAP },
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
