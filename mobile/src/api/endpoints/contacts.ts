import { apiClient } from '../client';
import type { ApiSuccess, Contact } from '../types';

export interface ListContactsParams {
  search?: string;
  cursor?: string;
  limit?: number;
}

export async function listContacts(params: ListContactsParams): Promise<{ items: Contact[]; nextCursor: string | null }> {
  const res = await apiClient.get<ApiSuccess<Contact[]>>('/contacts', { params });
  return { items: res.data.data, nextCursor: res.data.meta?.nextCursor ?? null };
}

export async function getContact(id: string): Promise<Contact> {
  const res = await apiClient.get<ApiSuccess<Contact>>(`/contacts/${id}`);
  return res.data.data;
}

export async function createContact(input: { phone: string; name?: string }): Promise<Contact> {
  const res = await apiClient.post<ApiSuccess<Contact>>('/contacts', input);
  return res.data.data;
}
