import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useAuthStore } from '../store/authStore';
import { useWhatsAppNumbers } from '../queries/useWhatsAppNumbers';

/**
 * Warns when Meta has lowered a number's quality rating.
 *
 * Meta drops the sending limit before it restricts a number, so the yellow
 * rating is the last point at which anything can be done — and until now
 * it was only visible to someone who went looking for it in settings,
 * which nobody does before the number is already restricted.
 *
 * Only shown when something is actually wrong. A banner that is always
 * present is one people stop reading, and this one has to be noticed the
 * one time it appears.
 *
 * Admin-only, because the endpoint behind it is: mounting the query for a
 * team member would fire a request that always 403s.
 */
export function NumberHealthBanner(): React.ReactElement | null {
  const { colors, spacing, typography, radius } = useTheme();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'MASTER_ADMIN';
  const { data } = useWhatsAppNumbers(isAdmin);

  if (!isAdmin) return null;

  const unhealthy = (data ?? []).filter(
    (n) => n.health?.level === 'warn' || n.health?.level === 'critical',
  );
  if (unhealthy.length === 0) return null;

  // The worst one sets the tone; listing every number would bury it.
  const worst =
    unhealthy.find((n) => n.health?.level === 'critical') ?? unhealthy[0];
  const health = worst!.health!;
  const critical = health.level === 'critical';
  const tint = critical ? colors.danger : colors.warning;
  const background = critical ? colors.dangerMuted : colors.warningMuted;

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: background, borderRadius: radius.md, padding: spacing.sm + 2, margin: spacing.md },
      ]}
      accessibilityRole="alert"
    >
      <Ionicons name={critical ? 'warning' : 'alert-circle-outline'} size={18} color={tint} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[typography.caption, { color: tint, fontWeight: '700' }]}>
          {worst!.displayPhoneNumber} — {health.headline}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
          {health.detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start' },
});
