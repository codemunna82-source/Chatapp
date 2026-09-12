import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Avatar } from '../../components/Avatar';
import { useAuthStore } from '../../store/authStore';
import { useThemePreferenceStore, type ThemePreference } from '../../store/themePreferenceStore';
import {
  useChatWallpaperStore,
  WALLPAPER_STYLES,
  WALLPAPER_LABELS,
  type WallpaperStyle,
} from '../../store/chatWallpaperStore';
import { useAlertPreferenceStore } from '../../store/alertPreferenceStore';
import { useLogout, useUploadOwnAvatar } from '../../queries/useAuthMutations';
import { getApiErrorMessage } from '../../api/client';
import { useSubscription } from '../../queries/useSubscription';
import { useNotifications, flattenNotifications } from '../../queries/useNotifications';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';

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
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  badgeCount?: number;
  /** A row that states where something lives rather than going there. */
  disabled?: boolean;
}) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={[
        styles.row,
        { paddingVertical: spacing.sm + 4, borderBottomColor: colors.border },
        disabled ? { opacity: 0.55 } : null,
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
      <Text style={[typography.body, { color: colors.textPrimary, flex: 1, marginLeft: spacing.md }]}>{label}</Text>
      {value ? <Text style={[typography.caption, { color: colors.textSecondary, marginRight: spacing.sm }]}>{value}</Text> : null}
      {badgeCount ? <Badge count={badgeCount} /> : null}
      {/* No chevron on a row that goes nowhere — the arrow is the promise
          of a next screen, and there isn't one. */}
      {disabled ? null : (
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} style={{ marginLeft: spacing.xs }} />
      )}
    </Pressable>
  );
}

/**
 * The account's avatar. Tap to replace it — square crop, uploaded to
 * PATCH /api/users/me/avatar.
 *
 * The control was removed once on request and is back because without it
 * there was no way to set a photo at all, so every profile showed initials
 * forever and looked like a broken avatar rather than an empty one.
 *
 * Square crop because the frame is a circle: letting someone pick a
 * landscape photo and then centre-cropping it for them is how a face ends
 * up half out of the ring.
 */
