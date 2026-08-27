import { apiClient } from '../client';
import type { ApiSuccess, Subscription } from '../types';

export async function getSubscription(): Promise<Subscription> {
  const res = await apiClient.get<ApiSuccess<Subscription>>('/subscription');
  return res.data.data;
}
