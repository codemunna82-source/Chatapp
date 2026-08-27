import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({ label, onPress, variant = 'primary', loading = false, disabled = false, testID }: ButtonProps) {
  const { colors, spacing, radius, shadow, typography } = useTheme();
  const isDisabled = disabled || loading;
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const background =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.surfaceAlt;
  const textColor = variant === 'secondary' ? colors.textPrimary : colors.textOnPrimary;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      onPressIn={() => {
        // Mutating .value is Reanimated's documented, intentional API for
        // driving a UI-thread animation from an event handler — not a real
        // React state mutation. eslint-plugin-react-hooks' immutability
        // check doesn't yet recognize this pattern outside useEffect.
        // eslint-disable-next-line react-hooks/immutability
        scale.value = withTiming(0.97, { duration: 90 });
      }}
      onPressOut={() => {
        // eslint-disable-next-line react-hooks/immutability
        scale.value = withTiming(1, { duration: 120 });
      }}
      style={[
        styles.base,
        animatedStyle,
        variant === 'primary' ? shadow.sm : shadow.none,
        {
          backgroundColor: background,
          borderRadius: radius.md,
          paddingVertical: spacing.sm + 6,
          paddingHorizontal: spacing.lg,
          opacity: isDisabled ? 0.5 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[typography.bodyMedium, { color: textColor }]}>{label}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
});
