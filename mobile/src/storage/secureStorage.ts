import * as SecureStore from 'expo-secure-store';

/**
 * Android-Keystore-backed secure storage for auth tokens (spec §11: "Do NOT
 * store authentication tokens in plain AsyncStorage"). expo-secure-store
 * uses EncryptedSharedPreferences on Android — never swap this for MMKV or
 * AsyncStorage for anything token-related, even though those are faster;
 * speed doesn't matter for two small strings read once per app launch.
 */
export const SECURE_KEYS = {
  accessToken: 'voxo.accessToken',
  refreshToken: 'voxo.refreshToken',
} as const;

export async function getSecureItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

export async function getStoredTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [accessToken, refreshToken] = await Promise.all([
    getSecureItem(SECURE_KEYS.accessToken),
    getSecureItem(SECURE_KEYS.refreshToken),
  ]);
  return { accessToken, refreshToken };
}

export async function setStoredTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    setSecureItem(SECURE_KEYS.accessToken, accessToken),
    setSecureItem(SECURE_KEYS.refreshToken, refreshToken),
  ]);
}

export async function clearStoredTokens(): Promise<void> {
  await Promise.all([deleteSecureItem(SECURE_KEYS.accessToken), deleteSecureItem(SECURE_KEYS.refreshToken)]);
}
