import { apiClient } from '../client';
import type { ApiSuccess, AuthTokens } from '../types';

export async function login(email: string, password: string): Promise<AuthTokens> {
  const res = await apiClient.post<ApiSuccess<AuthTokens>>('/auth/login', { email, password });
  return res.data.data;
}

export async function logout(refreshToken: string): Promise<void> {
  await apiClient.post('/auth/logout', { refreshToken });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/change-password', { currentPassword, newPassword });
}
