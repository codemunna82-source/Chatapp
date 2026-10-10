import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import {
  useChatWallpaperStore,
  CUSTOM_WALLPAPER_DIM,
  type WallpaperStyle,
} from '../../store/chatWallpaperStore';

const DOODLE_ICONS: (keyof typeof Ionicons.glyphMap)[] = [
  'chatbubble-outline',
  'heart-outline',
  'musical-notes-outline',
  'camera-outline',
  'star-outline',
  'airplane-outline',
  'gift-outline',
  'leaf-outline',
  'happy-outline',
  'call-outline',
  'image-outline',
  'videocam-outline',
];

const CELL = 95;
const ICON_SIZE = 35;
const DEFAULT_ICON: (typeof DOODLE_ICONS)[number] = 'chatbubble-outline';

/** Dots sit on a tighter lattice than doodles — at 46dp they read as sparse
 *  specks rather than a texture. */
const DOT_CELL = 26;
const DOT_SIZE = 3;

interface DoodleCell {
  key: string;
  icon: (typeof DOODLE_ICONS)[number];
  x: number;
  y: number;
  rotate: number;
}

interface PlainCell {
  key: string;
  x: number;
  y: number;
}

/**
 * A fast, deterministic hash of a cell's own coordinates — not a PRNG with
 * state, so the same cell always lands on the same icon/rotation/jitter
 * across re-renders, but mixed enough (two multiply-xorshift rounds) that
 * neighbouring cells don't trend together the way a linear formula like
 * `(row + col) % 4` does. A linear formula repeats on a short, visible
 * cycle — which is exactly what reads as "rows of doodles" instead of a
 * scattered pattern; this doesn't repeat until the hash itself does.
 */
function hashCell(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

function buildCells(width: number, height: number): DoodleCell[] {
  const cols = Math.ceil(width / CELL) + 1;
  const rows = Math.ceil(height / CELL) + 1;
  const cells: DoodleCell[] = [];
  for (let row = 0; row < rows; row++) {
    // Stagger alternate rows like a brick pattern, so the lattice itself
    // reads as organic rather than a rigid grid.
    const offset = row % 2 === 0 ? 0 : CELL / 2;
    for (let col = 0; col < cols; col++) {
      const icon = DOODLE_ICONS[hashCell(row, col) % DOODLE_ICONS.length] ?? DEFAULT_ICON;
      // Full circle, not a narrow band — WhatsApp's own wallpaper has
      // doodles sitting at every angle, some flipped past upside-down,
      // never lined up with their neighbours.
      const rotate = (hashCell(col + 1, row + 1) % 360) - 180;
      // A small jitter off the brick lattice, independent of rotation and
      // icon so none of the three ever move together — otherwise the grid
      // itself still reads as rows even with every icon spinning.
      const jitterX = (hashCell(row * 2 + 1, col) % Math.round(CELL / 3)) - CELL / 6;
      const jitterY = (hashCell(col * 2 + 1, row) % Math.round(CELL / 3)) - CELL / 6;
      cells.push({
        key: `${row}-${col}`,
        icon,
        x: col * CELL + offset + jitterX,
        y: row * CELL + jitterY,
        rotate,
      });
    }
  }
  return cells;
}

function buildDots(width: number, height: number): PlainCell[] {
  const cols = Math.ceil(width / DOT_CELL) + 1;
  const rows = Math.ceil(height / DOT_CELL) + 1;
  const cells: PlainCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ key: `${row}-${col}`, x: col * DOT_CELL, y: row * DOT_CELL });
    }
  }
  return cells;
}

/**
 * The chat screen's "wallpaper" — a subtle, brand-tinted doodle pattern
 * behind the message list, in the spirit of WhatsApp's own chat wallpaper
 * without reusing any of WhatsApp's actual artwork or branding (spec §45).
 * Pure decoration: pointerEvents="none", theme-aware (re-tints with
 * colors.primary on light/dark switch), and only regenerates its icon grid
 * when the measured viewport size actually changes.
 */
