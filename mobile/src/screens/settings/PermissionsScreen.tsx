import React, { useCallback, useState } from 'react';
import { Linking, PermissionsAndroid, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { useFocusEffect } from '@react-navigation/native';
import { Screen } from '../../components/Screen';
import { useTheme } from '../../theme/ThemeProvider';
import { triggerLocalSmsSync } from '../../utils/LocalSmsRunner';

type IoniconName = keyof typeof Ionicons.glyphMap;

interface PermissionItem {
  key: string;
  label: string;
  description: string;
  icon: IoniconName;
  /** Android-only items (the three SMS ones) have no iOS counterpart at all — see SmsInboxScreen. */
  androidOnly?: boolean;
  check: () => Promise<boolean>;
  request: () => Promise<boolean>;
}

const smsRationale = (message: string) => ({
  title: 'SMS permission',
  message,
  buttonPositive: 'Allow',
});

const PERMISSION_ITEMS: PermissionItem[] = [
  {
    key: 'read_sms',
    label: 'Read SMS inbox',
    description: 'Shows the SMS already on this phone in Chats. They stay on this phone.',
    icon: 'chatbox-outline',
    androidOnly: true,
    check: () => PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
    request: async () =>
      (await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        smsRationale('VOXO shows your SMS in Chats. They are kept on this phone and never uploaded.'),
      )) === PermissionsAndroid.RESULTS.GRANTED,
  },
  {
    key: 'send_sms',
    label: 'Send SMS',
    description: '"Send invitation via SMS" and the composer\'s SMS box send straight off your SIM with this.',
    icon: 'paper-plane-outline',
    androidOnly: true,
    check: () => PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS),
    request: async () =>
      (await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
        smsRationale("VOXO sends a text straight from this phone's SIM, so you don't have to open the SMS app yourself."),
      )) === PermissionsAndroid.RESULTS.GRANTED,
  },
  {
    key: 'receive_sms',
    label: 'Receive SMS',
    description: 'New SMS appear in Chats as they arrive, and "Auto-reply to lead SMS" can notice them.',
    icon: 'mail-unread-outline',
    androidOnly: true,
    check: () => PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
    request: async () =>
      (await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        smsRationale('VOXO needs this to show a new SMS in Chats as it arrives.'),
      )) === PermissionsAndroid.RESULTS.GRANTED,
  },
  {
    key: 'camera',
    label: 'Camera',
    description: 'For taking a photo to send, or setting a contact\'s picture.',
    icon: 'camera-outline',
    check: async () => (await ImagePicker.getCameraPermissionsAsync()).granted,
    request: async () => (await ImagePicker.requestCameraPermissionsAsync()).granted,
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'For saving a customer into your phone\'s own address book.',
    icon: 'people-outline',
    check: async () => (await Contacts.getPermissionsAsync()).granted,
    request: async () => (await Contacts.requestPermissionsAsync()).granted,
  },
  {
    key: 'microphone',
    label: 'Microphone',
    description: 'For voice messages and calls.',
    icon: 'mic-outline',
    check: async () => (await getRecordingPermissionsAsync()).granted,
    request: async () => (await requestRecordingPermissionsAsync()).granted,
  },
  {
    key: 'location',
    label: 'Location',
    description: 'For sharing a pin of where you are in a chat.',
    icon: 'location-outline',
    check: async () => (await Location.getForegroundPermissionsAsync()).granted,
    request: async () => (await Location.requestForegroundPermissionsAsync()).granted,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'For new message and call alerts.',
    icon: 'notifications-outline',
    check: async () => (await Notifications.getPermissionsAsync()).granted,
    request: async () => (await Notifications.requestPermissionsAsync()).granted,
  },
];

const VISIBLE_ITEMS = PERMISSION_ITEMS.filter((item) => !item.androidOnly || Platform.OS === 'android');

/**
 * Every permission VOXO ever asks for, in one place — what each one is
 * actually for, whether it's granted right now, and a button to fix it,
 * instead of the agent hunting through the phone's own Settings app (or,
 * worse, several different in-app prompts scattered across screens) and
 * guessing which toggle matches which feature.
 *
 * This is also the one place that can explain Android's "Restricted
 * settings" block for sideloaded apps (Android 13+): a permission that
 * shows "App was denied access" instead of the normal allow/deny prompt
 * is not this app refusing to ask — it's the OS refusing to let an app
 * installed outside the Play Store ask at all, until the agent
 * explicitly unlocks it from the app's own System Settings page first.
 * No in-app request call can do that step; only a person can.
 */
export function PermissionsScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const [statuses, setStatuses] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    const entries = await Promise.all(
      VISIBLE_ITEMS.map(async (item) => [item.key, await item.check().catch(() => false)] as const),
    );
    setStatuses(Object.fromEntries(entries));
    setChecking(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const grant = useCallback(
    async (item: PermissionItem) => {
      setPendingKey(item.key);
      try {
        const granted = await item.request().catch(() => false);
        if (granted && (item.key === 'read_sms' || item.key === 'receive_sms')) triggerLocalSmsSync();
      } finally {
        setPendingKey(null);
        await refresh();
      }
    },
    [refresh],
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 17 }]}>
          Everything VOXO can ask your phone for, and what each one is actually used for. Nothing here is required —
          a feature that needs one simply can&apos;t do its job until it&apos;s granted.
        </Text>

        {VISIBLE_ITEMS.map((item) => {
          const granted = statuses[item.key] ?? false;
          return (
            <View
              key={item.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surfaceAlt,
                borderRadius: radius.md,
                padding: spacing.md,
                marginBottom: spacing.sm,
                gap: 12,
              }}
            >
              <Ionicons name={item.icon} size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{item.label}</Text>
                <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2, lineHeight: 16 }]}>
                  {item.description}
                </Text>
              </View>
              {checking ? null : granted ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              ) : (
                <Pressable
                  onPress={() => void grant(item)}
                  disabled={pendingKey === item.key}
                  style={({ pressed }) => [
                    {
                      backgroundColor: colors.primary,
                      borderRadius: radius.full,
                      paddingVertical: 6,
                      paddingHorizontal: 14,
                      opacity: pendingKey === item.key || pressed ? 0.6 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Grant ${item.label}`}
                >
                  <Text style={[typography.caption, { color: colors.textOnPrimary, fontWeight: '600' }]}>
                    {pendingKey === item.key ? 'Asking…' : 'Grant'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <View
          style={{
            marginTop: spacing.sm,
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.md,
            padding: spacing.md,
          }}
        >
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>
            Tapping &ldquo;Grant&rdquo; above does nothing?
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4, lineHeight: 17 }]}>
            {Platform.OS === 'android'
              ? 'If your phone shows "App was denied access" instead of a normal Allow/Deny prompt, that\'s Android itself blocking apps installed outside the Play Store from asking for this permission at all — not VOXO refusing. Open VOXO\'s own App info below, tap the ⋮ menu in the corner, choose "Allow restricted settings," then come back and tap Grant again.'
              : "Open VOXO's settings page below and grant it there instead."}
          </Text>
          <Pressable
            onPress={() => void Linking.openSettings()}
            style={({ pressed }) => [
              {
                marginTop: 10,
                alignSelf: 'flex-start',
                backgroundColor: colors.surfaceElevated,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: colors.border,
                paddingVertical: 8,
                paddingHorizontal: 14,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open VOXO's settings page"
          >
            <Text style={[typography.caption, { color: colors.textPrimary, fontWeight: '600' }]}>
              Open VOXO&apos;s app info
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}
