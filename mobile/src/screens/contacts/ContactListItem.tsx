import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { useTheme } from '../../theme/ThemeProvider';
import type { Contact } from '../../api/types';

function ContactListItemImpl({ contact, onPress }: { contact: Contact; onPress: (contact: Contact) => void }) {
  const handlePress = useCallback(() => onPress(contact), [onPress, contact]);
  const { colors, spacing, typography } = useTheme();
  const label = contact.name || contact.phone;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        { padding: spacing.md, backgroundColor: pressed ? colors.surface : colors.background },
      ]}
    >
      <Avatar label={label} contactId={contact.id} version={contact.avatarUpdatedAt} />
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

/**
 * Memoized: list rows re-render whenever the screen above them does (search
 * text, a refetch, a sheet opening). The callbacks take their item rather
 * than closing over it so the parent can pass one stable function per list.
 */
export const ContactListItem = React.memo(ContactListItemImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  tagRow: { flexDirection: 'row', marginTop: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
});
