import { apiClient } from '../client';
import type { ApiSuccess, Permission, TeamMember, UserRole, UserStatus } from '../types';

export interface ListTeamMembersParams {
  status?: UserStatus;
  cursor?: string;
  limit?: number;
}

export async function listTeamMembers(
  params: ListTeamMembersParams = {},
): Promise<{ items: TeamMember[]; nextCursor: string | null }> {
  const res = await apiClient.get<ApiSuccess<TeamMember[]>>('/users', { params });
  return { items: res.data.data, nextCursor: res.data.meta?.nextCursor ?? null };
}

export interface CreateTeamMemberInput {
  email: string;
  password: string;
  role: UserRole;
  permissions: Permission[];
  validUntil: string; // ISO date
  displayName?: string;
  /** Optional at creation — leaving it off means the workspace default. */
  whatsappPhoneNumberId?: string;
}

export async function createTeamMember(input: CreateTeamMemberInput): Promise<TeamMember> {
  const res = await apiClient.post<ApiSuccess<TeamMember>>('/users', input);
  return res.data.data;
}

export interface UpdateTeamMemberInput {
  id: string;
  role?: UserRole;
  permissions?: Permission[];
  validUntil?: string;
  status?: UserStatus;
  displayName?: string;
  /** `null` clears the assignment; omitted leaves it as it is. */
  whatsappPhoneNumberId?: string | null;
}

export async function updateTeamMember({ id, ...patch }: UpdateTeamMemberInput): Promise<TeamMember> {
  const res = await apiClient.patch<ApiSuccess<TeamMember>>(`/users/${id}`, patch);
  return res.data.data;
}

export async function disableTeamMember(id: string): Promise<TeamMember> {
  const res = await apiClient.delete<ApiSuccess<TeamMember>>(`/users/${id}`);
  return res.data.data;
}
