import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { useTheme } from '../../theme/ThemeProvider';
import type { DashboardSummary } from '../../api/types';

type TopContact = DashboardSummary['topContacts'][number];

function TopContactRow({ contact, max, rank }: { contact: TopContact; max: number; rank: number }) {
  const { colors, spacing, typography, radius } = useTheme();
  const label = contact.name || contact.phone;
  // Guarded against a zero max: every contact here has at least one
  // message, but a divide-by-zero would render NaN% width rather than fail.
  const fraction = max > 0 ? contact.messages / max : 0;

  return (
    <View style={[styles.row, { marginTop: rank === 0 ? 0 : spacing.md }]}>
      <Avatar label={label} contactId={contact.contactId} size={36} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <View style={styles.rowHeader}>
          <Text style={[typography.bodyMedium, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
            {contact.messages}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, marginTop: 6 }]}>
          <View
            style={[
              styles.fill,
              { backgroundColor: colors.primary, borderRadius: radius.sm, width: `${Math.max(fraction * 100, 4)}%` },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

/** The five busiest conversations, as a share of the busiest one — the ranking is the point, so the bars are relative rather than absolute. */
export function TopContactsCard({ contacts }: { contacts: DashboardSummary['topContacts'] }) {
  const { colors, spacing, radius, typography } = useTheme();
  if (contacts.length === 0) return null;

  const max = contacts.reduce((highest, c) => Math.max(highest, c.messages), 0);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        Most active contacts
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
        ]}
      >
        {contacts.map((contact, index) => (
          <TopContactRow key={contact.contactId} contact={contact} max={max} rank={index} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowHeader: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 6, overflow: 'hidden' },
  fill: { height: 6 },
});
