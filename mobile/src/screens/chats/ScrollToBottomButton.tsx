import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';

interface ScrollToBottomButtonProps {
  visible: boolean;
  /** Messages that arrived after the user scrolled away from the bottom. */
  newCount: number;
  onPress: () => void;
}

/**
 * Two problems in one control: getting back to the bottom of a long chat
 * without a long flick, and knowing that something arrived while you were
 * reading history. Without the count the button is just a scroll shortcut;
 * with it, it is the only signal that the conversation moved on.
 */
export function ScrollToBottomButton({ visible, newCount, onPress }: ScrollToBottomButtonProps) {
  const { colors, radius, typography, shadow } = useTheme();
  if (!visible) return null;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.button,
        shadow.md,
        { backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderRadius: radius.lg },
      ]}
      accessibilityRole="button"
      accessibilityLabel={newCount > 0 ? `${newCount} new messages, scroll to latest` : 'Scroll to latest messages'}
    >
      <Ionicons name="chevron-down" size={20} color={colors.textPrimary} />
      {newCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.primary, borderRadius: radius.lg }]}>
          <Text style={[typography.caption, { color: colors.textOnPrimary, fontWeight: '700' }]}>
            {newCount > 99 ? '99+' : newCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 14,
    // Sits above the composer, which is the bottom-most element of the
    // chat screen's own layout.
    bottom: 14,
    minWidth: touchTarget.compact,
    minHeight: touchTarget.compact,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
