import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';

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

interface DoodleCell {
  key: string;
  icon: (typeof DOODLE_ICONS)[number];
  x: number;
  y: number;
  rotate: number;
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

/**
 * The chat screen's "wallpaper" — a subtle, brand-tinted doodle pattern
 * behind the message list, in the spirit of WhatsApp's own chat wallpaper
 * without reusing any of WhatsApp's actual artwork or branding (spec §45).
 * Pure decoration: pointerEvents="none", theme-aware (re-tints with
 * colors.primary on light/dark switch), and only regenerates its icon grid
 * when the measured viewport size actually changes.
 */
export function ChatWallpaper() {
  const { colors } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const cells = useMemo(
    () => (size.width && size.height ? buildCells(size.width, size.height) : []),
    [size.width, size.height],
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]} onLayout={onLayout} pointerEvents="none">
      {cells.map((cell) => (
        <Ionicons
          key={cell.key}
          name={cell.icon}
          size={ICON_SIZE}
          color={colors.primary}
          style={[styles.icon, { left: cell.x, top: cell.y, opacity: 0.05, transform: [{ rotate: `${cell.rotate}deg` }] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { position: 'absolute' },
});
