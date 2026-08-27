import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import type { Message } from '../../api/types';

export function ReplyPreviewBar({ target, onCancel }: { target: Message; onCancel: () => void }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderTopColor: colors.border, padding: spacing.sm },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: colors.primary }]} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[typography.label, { color: colors.primary }]}>Replying to</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
          {target.text || `[${target.type}]`}
        </Text>
      </View>
      <Pressable onPress={onCancel} hitSlop={8}>
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
});
