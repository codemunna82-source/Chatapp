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
}

interface VoxoSmsAutoReplyNative {
  setConfig(enabled: boolean, replyText: string): void;
  getStatus(): Promise<SmsAutoReplyStatus>;
}

const native: VoxoSmsAutoReplyNative | undefined =
  Platform.OS === 'android' ? NativeModules.VoxoSmsAutoReply : undefined;

/** Writes the on/off switch and the resolved reply text (template + personal link) for SmsAutoReplyReceiver to read. */
export function setSmsAutoReplyConfig(enabled: boolean, replyText: string): void {
  native?.setConfig(enabled, replyText);
}

/** The switch's actual state and how many distinct numbers it has replied to, read back from the native side. */
export async function getSmsAutoReplyStatus(): Promise<SmsAutoReplyStatus> {
  if (!native) return { enabled: false, repliedCount: 0 };
  try {
    return await native.getStatus();
  } catch {
    return { enabled: false, repliedCount: 0 };
  }
}