function PatternLayer({ style, width, height, tint }: { style: WallpaperStyle; width: number; height: number; tint: string }) {
  const doodles = useMemo(
    () => (style === 'doodles' && width && height ? buildCells(width, height) : []),
    [style, width, height],
  );
  const dots = useMemo(
    () => (style === 'dots' && width && height ? buildDots(width, height) : []),
    [style, width, height],
  );

  if (style === 'plain') return null;

  if (style === 'grid') {
    // Drawn as hairlines rather than per-cell views: a grid over a full
    // screen would be hundreds of boxes, where rows and columns are two
    // handfuls of 1px views.
    const cols = Math.ceil(width / CELL) + 1;
    const rows = Math.ceil(height / CELL) + 1;
    return (
      <>
        {Array.from({ length: cols }, (_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: i * CELL, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: tint }]} />
        ))}
        {Array.from({ length: rows }, (_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: i * CELL, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: tint }]} />
        ))}
      </>
    );
  }

  if (style === 'dots') {
    return (
      <>
        {dots.map((cell) => (
          <View
            key={cell.key}
            style={[styles.dot, { left: cell.x, top: cell.y, backgroundColor: tint }]}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {doodles.map((cell) => (
        <Ionicons
          key={cell.key}
          name={cell.icon}
          size={ICON_SIZE}
          color={tint}
          style={[styles.icon, { left: cell.x, top: cell.y, opacity: 0.05, transform: [{ rotate: `${cell.rotate}deg` }] }]}
        />
      ))}
    </>
  );
}

function ChatWallpaperImpl() {
  const { colors } = useTheme();
  const style = useChatWallpaperStore((s) => s.style);
  const customUri = useChatWallpaperStore((s) => s.customUri);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // A picked file can disappear underneath us (storage cleared, a restore
  // onto another device). Falling back to the plain themed background beats
  // a blank screen where the chat used to be.
  const [customFailed, setCustomFailed] = useState(false);
  const showCustom = style === 'custom' && Boolean(customUri) && !customFailed;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]}
      onLayout={onLayout}
      pointerEvents="none"
      // This subtree is ~200 glyph views that never move or change. Promoting
      // it to a single GPU texture means the message list scrolls over one
      // composited layer instead of re-compositing every icon each frame.
      renderToHardwareTextureAndroid
      // Without this, RN may flatten the wrapper away and the texture hint
      // would have no view left to apply to.
      collapsable={false}
    >
      {showCustom ? (
        <>
          <Image
            source={{ uri: customUri as string }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setCustomFailed(true)}
          />
          {/* A photo cannot be legible by construction — a bright or busy
              one behind dark text is unreadable. The scrim takes the
              contrast decision away from whatever was picked, using the
              theme's own surface colour so it dims correctly in light AND
              dark rather than always darkening. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.surface, opacity: CUSTOM_WALLPAPER_DIM },
            ]}
          />
        </>
      ) : (
        <PatternLayer
          // Reached only when 'custom' is selected but unusable (no file, or
          // it failed to load) — plain is the honest fallback.
          style={style === 'custom' ? 'plain' : style}
          width={size.width}
          height={size.height}
          // The text colour, not the accent. WhatsApp's doodles are a
          // muted version of the ground they sit on — darker than it in
          // light, lighter in dark — which textPrimary gives in both
          // schemes for free. Tinted with the brand green they read as
          // decoration competing with the bubbles rather than as paper
          // behind them.
          tint={colors.textPrimary}
        />
      )}
    </View>
  );
}

/**
 * Memoized: this is a full-screen decorative layer with no props, mounted
 * behind the message list. Before this, every re-render of the conversation
 * screen (typing indicator, reply target, toast, keystroke) walked all ~200
 * icon elements again for a layer that never actually changes.
 */
export const ChatWallpaper = React.memo(ChatWallpaperImpl);

const styles = StyleSheet.create({
  icon: { position: 'absolute' },
  dot: { position: 'absolute', width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, opacity: 0.14 },
  gridLine: { position: 'absolute', opacity: 0.08 },
});
