import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

const PALETTE = ['#4C3FE0', '#0E9384', '#C9861A', '#D64545', '#2463EB', '#9333EA'];

function colorForSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

interface AvatarProps {
  label: string; // name or phone — used both for the initial and the color seed
  size?: number;
}

/** Initials-based placeholder — no photo storage/upload for contacts exists yet. */
export function Avatar({ label, size = 48 }: AvatarProps) {
  const { colors } = useTheme();
  const initial = (label.trim()[0] ?? '#').toUpperCase();
  const background = colorForSeed(label);

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.42, color: colors.textOnPrimary }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '600' },
});
