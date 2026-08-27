import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { useTheme } from '../../theme/ThemeProvider';
import type { Contact } from '../../api/types';

export function ContactListItem({ contact, onPress }: { contact: Contact; onPress: () => void }) {
  const { colors, spacing, typography } = useTheme();
  const label = contact.name || contact.phone;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { padding: spacing.md, backgroundColor: pressed ? colors.surface : colors.background },
      ]}
    >
      <Avatar label={label} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
          {contact.name ? contact.phone : contact.tags.join(', ') || 'No tags'}
        </Text>
        {contact.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {contact.tags.slice(0, 3).map((tag) => (
              <View key={tag} style={[styles.tag, { backgroundColor: colors.primaryMuted, marginRight: spacing.xs }]}>
                <Text style={[typography.caption, { color: colors.primary }]}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  tagRow: { flexDirection: 'row', marginTop: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
});
