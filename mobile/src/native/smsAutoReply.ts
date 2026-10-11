import { NativeModules, Platform } from 'react-native';

/**
 * Bridges to VoxoSmsAutoReplyModule.kt — a small native module living in
 * the app itself (android/app, not node_modules), since the thing it
 * configures, SmsAutoReplyReceiver, is woken by the OS for an incoming
 * SMS and cannot read a React Query cache or take a prop. iOS has no
 * such native module at all: Apple gives no app a way to read another
 * app's SMS or reply on the user's behalf, so every export here is a
 * no-op there.
 */
export interface SmsAutoReplyStatus {
  enabled: boolean;
  repliedCount: number;
  /** How many auto-replies may go out today before the receiver stops scheduling new ones. */
  dailyLimit: number;
  /** Resets to 0 at midnight, device-local time — see VoxoSmsAutoReplyModule's readDailyCount. */
  sentToday: number;
}

const DEFAULT_STATUS: SmsAutoReplyStatus = { enabled: false, repliedCount: 0, dailyLimit: 100, sentToday: 0 };

interface VoxoSmsAutoReplyNative {
  setConfig(enabled: boolean, replyText: string): void;
  setDailyLimit(limit: number): void;
  getStatus(): Promise<SmsAutoReplyStatus>;
}

const native: VoxoSmsAutoReplyNative | undefined =
  Platform.OS === 'android' ? NativeModules.VoxoSmsAutoReply : undefined;

/** Writes the on/off switch and the resolved reply text (template + personal link) for SmsAutoReplyReceiver to read. */
export function setSmsAutoReplyConfig(enabled: boolean, replyText: string): void {
  native?.setConfig(enabled, replyText);
}

/** Changes how many auto-replies may go out today before the receiver stops scheduling new ones — see DEFAULT_DAILY_LIMIT in VoxoSmsAutoReplyModule.kt for why this exists at all. */
export function setSmsAutoReplyDailyLimit(limit: number): void {
  native?.setDailyLimit(limit);
}

/** The switch's actual state, today's send count and limit, and how many distinct numbers it has replied to overall — all read back from the native side. */
export async function getSmsAutoReplyStatus(): Promise<SmsAutoReplyStatus> {
  if (!native) return DEFAULT_STATUS;
  try {
    return await native.getStatus();
  } catch {
    return DEFAULT_STATUS;
  }
}