function ProfileAvatar({ userId, label, version }: { userId: string; label: string; version?: string }) {
  const { spacing, colors, typography } = useTheme();
  const upload = useUploadOwnAvatar();

  const pick = async () => {
    if (upload.isPending) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;

    upload.mutate(
      {
        uri: asset.uri,
        // The picker can hand back a uri with no filename at all (a camera
        // roll asset id), and the server needs one to infer nothing — the
        // mime type does that job — but multipart still requires a name.
        name: asset.fileName ?? 'avatar.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
      },
      {
        onError: (err) => Alert.alert('Could not update your photo', getApiErrorMessage(err)),
      },
    );
  };

  return (
    <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
      <Pressable
        onPress={() => void pick()}
        accessibilityRole="button"
        accessibilityLabel="Change your profile photo"
        style={({ pressed }) => ({ opacity: pressed || upload.isPending ? 0.6 : 1 })}
      >
        <Avatar userId={userId} version={version} label={label} size={72} />
      </Pressable>
      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {upload.isPending ? 'Uploading…' : 'Tap to change photo'}
      </Text>
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

/** See pickWallpaper for why there are exactly two, and why they alternate. */
const WALLPAPER_SLOT_A = 'voxo-wallpaper-a.jpg';
const WALLPAPER_SLOT_B = 'voxo-wallpaper-b.jpg';

const WALLPAPER_ICONS: Record<WallpaperStyle, keyof typeof Ionicons.glyphMap> = {
  doodles: 'color-wand-outline',
  plain: 'square-outline',
  dots: 'ellipsis-horizontal-outline',
  grid: 'grid-outline',
  custom: 'image-outline',
};

function ChatWallpaperSection() {
  const { colors, spacing, radius, typography } = useTheme();
  const style = useChatWallpaperStore((s) => s.style);
  const setStyle = useChatWallpaperStore((s) => s.setStyle);
  const setCustomWallpaper = useChatWallpaperStore((s) => s.setCustomWallpaper);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const [pickingWallpaper, setPickingWallpaper] = useState(false);

  const pickWallpaper = async () => {
    if (pickingWallpaper) return;
    setPickingWallpaper(true);
    setWallpaperError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setWallpaperError('Photo access is needed to choose a wallpaper.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (result.canceled || !result.assets[0]) return;

      // Copied into the app's own document directory rather than pointing
      // at the picker's temporary URI: that one is a short-lived cache
      // entry Android reclaims, so the wallpaper would vanish days later
      // for no reason the user could connect to anything they did.
      //
      // Two fixed slots, alternating, instead of a timestamped name. The
      // name has to CHANGE between picks — React Native's Image caches by
      // URI, so reusing one filename would keep showing the old photo —
      // but it also has to be predictable, so old files cannot accumulate.
      const previous = useChatWallpaperStore.getState().customUri;
      const nextSlot = previous?.endsWith(WALLPAPER_SLOT_A) ? WALLPAPER_SLOT_B : WALLPAPER_SLOT_A;
      const destination = new File(Paths.document, nextSlot);
      if (destination.exists) destination.delete();
      await new File(result.assets[0].uri).copy(destination);
      setCustomWallpaper(destination.uri);

      // Only after the new one is in place, so a failed copy never leaves
      // the user with neither.
      if (previous) {
        try {
          const old = new File(previous);
          if (old.exists) old.delete();
        } catch {
          // An already-missing previous file is not worth reporting.
        }
      }
    } catch {
      setWallpaperError('Could not use that image.');
    } finally {
      setPickingWallpaper(false);
    }
  };

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Chat wallpaper</Text>
      <View style={styles.appearanceRow}>
        {WALLPAPER_STYLES.map((option) => {
          const active = style === option;
          return (
            <Pressable
              key={option}
              onPress={() => (option === 'custom' ? void pickWallpaper() : setStyle(option))}
              style={[
                styles.appearanceOption,
                {
                  backgroundColor: active ? colors.primary : colors.surfaceAlt,
                  borderRadius: radius.md,
                  marginRight: spacing.sm,
                  paddingVertical: spacing.sm,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              testID={`settings-wallpaper-${option}`}
            >
              <Ionicons
                name={WALLPAPER_ICONS[option]}
                size={18}
                color={active ? colors.textOnPrimary : colors.textSecondary}
              />
              <Text
                style={[typography.caption, { color: active ? colors.textOnPrimary : colors.textSecondary, marginTop: 2 }]}
              >
                {WALLPAPER_LABELS[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {wallpaperError ? (
        <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}>{wallpaperError}</Text>
      ) : null}
      {style === 'custom' ? (
        <Text style={[typography.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          Your photo is dimmed behind the chat so message text stays readable. Tap Photo again to change it.
        </Text>
      ) : null}
    </View>
  );
}

function AlertsSection() {
  const { colors, spacing, radius, typography } = useTheme();
  const sound = useAlertPreferenceStore((s) => s.sound);
  const vibrate = useAlertPreferenceStore((s) => s.vibrate);
  const setSound = useAlertPreferenceStore((s) => s.setSound);
  const setVibrate = useAlertPreferenceStore((s) => s.setVibrate);

  const rows: { label: string; value: boolean; onChange: (v: boolean) => void }[] = [
    { label: 'Sound', value: sound, onChange: setSound },
    { label: 'Vibration', value: vibrate, onChange: setVibrate },
  ];

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        New message alerts
      </Text>
      <View style={[{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.md }]}>
        {rows.map((row, i) => (
          <View
            key={row.label}
            style={[
              styles.alertRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
            ]}
          >
            <Text style={[typography.body, { color: colors.textPrimary }]}>{row.label}</Text>
            <Switch
              value={row.value}
              onValueChange={row.onChange}
              trackColor={{ true: colors.primary, false: colors.divider }}
              accessibilityLabel={`${row.label} for new messages`}
            />
          </View>
        ))}
      </View>
      {/* Said plainly, because the difference is not obvious and guessing
          wrong means missing customers. */}
      <Text style={[typography.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>
        Plays while VOXO is open. Alerts when the app is closed need push notifications, which aren&apos;t set up yet.
      </Text>
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
    // Scrollable, because this screen is taller than a phone and everything
    // below the fold was simply unreachable — User management, Connect
    // WhatsApp, Workspace numbers and Sign out all sit at the bottom, so
    // the whole admin surface and the way out of the app were invisible on
    // any device shorter than the content. `Screen` is a plain flex View;
    // it does not scroll on its own.
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
      {/* No "Settings" heading here: the stack navigator already sets one
          as the screen's header title (SettingsStackNavigator), so having
          both printed the word twice, one above the other. */}
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
      <ChatWallpaperSection />
      <AlertsSection />

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
          // A signpost rather than a screen. User management moved to the
          // web dashboard, and an admin who used to find it here will come
          // looking — a row that simply vanished would read as the feature
          // being gone rather than moved. It navigates nowhere on purpose:
          // this app does not know the workspace's dashboard URL, and a
          // link that guessed at one would be worse than a sentence.
          <SettingsRow
            icon="people-outline"
            label="User management"
            value="On the web dashboard"
            disabled
          />
        ) : null}
        {/* Hidden from a member whose number was chosen for them.
            Running Embedded Signup reassigns the user to whatever number
            they connect, so leaving this visible would let an employee
            replace the admin's assignment with their own personal number
            — silently, and with no way for the admin to notice.
            Admins always see it (they are the ones who connect), and so
            does a member with no number, for whom self-connecting is the
            only way to get working at all. */}
        {isMasterAdmin || !user?.whatsappPhoneNumberId ? (
          <SettingsRow
            icon="logo-whatsapp"
            label="Connect WhatsApp"
            onPress={() => navigation.navigate('ConnectWhatsApp')}
          />
        ) : null}
        {isMasterAdmin ? (
          <SettingsRow
            icon="call-outline"
            label="Workspace numbers"
            onPress={() => navigation.navigate('WhatsAppNumbers')}
          />
        ) : null}
        {/* The name a customer reads at the top of the private chat
            window. Admin-only, because it is the workspace's public face:
            one member changing it changes what every customer sees. */}
        {isMasterAdmin ? (
          <SettingsRow
            icon="storefront-outline"
            label="Business profile"
            onPress={() => navigation.navigate('BusinessProfile')}
          />
        ) : null}
      </View>

      <Button label="Sign out" variant="danger" onPress={() => logout.mutate()} loading={logout.isPending} testID="settings-logout" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  subscriptionCard: {},
  subscriptionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  alertRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, minHeight: 48 },
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
