import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Minutes rendered the way someone would say them out loud — "4 min",
 * "1h 20m", "2d 3h" — rather than a raw minute count that stops being
 * readable somewhere around a thousand.
 */
function formatMinutes(minutes: number): string {
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = Math.round(minutes % 60);
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/**
 * Median, not mean, first-response time — one chat left overnight would
 * drag an average far enough to make the number useless.
 *
 * `null` means there was nothing to measure and is shown as such: a zero
 * here would read as "instant", which is the opposite of the truth.
 */
export function ResponseTimeCard({ medianMinutes }: { medianMinutes: number | null }) {
  const { colors, spacing, radius, typography } = useTheme();

  // Against WhatsApp's 24-hour service window: replying inside an hour
  // keeps the free-form window comfortably open, a day means it is closing.
  const tone =
    medianMinutes === null
      ? colors.textSecondary
      : medianMinutes <= 60
        ? colors.success
        : medianMinutes <= 60 * 6
          ? colors.warning
          : colors.danger;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryMuted, marginRight: spacing.md }]}>
        <Ionicons name="timer-outline" size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>Median first reply</Text>
        <Text style={[typography.heading, { color: tone, marginTop: 2 }]}>
          {medianMinutes === null ? 'No replies yet' : formatMinutes(medianMinutes)}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
          {medianMinutes === null
            ? 'Measured once you answer an incoming message.'
            : 'From a customer’s message to your first answer.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center' },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
