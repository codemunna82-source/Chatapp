import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppBottomSheet, type AppBottomSheetRef } from '../../components/AppBottomSheet';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';

interface MediaSourceSheetProps {
  visible: boolean;
  onClose: () => void;
  onPickCamera: () => void;
  onPickGallery: () => void;
}

/**
 * The camera button's two real sources: capture a new photo, or pick
 * existing ones (multi-select) from the gallery. Deliberately only these
 * two — anything else here would need a capability the app doesn't have.
 */
export function MediaSourceSheet({ visible, onClose, onPickCamera, onPickGallery }: MediaSourceSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const sheetRef = useRef<AppBottomSheetRef>(null);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const options = [
    {
      key: 'camera' as const,
      icon: 'camera' as keyof typeof Ionicons.glyphMap,
      label: 'Camera',
      hint: 'Take a new photo',
      tint: colors.danger,
      muted: colors.dangerMuted,
      onPress: onPickCamera,
    },
    {
      key: 'gallery' as const,
      icon: 'images' as keyof typeof Ionicons.glyphMap,
      label: 'Gallery',
      hint: 'Pick one or more photos',
      tint: colors.primary,
      muted: colors.primaryMuted,
      onPress: onPickGallery,
    },
  ];

  return (
    <AppBottomSheet ref={sheetRef} snapPoints={SNAP_POINTS} onDismiss={onClose}>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, paddingTop: spacing.xs }}>
        <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.md }]}>Add photos</Text>
        {options.map((option) => (
          <Pressable
            key={option.key}
            onPress={option.onPress}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`${option.label} — ${option.hint}`}
          >
            {({ pressed }) => (
              <View style={[styles.rowInner, { opacity: pressed ? 0.6 : 1 }]}>
                <View style={[styles.iconCircle, { backgroundColor: option.muted, borderRadius: radius.full }]}>
                  <Ionicons name={option.icon} size={22} color={option.tint} />
                </View>
                <View style={{ marginLeft: spacing.md }}>
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{option.label}</Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>{option.hint}</Text>
                </View>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </AppBottomSheet>
  );
}

// Title + two option rows.
const SNAP_POINTS = ['32%'];

const styles = StyleSheet.create({
  row: { minHeight: touchTarget.min + 8, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
