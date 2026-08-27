import { apiClient } from '../client';
import type { ApiSuccess, CallLog, InitiateCallResult } from '../types';

export interface ListCallsParams {
  cursor?: string;
  limit?: number;
}

export async function listCalls(params: ListCallsParams): Promise<{ items: CallLog[]; nextCursor: string | null }> {
  const res = await apiClient.get<ApiSuccess<CallLog[]>>('/calls', { params });
  return { items: res.data.data, nextCursor: res.data.meta?.nextCursor ?? null };
}

export async function initiateCall(contactId: string): Promise<InitiateCallResult> {
  const res = await apiClient.post<ApiSuccess<InitiateCallResult>>('/calls', { contactId });
  return res.data.data;
}
