import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { useAuthStore } from '../../store/authStore';
import { useLogout } from '../../queries/useAuthMutations';
import { useSubscription } from '../../queries/useSubscription';
import { useNotifications, flattenNotifications } from '../../queries/useNotifications';
import { useTheme } from '../../theme/ThemeProvider';
import type { SettingsStackParamList } from '../../navigation/types';
import type { SubscriptionStatus } from '../../api/types';

type Props = NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>;

const STATUS_COLOR_KEY: Record<SubscriptionStatus, 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'danger',
  SUSPENDED: 'danger',
};

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  badgeCount,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress: () => void;
  badgeCount?: number;
}) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { paddingVertical: spacing.sm + 4, borderBottomColor: colors.border }]}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
      <Text style={[typography.body, { color: colors.textPrimary, flex: 1, marginLeft: spacing.md }]}>{label}</Text>
      {value ? <Text style={[typography.caption, { color: colors.textSecondary, marginRight: spacing.sm }]}>{value}</Text> : null}
      {badgeCount ? <Badge count={badgeCount} /> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} style={{ marginLeft: spacing.xs }} />
    </Pressable>
  );
}

export function SettingsScreen({ navigation }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const isMasterAdmin = user?.role === 'MASTER_ADMIN';

  const subscription = useSubscription(isMasterAdmin);
  const unreadNotifications = useNotifications(true);
  const unreadCount = flattenNotifications(unreadNotifications.data).length;

  return (
    <Screen>
      <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.lg }]}>Settings</Text>

      <View style={{ marginBottom: spacing.lg }}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>Account</Text>
        <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.xs }]}>
          {user?.displayName ?? user?.email}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{user?.email}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {user?.role === 'MASTER_ADMIN' ? 'Master Admin' : 'Team member'}
        </Text>
      </View>

      {isMasterAdmin && subscription.data
        ? (() => {
            const statusColor = colors[STATUS_COLOR_KEY[subscription.data.status]];
            return (
              <View
                style={[
                  styles.subscriptionCard,
                  { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
                ]}
              >
                <View style={styles.subscriptionHeader}>
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{subscription.data.plan} plan</Text>
                  <View style={[styles.statusPill, { backgroundColor: `${statusColor}22` }]}>
                    <Text style={[typography.caption, { color: statusColor }]}>{subscription.data.status}</Text>
                  </View>
                </View>
                <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                  Valid until {new Date(subscription.data.validUntil).toLocaleDateString()}
                </Text>
              </View>
            );
          })()
        : null}

      <View style={{ marginBottom: spacing.xl }}>
        <SettingsRow
          icon="notifications-outline"
          label="Notifications"
          badgeCount={unreadCount}
          onPress={() => navigation.navigate('Notifications')}
        />
        {isMasterAdmin ? (
          <SettingsRow icon="wallet-outline" label="Wallet" onPress={() => navigation.navigate('Wallet')} />
        ) : null}
      </View>

      <Button label="Sign out" variant="danger" onPress={() => logout.mutate()} loading={logout.isPending} testID="settings-logout" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  subscriptionCard: {},
  subscriptionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
});
