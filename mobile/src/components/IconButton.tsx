import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';

interface IconButtonProps {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  /** Visual icon size. Independent of the touch area — see `touchSize`. */
  size?: number;
  color?: string;
  disabled?: boolean;
  /**
   * Edge length of the (invisible) touch container. Defaults to
   * touchTarget.min. Never set this below touchTarget.compact.
   */
  touchSize?: number;
  /** Fill color for a visible circle behind the icon (e.g. the send button). */
  background?: string;
  /** Diameter of that visible circle — deliberately smaller than `touchSize`. */
  backgroundSize?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * An icon control whose *touch area* is a real, guaranteed square (48dp by
 * default) while the icon drawn inside stays as small as the design wants.
 *
 * This exists because sizing a Pressable to the icon and then adding
 * `hitSlop` does not work reliably on Android: touches are dispatched down
 * the view tree, so a child's hitSlop can only ever expand within its
 * parent's bounds. In the packed rows this app uses (composer, list-row
 * actions, headers) the parent is barely bigger than the icon, so the
 * hitSlop gets clipped and the control ends up with a ~28-34dp effective
 * target that frequently misses the tap.
 *
 * Press feedback is a lightweight opacity change on the icon itself, so a
 * button never looks dead when touched.
 */
export function IconButton({
  name,
  onPress,
  onLongPress,
  accessibilityLabel,
  size = 22,
  color,
  disabled = false,
  touchSize,
  background,
  backgroundSize,
  style,
  testID,
}: IconButtonProps) {
  const { colors, touchTarget } = useTheme();
  const box = touchSize ?? touchTarget.min;
  const circle = backgroundSize ?? box;
  const iconColor = color ?? colors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      style={[styles.touch, { width: box, height: box }, style]}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.center,
            background
              ? { width: circle, height: circle, borderRadius: circle / 2, backgroundColor: background }
              : null,
            { opacity: disabled ? 0.4 : pressed ? 0.55 : 1 },
          ]}
        >
          <Ionicons name={name} size={size} color={iconColor} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: { alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
