import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

const DEFAULT_EDGES: Edge[] = ['top', 'bottom'];

interface ScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Padding applied to the content area — most screens want this; a chat screen with its own layout doesn't. */
  padded?: boolean;
  /**
   * Which safe-area edges this screen insets. Defaults to top + bottom.
   * A screen with its own keyboard-tracking bottom bar (the conversation
   * screen) passes ['top'] and applies the bottom inset itself, so the
   * navigation-bar padding can collapse while the keyboard is open instead
   * of stacking on top of it as a dead gap.
   */
  edges?: Edge[];
}

/** Base screen wrapper: safe-area + theme background. Every screen should sit inside one of these. */
export function Screen({ children, style, padded = true, edges = DEFAULT_EDGES }: ScreenProps) {
  const { colors, spacing } = useTheme();
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={edges}>
      <View style={[styles.flex, padded && { padding: spacing.md }, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
