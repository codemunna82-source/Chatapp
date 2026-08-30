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
  /** The number an admin assigned this user, if any. */
  whatsappPhoneNumberId?: string;
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
  /** When this contact's photo last changed; doubles as the cache-buster
   *  for its image URL. Absent when no photo has been set. */
  avatarUpdatedAt?: string;
  isDemo: boolean;
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
  /** Who sent the last message, and how far our own send got — lets the
   *  chat row show a tick without a query per row. */
  lastMessageDirection?: MessageDirection;
  lastMessageStatus?: MessageStatus;
  lastCustomerMessageAt?: string;
  conversationWindowExpiresAt?: string;
  withinCustomerServiceWindow: boolean;
  /**
   * Seeded sample data. The 24-hour window UI is dropped entirely for these
   * — the number is not on WhatsApp, so neither the countdown nor the
   * template prompt describes anything real (the backend treats them as a
   * local sandbox to match).
   */
  isDemo: boolean;
  unreadCount: number;
  /**
   * Set by "mark as unread". Kept separate from unreadCount so the badge
   * can keep showing the real number of unread messages while the row still
   * reads as unread — see the backend's conversation.model.ts.
   */
  manuallyUnread: boolean;
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
  /**
   * Delivery milestones, each present only once it has actually happened.
   * readAt stays absent forever when the customer has read receipts turned
   * off — that is an answer, not missing data.
   */
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
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
  /** Today against yesterday — a direction of travel, which totals alone
   *  never give. */
  today: { sent: number; received: number; sentYesterday: number; receivedYesterday: number };
  /** Median minutes from a customer's message to the first reply. Null when
   *  there is nothing to measure — not zero, which would read as instant. */
  medianFirstResponseMinutes: number | null;
  topContacts: { contactId: string; name?: string; phone: string; messages: number }[];
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
  /** Which of the workspace's WhatsApp numbers this member sends from.
   *  Undefined = unassigned, which falls back to the workspace default. */
  whatsappPhoneNumberId?: string;
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

/** One of the workspace's connected WhatsApp numbers, as offered in the
 *  MASTER_ADMIN "sends from" picker. */
export interface WhatsAppNumber {
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  status: 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | 'RESTRICTED';
  qualityRating?: string;
}
