import React from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { useAuthStore } from '../../store/authStore';
import { useLogout } from '../../queries/useAuthMutations';
import { useTheme } from '../../theme/ThemeProvider';

export function SettingsScreen() {
  const { colors, spacing, typography } = useTheme();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  return (
    <Screen>
      <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.lg }]}>Settings</Text>

      <View style={{ marginBottom: spacing.xl }}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>Account</Text>
        <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.xs }]}>
          {user?.displayName ?? user?.email}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{user?.email}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {user?.role === 'MASTER_ADMIN' ? 'Master Admin' : 'Team member'}
        </Text>
      </View>

      {/* Subscription status, wallet balance, notification preferences, and
          theme choice all land here in Phase 8 alongside the dashboard. */}

      <Button label="Sign out" variant="danger" onPress={() => logout.mutate()} loading={logout.isPending} testID="settings-logout" />
    </Screen>
  );
}
