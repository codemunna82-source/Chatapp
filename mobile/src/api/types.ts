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

/** Mirrors backend/src/modules/users/permission.ts exactly — keep both lists in sync by hand, there's no shared package between the two apps. */
export const ALL_PERMISSIONS = [
  'CHAT_READ',
  'CHAT_SEND',
  'CHAT_MEDIA',
  'CHAT_TEMPLATE',
  'CHAT_REACTION',
  'CHAT_PIN',
  'CALL_ACCESS',
  'CALL_HISTORY',
  'ANALYTICS_VIEW',
  'PROFILE_VIEW',
  'PROFILE_EDIT',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  displayName?: string;
  avatarUpdatedAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface Contact {
  id: string;
  tenantId: string;
  phone: string;
  name?: string;
  avatarUrl?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type ConversationStatus = 'OPEN' | 'ARCHIVED';

export interface Conversation {
  id: string;
  tenantId: string;
  contactId: string;
  contact?: Contact;
  whatsappPhoneNumberId: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastCustomerMessageAt?: string;
  conversationWindowExpiresAt?: string;
  withinCustomerServiceWindow: boolean;
  unreadCount: number;
  pinned: boolean;
  pinnedAt?: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export type MessageDirection = 'IN' | 'OUT';
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'contacts'
  | 'reaction'
  | 'template'
  | 'interactive'
  | 'sticker'
  | 'unknown';
export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  text?: string;
  /** Set only when starred — the API omits it otherwise. */
  starredAt?: string;
  mediaId?: string;
  /**
   * Client-only: the local file behind an outgoing media message, set on the
   * optimistic entry so the photo appears in the chat the instant it is
   * picked rather than after the upload round-trip. Never sent or returned
   * by the API, and gone once the server's real message replaces this one.
   */
  localUri?: string;
  replyToMessageId?: string;
  status: MessageStatus;
  senderId?: string;
  createdAt: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status: string;
  components: unknown;
}

export interface UploadedMedia {
  id: string;
  mimeType: string;
  sizeBytes: number;
  status: 'UPLOADING' | 'READY' | 'FAILED';
}

export interface Wallet {
  id: string;
  tenantId: string;
  balance: number;
  currency: string;
}

export interface WalletTransaction {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  reason: string;
  referenceId?: string;
  createdAt: string;
}

export type NotificationType =
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_FAILED'
  | 'SUBSCRIPTION_EXPIRING'
  | 'SUBSCRIPTION_EXPIRED'
  | 'ACCOUNT_DISABLED'
  | 'CALL_MISSED'
  | 'SYSTEM';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: { conversationId?: string; [key: string]: unknown };
  readAt?: string;
  createdAt: string;
}

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED';

export interface Subscription {
  id: string;
  plan: string;
  validFrom: string;
  validUntil: string;
  autoRenew: boolean;
  status: SubscriptionStatus;
}

export interface DashboardSummary {
  contactsTotal: number;
  conversations: { open: number; archived: number; unreadTotal: number };
  messages: { sentTotal: number; receivedTotal: number; failedTotal: number };
  messagesByDay: { date: string; sent: number; received: number }[];
}

export type CallDirection = 'INBOUND' | 'OUTBOUND';
export type CallStatus = 'INITIATED' | 'RINGING' | 'ANSWERED' | 'COMPLETED' | 'MISSED' | 'FAILED';

export interface CallLog {
  id: string;
  contactId: string;
  contact?: Contact;
  direction: CallDirection;
  status: CallStatus;
  duration: number;
  startedAt?: string;
  endedAt?: string;
  provider?: string;
  createdAt: string;
}

/** `deepLink` opens the real WhatsApp app on the contact's chat — see call.service.ts for why that's as far as any third-party app can go. */
export interface InitiateCallResult {
  call: CallLog;
  deepLink: string;
}

export type UserStatus = 'ACTIVE' | 'DISABLED';

/** A sub-user (or the MASTER_ADMIN) in the caller's tenant — GET/POST/PATCH/DELETE /api/users, MASTER_ADMIN only. */
export interface TeamMember {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  status: UserStatus;
  validFrom: string;
  validUntil: string;
  displayName?: string;
  lastLoginAt?: string;
  avatarUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved reply, shared across the whole workspace (see the backend's
 *  quickReply.model.ts for why it is tenant-wide rather than per-user). */
export interface QuickReply {
  id: string;
  title: string;
  body: string;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}
