import { apiClient } from '../client';
import { apiBaseUrl } from '../../utils/env';
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

export async function createContact(input: { phone: string; name?: string; tags?: string[] }): Promise<Contact> {
  const res = await apiClient.post<ApiSuccess<Contact>>('/contacts', input);
  return res.data.data;
}

export interface UpdateContactInput {
  id: string;
  name?: string;
  tags?: string[];
}

export async function updateContact({ id, ...patch }: UpdateContactInput): Promise<Contact> {
  const res = await apiClient.patch<ApiSuccess<Contact>>(`/contacts/${id}`, patch);
  return res.data.data;
}

/** Deletes a contact along with their conversations and messages in this workspace. */
export async function deleteContact(id: string): Promise<void> {
  await apiClient.delete(`/contacts/${id}`);
}

/**
 * The authenticated proxy URL for a contact's photo — same shape as
 * userAvatarUrl, and read the same way (Avatar attaches the bearer token).
 * `version` should be the contact's avatarUpdatedAt so a freshly uploaded
 * photo is not served from a stale cache at the same URL.
 */
export function contactAvatarUrl(contactId: string, version?: string): string {
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${apiBaseUrl}/contacts/${contactId}/avatar${v}`;
}

export interface PickedPhoto {
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Uploads a photo for a contact.
 *
 * Not a sync from WhatsApp: Meta's Cloud API exposes no way to read a
 * customer's profile picture, so this is the workspace's own record of who
 * someone is.
 */
export async function uploadContactAvatar(contactId: string, file: PickedPhoto): Promise<Contact> {
  const form = new FormData();
  // RN's FormData takes this {uri,name,type} shape rather than a Blob.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  const res = await apiClient.patch<ApiSuccess<Contact>>(`/contacts/${contactId}/avatar`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}
