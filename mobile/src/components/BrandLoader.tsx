import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

const SIZES = { sm: 28, md: 44, lg: 64 } as const;
export type BrandLoaderSize = keyof typeof SIZES;

/**
 * VOXO's own loading mark: a rounded square carrying the wordmark's V,
 * breathing on a slow scale-and-fade loop with an orbiting ring.
 *
 * It replaces the platform ActivityIndicator in the places where the app is
 * clearly VOXO doing something — a full-screen wait, a screen's first load.
 * The stock spinner stays where it belongs: inside buttons, list footers
 * and rows, where a branded mark would be noise rather than identity.
 *
 * The animation is two Reanimated values driven on the UI thread, so it
 * keeps moving smoothly even while the JS thread is busy with exactly the
 * work the user is waiting for — which is the whole point of a loader.
 */
export function BrandLoader({
  size = 'md',
  label,
}: {
  size?: BrandLoaderSize;
  /** Optional line under the mark, for waits long enough to need a word. */
  label?: string;
}) {
  const { colors, radius, typography, spacing } = useTheme();
  const box = SIZES[size];

  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    // Asymmetric timing: a slightly slower exhale than inhale reads as
    // breathing rather than as a mechanical bounce.
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 780, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    spin.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false);
  }, [pulse, spin]);

  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.88 + pulse.value * 0.12 }],
    opacity: 0.75 + pulse.value * 0.25,
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'}>
      <View style={{ width: box * 1.5, height: box * 1.5, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.ring,
            {
              borderColor: colors.primaryMuted,
              // One coloured edge on an otherwise muted ring is what makes
              // the rotation readable at all — a uniform ring spinning
              // looks static.
              borderTopColor: colors.primary,
              borderRadius: (box * 1.5) / 2,
            },
            ringStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              width: box,
              height: box,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            },
            markStyle,
          ]}
        >
          <Text
            style={{
              color: colors.textOnPrimary,
              fontSize: box * 0.5,
              fontWeight: '800',
              // The glyph is optically high in its own box; nudging it down
              // centres it against the square rather than against the line.
              marginTop: -box * 0.04,
            }}
          >
            V
          </Text>
        </Animated.View>
      </View>

      {label ? (
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>{label}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2 },
});
