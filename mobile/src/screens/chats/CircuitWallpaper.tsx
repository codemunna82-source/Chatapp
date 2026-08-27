import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

const CELL = 56;
const LINE = 1.5;
const DOT = 4;

interface Segment {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Dot {
  key: string;
  x: number;
  y: number;
}

/**
 * A stylized circuit-board trace pattern — a deterministic grid of thin
 * line segments (horizontal/vertical/L-corner), via-dots, and gaps, tinted
 * with the current theme's accent color at low opacity. This is an
 * original approximation of a circuit-board motif built from plain
 * rectangles, not a pixel copy of any specific reference artwork (no
 * curves/diagonals are possible without an SVG/image asset), sized to
 * stay well under the message bubbles' contrast.
 */
function buildCircuit(width: number, height: number): { segments: Segment[]; dots: Dot[] } {
  const cols = Math.ceil(width / CELL) + 1;
  const rows = Math.ceil(height / CELL) + 1;
  const half = CELL / 2;
  const segments: Segment[] = [];
  const dots: Dot[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ox = col * CELL;
      const oy = row * CELL;
      const key = `${row}-${col}`;
      const variant = (row * 7 + col * 5 + Math.floor(row / 3) * 3) % 8;

      switch (variant) {
        case 0:
          segments.push({ key: `${key}-h`, x: ox, y: oy + half, w: CELL, h: LINE });
          break;
        case 1:
          segments.push({ key: `${key}-v`, x: ox + half, y: oy, w: LINE, h: CELL });
          break;
        case 2:
          segments.push({ key: `${key}-h`, x: ox, y: oy + half, w: half, h: LINE });
          segments.push({ key: `${key}-v`, x: ox + half, y: oy, w: LINE, h: half });
          dots.push({ key: `${key}-d`, x: ox + half, y: oy + half });
          break;
        case 3:
          segments.push({ key: `${key}-h`, x: ox + half, y: oy + half, w: half, h: LINE });
          segments.push({ key: `${key}-v`, x: ox + half, y: oy + half, w: LINE, h: half });
          dots.push({ key: `${key}-d`, x: ox + half, y: oy + half });
          break;
        case 4:
          dots.push({ key: `${key}-d`, x: ox + half, y: oy + half });
          break;
        case 5:
          segments.push({ key: `${key}-h`, x: ox, y: oy + half, w: half, h: LINE });
          break;
        case 6:
          segments.push({ key: `${key}-v`, x: ox + half, y: oy, w: LINE, h: half });
          break;
        default:
          break; // empty cell — real circuit boards have breathing room
      }
    }
  }

  return { segments, dots };
}

export function CircuitWallpaper() {
  const { colors } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const { segments, dots } = useMemo(
    () => (size.width && size.height ? buildCircuit(size.width, size.height) : { segments: [], dots: [] }),
    [size.width, size.height],
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]} onLayout={onLayout} pointerEvents="none">
      {segments.map((s) => (
        <View
          key={s.key}
          style={[styles.piece, { left: s.x, top: s.y, width: s.w, height: s.h, backgroundColor: colors.primary, opacity: 0.14 }]}
        />
      ))}
      {dots.map((d) => (
        <View
          key={d.key}
          style={[
            styles.piece,
            {
              left: d.x - DOT / 2,
              top: d.y - DOT / 2,
              width: DOT,
              height: DOT,
              borderRadius: DOT / 2,
              backgroundColor: colors.primary,
              opacity: 0.2,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute' },
});
