import { apiClient } from '../client';

export type DevicePlatform = 'android' | 'ios';

export async function registerDevice(token: string, platform: DevicePlatform): Promise<void> {
  await apiClient.post('/devices', { token, platform });
}

/**
 * Called on sign-out. Without it the phone keeps receiving the workspace's
 * notifications after the user has logged out — a real problem on a shared
 * device, and the kind nobody notices until it happens.
 */
export async function unregisterDevice(token: string): Promise<void> {
  await apiClient.delete('/devices', { data: { token } });
}
