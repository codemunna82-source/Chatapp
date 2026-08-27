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
  mediaId?: string;
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
