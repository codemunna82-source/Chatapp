import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useMyWhatsAppNumber } from '../../queries/useWhatsAppNumbers';
import type { WhatsAppNumber } from '../../api/types';

/**
 * The member's own WhatsApp number and how Meta currently rates it.
 *
 * Quality used to be visible only on the admin screen, which put it in
 * front of the one person who is not sending the messages. Meta lowers a
 * number's sending limit before it restricts the number, so a drop is the
 * last point at which anything can still be done — and the agent found out
 * only when sends began failing, with nothing on screen connecting the two.
 *
 * Shown at every level, not only when it is bad: a reading that appears
 * solely in trouble is one nobody has learned to read by the time it
 * matters.
 */

type Level = NonNullable<WhatsAppNumber['health']>['level'];

const ICON: Record<Level, keyof typeof Ionicons.glyphMap> = {
  ok: 'shield-checkmark',
  warn: 'alert-circle',
  critical: 'warning',
  unknown: 'help-circle-outline',
};

/** What the agent is told to do, which is the only part they can act on. */
const ACTION: Partial<Record<Level, string>> = {
  critical:
    'Tell your admin to move you to a different WhatsApp number. Until then, reply only to customers ' +
    'who messaged you first — nothing else.',
  warn:
    'Reply only to customers who messaged you first. If this does not recover, ask your admin for a ' +
    'different WhatsApp number.',
};

export function MyNumberQualityCard() {
  const { colors, spacing, radius, typography } = useTheme();
  const query = useMyWhatsAppNumber();
  const number = query.data;

  // Nothing to show rather than an empty card: an admin has the full list
  // on their own screen, and a member with no assignment has no number
  // whose quality could be reported.
  if (!number?.health) return null;

  const { health } = number;
  const tint =
    health.level === 'critical'
      ? colors.danger
      : health.level === 'warn'
        ? colors.warning
        : health.level === 'ok'
          ? colors.success
          : colors.textSecondary;

  // A tinted ground for the two levels that need attention, and the
  // ordinary surface otherwise — so a healthy number is a line the user
  // reads past, and a falling one stops them.
  const background =
    health.level === 'critical'
      ? colors.dangerMuted
      : health.level === 'warn'
        ? colors.warningMuted
        : colors.surface;

  const action = ACTION[health.level];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: background,
          borderRadius: radius.md,
          padding: spacing.md,
          marginBottom: spacing.lg,
          borderLeftWidth: health.level === 'critical' || health.level === 'warn' ? 3 : 0,
          borderLeftColor: tint,
        },
      ]}
    >
      <View style={styles.header}>
        <Ionicons name={ICON[health.level]} size={18} color={tint} />
        <Text style={[typography.bodyMedium, { color: tint, marginLeft: spacing.xs, flex: 1 }]}>
          {health.headline}
        </Text>
      </View>

      {/* Which number this is about. An agent may not know it by heart,
          and "your number is at risk" is unactionable without it. */}
      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        Your WhatsApp number · {number.displayPhoneNumber}
      </Text>

      {/* Meta's own explanation: what has happened and what it leads to. */}
      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {health.detail}
      </Text>

      {action ? (
        <Text style={[typography.caption, { color: tint, marginTop: spacing.sm, fontWeight: '600' }]}>
          {action}
        </Text>
      ) : null}

      {/* Said plainly rather than hidden, so a rating from this morning is
          not read as the position right now. */}
      {health.stale ? (
        <Text style={[typography.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          Last checked a while ago — reopen Settings to refresh.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  header: { flexDirection: 'row', alignItems: 'center' },
});
