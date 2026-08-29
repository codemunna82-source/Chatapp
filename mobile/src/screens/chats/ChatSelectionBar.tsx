import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';

interface ChatSelectionBarProps {
  count: number;
  /** True when the archived list is showing, so Archive becomes Unarchive. */
  showingArchived: boolean;
  busy: boolean;
  onCancel: () => void;
  onMarkRead: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

/**
 * Replaces the search bar while chats are selected.
 *
 * It takes over the same strip rather than floating over the list: search
 * and a multi-select action are mutually exclusive, and a bar that overlays
 * rows would cover the very chats being chosen.
 */
export function ChatSelectionBar({
  count,
  showingArchived,
  busy,
  onCancel,
  onMarkRead,
  onToggleArchive,
  onDelete,
}: ChatSelectionBarProps) {
  const { colors, spacing, typography } = useTheme();

  const actions = [
    {
      key: 'read',
      icon: 'checkmark-done-outline' as keyof typeof Ionicons.glyphMap,
      label: 'Mark as read',
      tint: colors.textPrimary,
      onPress: onMarkRead,
    },
    {
      key: 'archive',
      icon: (showingArchived ? 'arrow-undo-outline' : 'archive-outline') as keyof typeof Ionicons.glyphMap,
      label: showingArchived ? 'Unarchive' : 'Archive',
      tint: colors.textPrimary,
      onPress: onToggleArchive,
    },
    {
      key: 'delete',
      icon: 'trash-outline' as keyof typeof Ionicons.glyphMap,
      label: 'Delete',
      tint: colors.danger,
      onPress: onDelete,
    },
  ];

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.sm, marginHorizontal: spacing.md },
      ]}
    >
      <Pressable
        onPress={onCancel}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Cancel selection"
      >
        {({ pressed }) => (
          <Ionicons name="close" size={22} color={colors.textPrimary} style={{ opacity: pressed ? 0.5 : 1 }} />
        )}
      </Pressable>

      <Text style={[typography.bodyMedium, { color: colors.textPrimary, flex: 1, marginLeft: spacing.xs }]}>
        {count} selected
      </Text>

      {busy ? (
        <ActivityIndicator color={colors.primary} style={{ marginRight: spacing.sm }} />
      ) : (
        actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={`${action.label} ${count} selected chats`}
          >
            {({ pressed }) => (
              <Ionicons name={action.icon} size={21} color={action.tint} style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    // Matches the vertical rhythm of the SearchBar it replaces, so the list
    // below does not shift when selection starts.
    marginTop: 8,
    marginBottom: 8,
    minHeight: touchTarget.min,
  },
  iconButton: {
    width: touchTarget.compact,
    height: touchTarget.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
