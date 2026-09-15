import { apiClient } from '../client';

export type DevicePlatform = 'android' | 'ios';

export async function registerDevice(
  token: string,
  platform: DevicePlatform,
  /**
   * Which Android channel this phone wants ringing calls on.
   *
   * The server sends calls on it rather than on its own default, which is
   * how a ringtone picked here is heard while the app is CLOSED — an
   * Android channel's sound is fixed at creation, so choosing a ringtone
   * is choosing a channel.
   */
  callChannelId?: string,
): Promise<void> {
  await apiClient.post('/devices', { token, platform, callChannelId });
}

/**
 * Called on sign-out. Without it the phone keeps receiving the workspace's
 * notifications after the user has logged out — a real problem on a shared
 * device, and the kind nobody notices until it happens.
 */
export async function unregisterDevice(token: string): Promise<void> {
  await apiClient.delete('/devices', { data: { token } });
}
