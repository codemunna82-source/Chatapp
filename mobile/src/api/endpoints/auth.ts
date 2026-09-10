import { apiClient } from '../client';
import type { ApiSuccess, AuthTokens, AuthUser } from '../types';

/**
 * Signs in with a phone number — or an email, which the server also
 * accepts for accounts created before phone sign-in existed.
 *
 * The field is `identifier` rather than `phone` for that reason: naming it
 * after one of the two things it takes would be a lie the next person
 * reading this has to discover.
 */
export async function login(identifier: string, password: string): Promise<AuthTokens> {
  const res = await apiClient.post<ApiSuccess<AuthTokens>>('/auth/login', { identifier, password });
  return res.data.data;
}

/**
 * The signed-in user as the server currently sees them.
 *
 * The login response used to be the app's only source of `role` and
 * `permissions`, cached on the device from then on — so a member promoted
 * to MASTER_ADMIN kept the old UI until they happened to sign out and back
 * in, with nothing to indicate anything was stale.
 */
export async function getCurrentUser(): Promise<AuthUser> {
  const res = await apiClient.get<ApiSuccess<AuthUser>>('/auth/me');
  return res.data.data;
}

export async function logout(refreshToken: string): Promise<void> {
  await apiClient.post('/auth/logout', { refreshToken });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/change-password', { currentPassword, newPassword });
}
