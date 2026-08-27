import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

interface ScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Padding applied to the content area — most screens want this; a chat screen with its own layout doesn't. */
  padded?: boolean;
}

/** Base screen wrapper: safe-area + theme background. Every screen should sit inside one of these. */
export function Screen({ children, style, padded = true }: ScreenProps) {
  const { colors, spacing } = useTheme();
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.flex, padded && { padding: spacing.md }, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
