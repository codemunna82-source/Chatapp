import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

/** A single pulsing placeholder block — spec §19/§28's skeleton loaders for the chat list. */
export function SkeletonBlock({ style }: { style?: ViewStyle }) {
  const { colors, radius } = useTheme();
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }, style, animatedStyle]}
    />
  );
}

export function ChatListItemSkeleton() {
  const { spacing } = useTheme();
  return (
    <View style={[styles.row, { padding: spacing.md }]}>
      <SkeletonBlock style={{ width: 48, height: 48, borderRadius: 24 }} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <SkeletonBlock style={{ width: '50%', height: 14, marginBottom: spacing.xs }} />
        <SkeletonBlock style={{ width: '75%', height: 12 }} />
      </View>
    </View>
  );
}

export function ChatListSkeleton() {
  return (
    <View>
      {Array.from({ length: 8 }).map((_, i) => (
        <ChatListItemSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});

/**
 * The conversation screen's first load.
 *
 * Alternating sides with varied widths, because a column of identical
 * centred blocks reads as a broken layout rather than as a chat about to
 * appear — the shape has to promise what actually arrives.
 */
export function MessageListSkeleton() {
  const { spacing, radius } = useTheme();
  // Fixed, not random: a skeleton that reshuffles on every re-render
  // flickers, and this component re-renders whenever its screen does.
  const rows: { out: boolean; width: number; height: number }[] = [
    { out: false, width: 62, height: 38 },
    { out: true, width: 48, height: 38 },
    { out: false, width: 74, height: 56 },
    { out: true, width: 55, height: 38 },
    { out: false, width: 40, height: 38 },
    { out: true, width: 68, height: 56 },
    { out: false, width: 52, height: 38 },
  ];

  return (
    <View style={{ padding: spacing.md }}>
      {rows.map((row, i) => (
        <View
          key={i}
          style={{ alignItems: row.out ? 'flex-end' : 'flex-start', marginBottom: spacing.sm }}
        >
          <SkeletonBlock
            style={{ width: `${row.width}%`, height: row.height, borderRadius: radius.lg }}
          />
        </View>
      ))}
    </View>
  );
}

/** Call history rows: avatar, name, and a short meta line. */
export function CallListSkeleton() {
  const { spacing } = useTheme();
  return (
    <View>
      {Array.from({ length: 7 }).map((_, i) => (
        <View key={i} style={[styles.row, { padding: spacing.md }]}>
          <SkeletonBlock style={{ width: 44, height: 44, borderRadius: 22 }} />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <SkeletonBlock style={{ width: '45%', height: 14, marginBottom: spacing.xs }} />
            <SkeletonBlock style={{ width: '30%', height: 11 }} />
          </View>
          <SkeletonBlock style={{ width: 24, height: 24, borderRadius: 12 }} />
        </View>
      ))}
    </View>
  );
}

/**
 * The dashboard: a row of stat tiles over a chart block.
 *
 * Mirrors the real layout closely enough that nothing jumps when the data
 * lands — a skeleton whose shape differs from the content it replaces
 * causes exactly the reflow it was meant to prevent.
 */
export function DashboardSkeleton() {
  const { spacing, radius } = useTheme();
  return (
    <View>
      <View style={[styles.row, { marginBottom: spacing.md }]}>
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonBlock
            key={i}
            style={{ flex: 1, height: 82, borderRadius: radius.md, marginRight: i === 0 ? spacing.sm : 0 }}
          />
        ))}
      </View>
      <View style={[styles.row, { marginBottom: spacing.lg }]}>
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonBlock
            key={i}
            style={{ flex: 1, height: 82, borderRadius: radius.md, marginRight: i === 0 ? spacing.sm : 0 }}
          />
        ))}
      </View>
      <SkeletonBlock style={{ width: '40%', height: 14, marginBottom: spacing.sm }} />
      <SkeletonBlock style={{ width: '100%', height: 180, borderRadius: radius.md }} />
    </View>
  );
}

/** Settings rows, for the account/subscription block's first paint. */
export function SettingsSkeleton() {
  const { spacing, radius } = useTheme();
  return (
    <View>
      <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <SkeletonBlock style={{ width: 72, height: 72, borderRadius: 36, marginBottom: spacing.sm }} />
        <SkeletonBlock style={{ width: 140, height: 14, marginBottom: spacing.xs }} />
        <SkeletonBlock style={{ width: 180, height: 11 }} />
      </View>
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonBlock
          key={i}
          style={{ width: '100%', height: 52, borderRadius: radius.md, marginBottom: spacing.sm }}
        />
      ))}
    </View>
  );
}
