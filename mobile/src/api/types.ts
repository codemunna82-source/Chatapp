/** Mirrors the backend's response contract exactly (backend/src/middleware/errorHandler.middleware.ts). */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: { nextCursor?: string | null };
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type UserRole = 'MASTER_ADMIN' | 'SUB_USER';

export type Permission =
  | 'CHAT_READ'
  | 'CHAT_SEND'
  | 'CHAT_MEDIA'
  | 'CHAT_TEMPLATE'
  | 'CHAT_REACTION'
  | 'CHAT_PIN'
  | 'CALL_ACCESS'
  | 'CALL_HISTORY'
  | 'ANALYTICS_VIEW'
  | 'PROFILE_VIEW'
  | 'PROFILE_EDIT';

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  displayName?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}
