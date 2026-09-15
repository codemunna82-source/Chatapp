import { Platform, Linking } from 'react-native';
import notifee, { AndroidImportance } from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';
import { currentRingtone } from '../store/ringtoneStore';

/**
 * Whether this phone can actually ring.
 *
 * Everything a call notification needs is a setting the USER owns, and
 * every one of them fails silently: a blocked channel, a battery
 * optimisation, an OEM's autostart switch. The call is pushed, Android
 * drops it, and nothing anywhere says so — which is precisely how push
 * stayed broken here for weeks.
 *
 * So the app checks what it can check and says what it found, with a
 * button that opens the exact screen. Not a support article: a button.
 */

export type IssueId = 'notifications' | 'channel' | 'battery' | 'powerManager' | 'fullScreen';

export interface ReadinessIssue {
  id: IssueId;
  title: string;
  detail: string;
  /** Where to fix it. */
  open: () => Promise<void>;
  /**
   * `blocking` means DETECTED and known to stop calls arriving — worth
   * interrupting someone for. `advisory` means Android gives no way to
   * read the setting, so it is listed for a person to confirm and never
   * pops up on its own. Nagging about something that may already be
   * correct is how people learn to dismiss the thing without reading it.
   */
  severity: 'blocking' | 'advisory';
}

/** Silences the automatic prompt for a day after it is dismissed. Opening
 *  it from Settings always works — this only governs the interruption. */
const SNOOZE_KEY = 'voxo.callReadinessSnoozedUntil';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export async function checkCallReadiness(): Promise<ReadinessIssue[]> {
  if (Platform.OS !== 'android') return [];
  const issues: ReadinessIssue[] = [];

  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (permission && !permission.granted) {
    issues.push({
      id: 'notifications',
      title: 'Notifications are off',
      detail: 'VOXO cannot alert you to anything — calls or messages — until this is on.',
      open: () => notifee.openNotificationSettings(),
      severity: 'blocking',
    });
  }

  // The channel carrying THIS phone's chosen ringtone, not a fixed id:
  // each ringtone owns a channel, and only the selected one exists.
  const channelId = currentRingtone().channelId;
  const channel = await notifee.getChannel(channelId).catch(() => null);
  if (channel?.blocked) {
    issues.push({
      id: 'channel',
      title: 'Call alerts are blocked',
      detail: 'The "Incoming calls" category is switched off, so calls arrive silently or not at all.',
      open: () => notifee.openNotificationSettings(channelId),
      severity: 'blocking',
    });
  } else if (channel && (channel.importance ?? 0) < AndroidImportance.HIGH) {
    issues.push({
      id: 'channel',
      title: 'Call alerts are set to silent',
      detail: 'Incoming calls will not ring or appear over what you are doing.',
      open: () => notifee.openNotificationSettings(channelId),
      severity: 'blocking',
    });
  }

  const optimised = await notifee.isBatteryOptimizationEnabled().catch(() => false);
  if (optimised) {
    issues.push({
      id: 'battery',
      title: 'Battery optimisation is on',
      detail:
        'Android may stop VOXO in the background, and a call that arrives then is never delivered. Choose "Unrestricted" or "Don\'t optimise".',
      open: () => notifee.openBatteryOptimizationSettings(),
      severity: 'blocking',
    });
  }

  // Xiaomi, Huawei, Oppo and the rest each keep their own kill-list, and
  // none of them let an app read its own state — only open the screen. So
  // this is offered, never insisted on.
  const power = await notifee.getPowerManagerInfo().catch(() => null);
  if (power?.activity) {
    issues.push({
      id: 'powerManager',
      title: `Autostart (${power.manufacturer ?? 'your phone'})`,
      detail:
        'Phones from this manufacturer close background apps unless autostart is allowed. Turn it on for VOXO so calls arrive while the app is closed.',
      open: () => notifee.openPowerManagerSettings(),
      severity: 'advisory',
    });
  }

  // Android exposes no way to read this one, so it can only be listed.
  issues.push({
    id: 'fullScreen',
    title: 'Full screen notifications',
    detail:
      'Lets a call take over the lock screen instead of arriving as a banner. Find it under Notifications for VOXO.',
    open: () => notifee.openNotificationSettings(),
    severity: 'advisory',
  });

  return issues;
}

interface ReadinessState {
  issues: ReadinessIssue[];
  open: boolean;
  /** Re-checks, and raises the sheet only for problems actually found. */
  refresh: (opts?: { prompt?: boolean }) => Promise<void>;
  show: () => void;
  dismiss: () => void;
}

export const useCallReadinessStore = create<ReadinessState>((set, get) => ({
  issues: [],
  open: false,
  refresh: async ({ prompt = false } = {}) => {
    const issues = await checkCallReadiness();
    set({ issues });
    if (!prompt) return;
    const blocking = issues.some((i) => i.severity === 'blocking');
    const snoozedUntil = getJSON<number>(SNOOZE_KEY) ?? 0;
    if (blocking && Date.now() > snoozedUntil && !get().open) set({ open: true });
  },
  show: () => set({ open: true }),
  dismiss: () => {
    setJSON(SNOOZE_KEY, Date.now() + SNOOZE_MS);
    set({ open: false });
  },
}));

/** For the one case notifee cannot open: the app's own settings page. */
export function openAppSettings(): void {
  void Linking.openSettings();
}
