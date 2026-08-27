import { apiClient } from '../client';
import type { ApiSuccess, DashboardSummary } from '../types';

export async function getDashboard(): Promise<DashboardSummary> {
  const res = await apiClient.get<ApiSuccess<DashboardSummary>>('/dashboard');
  return res.data.data;
}
