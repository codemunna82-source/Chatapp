import { apiClient } from '../client';
import type { ApiSuccess, MessageTemplate } from '../types';

export async function listTemplates(): Promise<MessageTemplate[]> {
  const res = await apiClient.get<ApiSuccess<MessageTemplate[]>>('/templates');
  return res.data.data;
}
