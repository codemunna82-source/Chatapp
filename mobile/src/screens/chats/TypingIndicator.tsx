import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';

function Dot({ delay }: { delay: number }) {
  const { colors } = useTheme();
  const scale = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 300 }), withTiming(0.6, { duration: 300 })), -1, false),
    );
  }, [scale, delay]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={[styles.dot, { backgroundColor: colors.textSecondary }, style]} />;
}

/** Shown below the message list while the contact is typing (spec §19/§22). */
export function TypingIndicator() {
  const { spacing } = useTheme();
  return (
    <View style={[styles.row, { paddingHorizontal: spacing.md, paddingVertical: spacing.xs }]}>
      <Dot delay={0} />
      <Dot delay={150} />
      <Dot delay={300} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
