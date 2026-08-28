import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Avatar } from '../../components/Avatar';
import { useAuthStore } from '../../store/authStore';
import { useThemePreferenceStore, type ThemePreference } from '../../store/themePreferenceStore';
import { useLogout, useUploadOwnAvatar } from '../../queries/useAuthMutations';
import { useSubscription } from '../../queries/useSubscription';
import { useNotifications, flattenNotifications } from '../../queries/useNotifications';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { getApiErrorMessage } from '../../api/client';
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

/** Tap to replace the photo — square crop, uploaded to PATCH /api/users/me/avatar. */
function ProfileAvatar({ userId, label, version }: { userId: string; label: string; version?: string }) {
  const { colors, spacing } = useTheme();
  const uploadAvatar = useUploadOwnAvatar();
  const [error, setError] = useState<string | null>(null);

  const pickAndUpload = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission was denied.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    try {
      await uploadAvatar.mutateAsync({
        uri: asset.uri,
        name: asset.fileName ?? 'avatar.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not update your profile picture.'));
    }
  };

  return (
    <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
      <Pressable onPress={pickAndUpload} disabled={uploadAvatar.isPending} testID="settings-avatar">
        <Avatar userId={userId} version={version} label={label} size={72} />
        <View style={[styles.editBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
          {uploadAvatar.isPending ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Ionicons name="camera" size={14} color={colors.textOnPrimary} />
          )}
        </View>
      </Pressable>
      {error ? (
        <Text style={[{ color: colors.danger, marginTop: spacing.xs, fontSize: 12 }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
];

function AppearanceSection() {
  const { colors, spacing, radius, typography } = useTheme();
  const preference = useThemePreferenceStore((s) => s.preference);
  const setPreference = useThemePreferenceStore((s) => s.setPreference);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Appearance</Text>
      <View style={styles.appearanceRow}>
        {APPEARANCE_OPTIONS.map((option) => {
          const active = preference === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setPreference(option.value)}
              style={[
                styles.appearanceOption,
                {
                  backgroundColor: active ? colors.primary : colors.surfaceAlt,
                  borderRadius: radius.md,
                  marginRight: spacing.sm,
                  paddingVertical: spacing.sm,
                },
              ]}
              testID={`settings-theme-${option.value}`}
            >
              <Ionicons name={option.icon} size={18} color={active ? colors.textOnPrimary : colors.textSecondary} />
              <Text
                style={[typography.caption, { color: active ? colors.textOnPrimary : colors.textSecondary, marginTop: 2 }]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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

      <View style={{ marginBottom: spacing.lg, alignItems: 'center' }}>
        {user ? (
          <ProfileAvatar userId={user.id} label={user.displayName ?? user.email} version={user.avatarUpdatedAt} />
        ) : null}
        <Text style={[typography.label, { color: colors.textSecondary }]}>Account</Text>
        <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.xs }]}>
          {user?.displayName ?? user?.email}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{user?.email}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {user?.role === 'MASTER_ADMIN' ? 'Master Admin' : 'Team member'}
        </Text>
      </View>

      <AppearanceSection />

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
        {/* Contacts are chat-surface, gated on CHAT_READ/CHAT_SEND rather
            than MASTER_ADMIN, so this row is visible to every member. */}
        <SettingsRow
          icon="people-circle-outline"
          label="Contacts"
          onPress={() => navigation.navigate('ManageContacts')}
        />
        {isMasterAdmin ? (
          <SettingsRow icon="wallet-outline" label="Wallet" onPress={() => navigation.navigate('Wallet')} />
        ) : null}
        {isMasterAdmin ? (
          <SettingsRow icon="people-outline" label="Team" onPress={() => navigation.navigate('Team')} />
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
  appearanceRow: { flexDirection: 'row' },
  appearanceOption: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: touchTarget.compact },
  editBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
