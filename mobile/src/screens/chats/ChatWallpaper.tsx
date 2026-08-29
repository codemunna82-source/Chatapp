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

const CELL = 46;
const ICON_SIZE = 17;
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

function buildCells(width: number, height: number): DoodleCell[] {
  const cols = Math.ceil(width / CELL) + 1;
  const rows = Math.ceil(height / CELL) + 1;
  const cells: DoodleCell[] = [];
  for (let row = 0; row < rows; row++) {
    // Stagger alternate rows like a brick pattern, so it reads as an
    // organic tiled pattern rather than a rigid grid.
    const offset = row % 2 === 0 ? 0 : CELL / 2;
    for (let col = 0; col < cols; col++) {
      const icon = DOODLE_ICONS[(row * 7 + col * 3) % DOODLE_ICONS.length] ?? DEFAULT_ICON;
      const rotate = ((row + col) % 4) * 17 - 25;
      cells.push({ key: `${row}-${col}`, icon, x: col * CELL + offset, y: row * CELL, rotate });
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
          tint={colors.primary}
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
