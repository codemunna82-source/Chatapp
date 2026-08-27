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
