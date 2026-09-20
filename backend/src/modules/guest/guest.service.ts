import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { trace } from '../../lib/perfTrace';
import type { AuthContext } from '../../types/express';
import { Tenant } from '../tenants/tenant.model';
import { findContactByIdAndTenant, findOrCreateContactByPhone } from '../contacts/contact.repository';
import { contactDisplayName, normalizePhone } from '../../lib/phone';
import type { GuestMediaKind } from './guestMedia.service';
import { findPhoneNumberByIdAndTenant } from '../whatsapp/whatsapp.repository';
import { refreshNumberHealthIfStale } from '../whatsapp/whatsapp.service';
import {
  findConversationByIdAndTenant,
  findOrCreateConversation,
  recordGuestInboundActivity,
  recordOutboundActivity,
  updateLastMessageStatus,
} from '../conversations/conversation.repository';
import { resolveSendingPhoneNumberId } from '../conversations/conversation.service';
import { visibleWhatsAppPhoneNumberId } from '../conversations/conversation.access';
import { setAwaitingWebChat } from '../conversations/conversation.repository';
import {
  createMessage,
  deleteGuestReactions,
  upsertGuestReaction,
  findMessagesByIds,
  findReactionsForMessages,
  listMessagesByConversation,
  hideMessageForGuest,
} from '../messages/message.repository';
import { revokeAndBroadcast } from '../messages/message.service';
import { Message, type MessageLean } from '../messages/message.model';
import { refusalToRevoke, messageChannel, REVOKE_REFUSAL_MESSAGE } from '../messages/messageRevoke';
import { getBusinessAvatar, resolveBusinessAvatar } from '../tenants/tenantAvatar.service';
import { pushIncomingMessage } from '../notifications/push.service';
import { getRealtimeEmitter } from '../../realtime/events';
import { toRealtimeMessage, toRealtimeConversation } from '../../realtime/serializers';
import {
  createGuestSession,
  findActiveSessionForConversation,
  findSessionByToken,
  revokeSessionsForConversation,
  setSessionBlocked,
  touchSession,
  activateGuestSession,
} from './guestSession.repository';
import { countRecentGuestReports, createGuestReport, listGuestReportsForConversation } from './guestReport.repository';
import { deleteGuestPushTokensForConversation } from './guestPushToken.repository';
import { pushGuestMessage } from './guestPush.service';
import type { GuestReportLean, GuestReportReason } from './guestReport.model';
import { resolveBusinessName, resolveBusinessNameForConversation } from './businessName';
import { hasMovedToWebChat } from './webChatRouting';
import { guestSessionExpiresAt } from './guestSessionExpiry';
import { findCustomerFacingNameForPhoneNumber } from '../users/user.repository';
import { guestChatUrl } from '../tenants/guestDomain';
import { guestLinkBaseUrlFor } from '../tenants/guestDomain.service';
import {
  CONTENT_POLICY_CODE,
  CONTENT_POLICY_MESSAGE,
  findPolicyViolationInSend,
} from '../messages/contentPolicy';

/**
 * What a resolved web-chat token stands for. Deliberately narrower than
 * AuthContext: a guest has no userId, no role and no permissions, and is
 * bound to exactly one conversation. Nothing downstream should be able to
 * mistake one for the other, which is why this is its own type rather than
 * an AuthContext with fields left blank.
 */
export interface GuestContext {
  sessionId: string;
  tenantId: string;
  conversationId: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  /** Set while the customer has blocked this window; neither side may write. */
  blockedAt?: Date;
}

/** How the customer sees a message — never the stored row. */
export interface GuestMessageView {
  id: string;
  /** The customer's own perspective. Storage is business-centric (IN/OUT); this is not. */
  from: 'me' | 'business';
  type: string;
  text?: string;
  hasMedia: boolean;
  /** Present when there is an attachment — the id the media route is asked for. */
  mediaId?: string;
  createdAt: string;
  /**
   * The message this one answers, as a preview rather than a reference.
   *
   * Sent inline because the quoted message is very often older than the
   * page the customer is looking at — resolving an id client-side would
   * mean either fetching the whole thread or showing an empty grey box
   * above every reply to something from last week.
   */
  replyTo?: {
    id: string;
    from: 'me' | 'business';
    /** One line: the text, or a word for a photo or a recording. */
    preview: string;
    /** What kind of message it was, so the window can put the right icon
     *  beside the line rather than inferring it from the wording. */
    type: string;
    /**
     * The quoted PHOTO, so the window can show it rather than the word
     * "photo". Present only for an image that still exists — a withdrawn
     * one has no bytes left to fetch.
     */
    mediaId?: string;
  };
  /** Emoji reactions on this message, most-used first. */
  reactions?: { emoji: string; mine: boolean }[];
  /** Present on `type: 'location'` — what the map pin should be drawn at. */
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  /**
   * How far the customer's OWN message has got: sent, delivered to the
   * workspace, or read by an agent.
   *
   * Only meaningful on `from: 'me'`, and deliberately absent on the
   * business's messages — the customer has no business knowing whether
   * the workspace's own outbound message reached WhatsApp, and a tick on
   * a bubble they did not send would mean nothing to them.
   *
   * Reported in the customer's terms rather than the storage enum:
   * QUEUED/SENT/FAILED are the workspace's delivery machinery, and a
   * customer who typed into a web window does not have a "queued" state
   * they could act on.
   */
  status?: 'sent' | 'delivered' | 'read';
  /**
   * Which wire it travelled on — what decides whether the customer may
   * offer to take it back. A message they sent from WhatsApp shows in
   * this window too, and cannot be withdrawn from it.
   */
  channel?: 'whatsapp' | 'web';
  /**
   * Set when this message was taken back by whoever sent it. The window
   * draws a tombstone; `text`, `mediaId` and `location` are absent
   * because the content is gone from the database, not withheld here.
   */
  revokedAt?: string;
  /** Which side withdrew it, so the window can say "you deleted this
   *  message" rather than "this message was deleted". */
  revokedBy?: 'agent' | 'customer';
}

/**
 * The stored row carries tenantId, senderId, Meta's message id and raw
 * send errors. None of that is the customer's to see, so the guest views
 * are built field by field rather than by deleting keys off the document —
 * a field added to Message later then has to be opted in, instead of
 * leaking the moment it lands.
 */
/**
 * The storage status, said in terms that mean something to a customer.
 *
 * READ is the only one worth a distinct mark: it is the answer to "did
 * anyone actually see this?". DELIVERED means it reached the workspace.
 * Everything else — QUEUED, SENT, FAILED — is the workspace's own
 * delivery machinery, and collapses to "sent", because a customer has no
 * queue to act on and a message they are looking at in their own thread
 * did not fail to be sent.
 */
export function toGuestStatus(status: string | undefined): 'sent' | 'delivered' | 'read' {
  if (status === 'READ') return 'read';
  if (status === 'DELIVERED') return 'delivered';
  return 'sent';
}

function toGuestMessage(doc: MessageLean): GuestMessageView {
  const view: GuestMessageView = {
    id: String(doc._id),
    from: doc.direction === 'IN' ? 'me' : 'business',
    type: doc.type,
    text: doc.text ?? undefined,
    hasMedia: Boolean(doc.mediaId),
    mediaId: doc.mediaId ? String(doc.mediaId) : undefined,
    createdAt: doc.createdAt.toISOString(),
    // Read through the same helper the server's own rule uses, so a row
    // written before the field existed is classified identically on both
    // sides rather than only here.
    channel: messageChannel(doc),
  };
  if (doc.direction === 'IN') view.status = toGuestStatus(doc.status);
  if (doc.revokedAt) {
    view.revokedAt = doc.revokedAt.toISOString();
    view.revokedBy = doc.revokedBy ?? undefined;
  }
  // Only when the coordinates are actually there. A location that arrived
  // before this field existed, or through a path that never filled it, has
  // its text line and nothing else — which renders as an ordinary message
  // rather than as a map pin pointing at (0, 0) off the coast of Ghana.
  const place = doc.location;
  if (doc.type === 'location' && place && typeof place.latitude === 'number' && typeof place.longitude === 'number') {
    view.location = {
      latitude: place.latitude,
      longitude: place.longitude,
      name: place.name ?? undefined,
      address: place.address ?? undefined,
    };
  }
  return view;
}

/**
 * The one line a location message shows in a list, a quote or a push.
 *
 * Built once here and stored as the message's `text` so every reader —
 * the chat list, the agent app, the notification, a search — gets the same
 * sentence without any of them knowing what a coordinate is.
 */
export function locationLine(input: { latitude: number; longitude: number; name?: string }): string {
  const coords = `${input.latitude.toFixed(6)}, ${input.longitude.toFixed(6)}`;
  return `${input.name?.trim() || 'Location'} (${coords})`;
}

/**
 * The quoted message, as the window needs to draw it.
 *
 * One builder because there were three copies of it, and because it just
 * grew a field: a reply to a photo used to quote the literal text
 * "[photo]", which says nothing about WHICH photo — and in a thread where
 * someone has just sent nine of them, that is the entire question.
 */
function quoteOf(quoted: MessageLean): NonNullable<GuestMessageView['replyTo']> {
  const view: NonNullable<GuestMessageView['replyTo']> = {
    id: String(quoted._id),
    from: quoted.direction === 'IN' ? 'me' : 'business',
    preview: previewOf(quoted),
    type: quoted.type,
  };
  // Only a picture. A document or a voice note has no frame to show, and
  // the window draws an icon for those instead of a grey box.
  if (quoted.type === 'image' && quoted.mediaId && !quoted.revokedAt) {
    view.mediaId = String(quoted.mediaId);
  }
  return view;
}

/** One line standing in for a message inside a quote. */
function previewOf(doc: MessageLean): string {
  // A reply that outlived the message it quoted. Checked first, before
  // the fields below: those are all empty on a revoked row, so without
  // this the quote would come back as the bare "[text]" of its type.
  if (doc.revokedAt) return 'This message was deleted';
  // Before the text check, not after: a location's text is its full
  // coordinate line, and a quote showing "Location (12.971599, 77.594566)"
  // spends its one line on digits nobody reads.
  if (doc.type === 'location') return `[location] ${doc.location?.name ?? ''}`.trim();
  if (doc.text) return doc.text;
  if (doc.type === 'image') return '[photo]';
  if (doc.type === 'audio') return '[voice message]';
  return `[${doc.type}]`;
}

/**
 * Turns a page of stored rows into what the customer sees.
 *
 * Reactions live in this collection as ordinary messages — type
 * 'reaction', the emoji in `text`, the target in `replyToMessageId` — so
 * they have to be folded onto the messages they belong to and removed from
 * the list, or every thumbs-up would render as its own bubble.
 *
 * Quotes are resolved from whatever is on the page first, and only the
 * targets still missing are fetched. A reply to the message directly above
 * it — which is most replies — then costs no query at all.
 */
async function toGuestMessagePage(
  tenantId: string,
  conversationId: string,
  visible: MessageLean[],
): Promise<GuestMessageView[]> {
  const onPage = new Map(visible.map((d) => [String(d._id), d]));
  const missing = visible
    .filter((d) => d.replyToMessageId && !onPage.has(String(d.replyToMessageId)))
    .map((d) => String(d.replyToMessageId));

  // Quotes whose target is off the page, and every reaction on this page's
  // messages — both looked up by id rather than hoped for in the same
  // batch, which is the only way either works once a thread is longer than
  // one page.
  const [quoted, reactions] = await Promise.all([
    missing.length > 0
      ? findMessagesByIds(tenantId, conversationId, [...new Set(missing)])
      : Promise.resolve([]),
    findReactionsForMessages(tenantId, conversationId, [...onPage.keys()]),
  ]);
  for (const doc of quoted) onPage.set(String(doc._id), doc);

  const byTarget = new Map<string, { emoji: string; mine: boolean }[]>();
  for (const r of reactions) {
    if (!r.text || !r.replyToMessageId) continue;
    const target = String(r.replyToMessageId);
    const list = byTarget.get(target) ?? [];
    list.push({ emoji: r.text, mine: r.direction === 'IN' });
    byTarget.set(target, list);
  }

  return visible.map((doc) => {
    const view = toGuestMessage(doc);
    const quoted = doc.replyToMessageId ? onPage.get(String(doc.replyToMessageId)) : undefined;
    if (quoted) {
      view.replyTo = quoteOf(quoted);
    }
    const emoji = byTarget.get(String(doc._id));
    if (emoji && emoji.length > 0) view.reactions = emoji;
    return view;
  });
}

export async function resolveGuestContextFromToken(token: string): Promise<GuestContext> {
  const session = await findSessionByToken(token);
  if (!session) {
    throw ApiError.unauthorized('GUEST_LINK_INVALID', 'This chat link is no longer valid');
  }
  touchSession(String(session._id));
  return {
    sessionId: String(session._id),
    tenantId: String(session.tenantId),
    conversationId: String(session.conversationId),
    contactId: String(session.contactId),
    whatsappPhoneNumberId: String(session.whatsappPhoneNumberId),
    blockedAt: session.blockedAt ?? undefined,
  };
}

/**
 * Refuses a write from a window the customer has blocked.
 *
 * Its own error code rather than a 403 with prose: the window has to tell
 * these apart to react to them. An expired link means "this chat is over",
 * a blocked one means "you turned this off, here is the button to turn it
 * back on" — and the second is a state the customer chose and can undo.
 */
export function assertGuestNotBlocked(guest: GuestContext): void {
  if (guest.blockedAt) {
    throw ApiError.forbidden('GUEST_BLOCKED', 'You blocked this chat. Unblock it to send messages.');
  }
}

/**
 * The link an agent sends into a WhatsApp thread.
 *
 * An existing live session is reused rather than replaced: every copy of
 * the link the customer was already sent stays in their WhatsApp history,
 * and minting a new token would turn all of them into dead links that are
 * just as likely to be tapped as the newest one.
 */
export async function issueGuestLinkForConversation(
  auth: AuthContext,
  conversationId: string,
): Promise<{ url: string; token: string; expiresAt: string; reused: boolean }> {
  // The workspace's own chat domain when it has one, the shared one
  // otherwise. Resolved before anything is minted so a workspace with no
  // domain at all fails here rather than after a session exists.
  const linkBaseUrl = await guestLinkBaseUrlFor(auth.tenantId);
  if (!linkBaseUrl) {
    throw ApiError.serviceUnavailable(
      'GUEST_LINK_NOT_CONFIGURED',
      'No chat domain is configured on the server, so a chat link cannot be built yet',
    );
  }

  const conversation = await findConversationByIdAndTenant(conversationId, auth.tenantId);
  const scope = visibleWhatsAppPhoneNumberId(auth);
  if (!conversation || (scope && String(conversation.whatsappPhoneNumberId) !== scope)) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  const existing = await findActiveSessionForConversation(conversationId, auth.tenantId);
  if (existing) {
    // The plaintext token was only ever returned once, at creation — the
    // stored hash cannot be reversed back into a URL. So a reused session
    // can report when it expires but not what its link was; the agent app
    // keeps the URL from the call that created it.
    throw ApiError.conflict(
      'GUEST_LINK_EXISTS',
      'This conversation already has an active chat link. Revoke it first to issue a new one.',
    );
  }

  const expiresAt = guestSessionExpiresAt();
  const { token } = await createGuestSession({
    tenantId: auth.tenantId,
    conversationId,
    contactId: String(conversation.contactId),
    whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
    createdByUserId: auth.userId,
    expiresAt,
  });

  return {
    url: guestChatUrl(linkBaseUrl, token),
    token,
    expiresAt: expiresAt.toISOString(),
    reused: false,
  };
}

/**
 * The link for a customer identified by their phone number.
 *
 * This is how an agent actually reaches for it: they have the number the
 * customer messages them from, not a conversation id. The number is the
 * join key — the same one Meta's webhooks resolve inbound WhatsApp
 * messages by — so the web chat lands in the thread that already holds
 * that customer's WhatsApp history rather than starting a second one
 * beside it.
 *
 * Normalised before anything is looked up or created (see lib/phone.ts):
 * "+91 98765-43210" and the bare digits Meta sends are the same person,
 * and storing them as two contacts is exactly the failure this avoids.
 */
export async function issueGuestLinkForPhone(
  auth: AuthContext,
  phone: string,
  name?: string,
): Promise<{ url: string; token: string; expiresAt: string; conversationId: string; phone: string }> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw ApiError.badRequest('INVALID_PHONE', 'That does not look like a phone number.');
  }

  const sendingNumberId = await resolveSendingPhoneNumberId(auth.tenantId, auth.userId);
  if (!sendingNumberId) {
    throw ApiError.badRequest(
      'NO_WHATSAPP_NUMBER',
      'This workspace has no connected WhatsApp number yet, so a chat cannot be started.',
    );
  }

  const contact = await findOrCreateContactByPhone(auth.tenantId, normalized, name);
  const conversation = await findOrCreateConversation(
    auth.tenantId,
    String(contact._id),
    sendingNumberId,
  );

  // A safety net, not the main defence: findOrCreate is keyed on the
  // number, and the number came from this agent's own assignment, so a
  // scoped agent can only ever get their own thread back. Kept because the
  // two facts live in different files — if the sending number ever resolved
  // outside this agent's scope, issuing a link would become a way to read a
  // conversation they are not allowed to see.
  const scope = visibleWhatsAppPhoneNumberId(auth);
  if (scope && String(conversation.whatsappPhoneNumberId) !== scope) {
    throw ApiError.forbidden(
      'CONVERSATION_OWNED_BY_ANOTHER_NUMBER',
      'This contact already has a chat on a different WhatsApp number.',
    );
  }

  const link = await issueGuestLinkForConversation(auth, String(conversation._id));
  return {
    url: link.url,
    token: link.token,
    expiresAt: link.expiresAt,
    conversationId: String(conversation._id),
    phone: normalized,
  };
}

/**
 * Whether this conversation has a live web chat window.
 *
 * The agent app needs this to know whether replying outside Meta's
 * 24-hour window is possible at all — without it the only honest thing
 * the composer could do is offer the option and let it fail.
 *
 * The URL is deliberately absent: the token was returned once, at
 * creation, and only its hash is stored. Reporting "there is one" is
 * everything that can truthfully be said about a link already sent.
 */
export async function getGuestLinkStatus(
  auth: AuthContext,
  conversationId: string,
): Promise<{
  active: boolean;
  expiresAt?: string;
  blockedByCustomer?: boolean;
  openedByCustomer?: boolean;
}> {
  const session = await findActiveSessionForConversation(conversationId, auth.tenantId);
  if (!session) return { active: false };
  return {
    active: true,
    expiresAt: session.expiresAt.toISOString(),
    /**
     * The customer has actually used the window, so replies are being
     * delivered there instead of to WhatsApp (see webChatRouting.ts).
     *
     * Reported so the composer can say where a message is going. It does
     * not decide anything — the server routes every send on its own — but
     * an agent typing into a chat deserves to know which of the two
     * places the customer will read it.
     */
    openedByCustomer: hasMovedToWebChat(session),
    // So the composer can say why it is disabled instead of failing on
    // send. The agent finding out at the moment they press the button is
    // the worst time to learn this.
    blockedByCustomer: Boolean(session.blockedAt),
  };
}

/** What the workspace sees of a report. */
export interface GuestReportView {
  id: string;
  reason: string;
  details?: string;
  reportedMessageId?: string;
  reportedMessagePreview?: string;
  blocked: boolean;
  status: string;
  createdAt: string;
}

/**
 * The reports a customer filed on this conversation.
 *
 * Scoped through the same conversation visibility check the rest of the
 * agent routes use, so a report is readable by exactly the people who can
 * already read the chat it is about.
 */
export async function listGuestReports(
  auth: AuthContext,
  conversationId: string,
): Promise<GuestReportView[]> {
  const conversation = await findConversationByIdAndTenant(conversationId, auth.tenantId);
  const scope = visibleWhatsAppPhoneNumberId(auth);
  if (!conversation || (scope && String(conversation.whatsappPhoneNumberId) !== scope)) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }
  const rows: GuestReportLean[] = await listGuestReportsForConversation(auth.tenantId, conversationId);
  return rows.map((row) => ({
    id: String(row._id),
    reason: row.reason,
    details: row.details ?? undefined,
    reportedMessageId: row.reportedMessageId ? String(row.reportedMessageId) : undefined,
    reportedMessagePreview: row.reportedMessagePreview ?? undefined,
    blocked: Boolean(row.blocked),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function revokeGuestLinkForConversation(
  auth: AuthContext,
  conversationId: string,
): Promise<{ revoked: number }> {
  const conversation = await findConversationByIdAndTenant(conversationId, auth.tenantId);
  const scope = visibleWhatsAppPhoneNumberId(auth);
  if (!conversation || (scope && String(conversation.whatsappPhoneNumberId) !== scope)) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }
  const revoked = await revokeSessionsForConversation(conversationId, auth.tenantId);
  // The link is gone, so the notifications must go with it.
  await deleteGuestPushTokensForConversation(auth.tenantId, conversationId);
  return { revoked };
}

/**
 * What the web page shows in its header. Only what a customer already
 * knows: the business they are talking to and their own name.
 */
export async function getGuestSessionView(guest: GuestContext): Promise<{
  conversationId: string;
  businessName: string;
  contactName?: string;
  /**
   * When the business's photo last changed, or null when it has none.
   *
   * A version, not a URL. The bytes come from a route behind this
   * customer's own link, so a link holder never receives an address that
   * outlives their link — and null is what stops the window asking for a
   * picture that is not there.
   */
  businessAvatarUpdatedAt?: string | null;
  /**
   * Whether Meta has reviewed and approved this business's display name.
   *
   * Reported so the window can show a verification badge that means
   * something — and, just as importantly, show nothing when there is
   * nothing to show. This is Meta's statement, read back from Meta, with
   * no way for a business to set it for itself: a badge you can switch on
   * for yourself tells the customer looking at it precisely nothing, and
   * claiming WhatsApp vouched for an account it has not reviewed is both a
   * lie to that customer and grounds for losing the number.
   */
  verifiedByWhatsApp: boolean;
  /** The business's own number, as the customer would see it in WhatsApp. */
  businessPhone?: string;
  /**
   * Whether the customer has blocked this window.
   *
   * Sent on every session load rather than only in the response to the tap
   * that set it, because the state outlives the tab: someone who blocks,
   * closes the page and comes back a week later has to find the window in
   * the state they left it, with the Unblock button where they can see it.
   */
  blocked: boolean;
}> {
  const [tenant, contact, phoneNumber, memberName] = await Promise.all([
    Tenant.findById(guest.tenantId).select('name displayName').lean(),
    findContactByIdAndTenant(guest.contactId, guest.tenantId),
    findPhoneNumberByIdAndTenant(guest.whatsappPhoneNumberId, guest.tenantId),
    findCustomerFacingNameForPhoneNumber(guest.tenantId, guest.whatsappPhoneNumberId),
  ]);

  // APPROVED is the only value that means "Meta reviewed this and accepted
  // it". PENDING_REVIEW and DECLINED are both "not verified", and treating
  // a pending review as a pass would put the badge up during exactly the
  // window in which Meta has not decided.
  const verifiedByWhatsApp = phoneNumber?.nameStatus === 'APPROVED';

  // nameStatus used to be refreshed only when an admin opened the numbers
  // screen, so a workspace where nobody had opened it showed no badge for
  // a name Meta had approved months earlier — the badge was wired to a
  // field nothing was keeping current.
  //
  // Never awaited: the customer's window must not wait on a Graph round
  // trip, and the value it renders this time is the stored one either
  // way. The next load shows the fresh reading. Rate-limited by
  // healthCheckedAt inside refreshNumberHealth, so a busy conversation
  // costs one call per number per staleness window, not one per page view.
  if (phoneNumber) void refreshNumberHealthIfStale(phoneNumber);

  return {
    conversationId: guest.conversationId,
    businessName: resolveBusinessName({
      displayName: tenant?.displayName,
      memberName,
      verifiedName: phoneNumber?.verifiedName,
      tenantName: tenant?.name,
    }).name,
    contactName: contact?.name ?? undefined,
    /**
     * When the business's photo last changed, or absent when there is
     * none — which is what tells the window not to ask for one.
     *
     * A version rather than a URL: the bytes are served from a route
     * behind this customer's own link (see GET /api/guest/business-avatar),
     * so a link holder never receives an address that outlives their
     * link.
     */
    businessAvatarUpdatedAt: (
      await resolveBusinessAvatar(guest.tenantId, guest.whatsappPhoneNumberId)
    )?.version ?? null,
    verifiedByWhatsApp,
    businessPhone: phoneNumber?.displayPhoneNumber ?? undefined,
    blocked: Boolean(guest.blockedAt),
  };
}

export async function listGuestMessages(
  guest: GuestContext,
  opts: { cursor?: string; limit?: number },
): Promise<{ items: GuestMessageView[]; nextCursor: string | null }> {
  const page = await listMessagesByConversation(guest.tenantId, guest.conversationId, {
    cursor: opts.cursor,
    limit: opts.limit,
    // Reactions are folded onto their targets below; counting them here
    // would return short pages.
    excludeReactions: true,
    // The customer's own "delete for me" list, which is theirs alone —
    // the workspace's deletions are a separate field and neither side
    // sees the other's.
    forGuest: true,
  });
  return {
    items: await toGuestMessagePage(guest.tenantId, guest.conversationId, page.items),
    nextCursor: page.nextCursor,
  };
}

/**
 * A message the customer typed in the web window.
 *
 * Stored as direction IN — from the workspace's point of view it is a
 * customer message and belongs in the same thread as their WhatsApp ones,
 * so the agent reads one conversation rather than two half-conversations
 * side by side. It does NOT go to Meta: the customer is already here.
 */
export async function postGuestMessage(
  guest: GuestContext,
  text: string,
  replyToMessageId?: string,
): Promise<GuestMessageView> {
  assertGuestNotBlocked(guest);

  // SERVER_RECEIVED for the customer -> agent direction. Off unless
  // PERF_TRACE=true; see lib/perfTrace.ts.
  const perf = trace('guest.send', { conversationId: guest.conversationId, type: 'text' });

  const [conversation, phoneNumber, contact] = await Promise.all([
    findConversationByIdAndTenant(guest.conversationId, guest.tenantId),
    findPhoneNumberByIdAndTenant(guest.whatsappPhoneNumberId, guest.tenantId),
    findContactByIdAndTenant(guest.contactId, guest.tenantId),
  ]);
  perf.mark('parallel_reads');
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'This conversation no longer exists');
  }

  // The quoted message must be one from this conversation. The id comes
  // from a client that is otherwise trusted only for its own token, and a
  // reply pointing at someone else's message would put a line of their
  // thread on this customer's screen.
  const quoted = await resolveQuotedMessage(guest, replyToMessageId);
  if (replyToMessageId) perf.mark('quoted_read');

  const message = await createMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    // Delivered by definition: it was written straight into our own
    // database, with no gateway in between that could still drop it.
    recipientPhone: phoneNumber?.displayPhoneNumber?.trim() || guest.whatsappPhoneNumberId,
    direction: 'IN',
    // This app's own channel on both ends — see the model's `channel`
    // note and messageRevoke.ts. It is what makes this message one the
    // sender can take back.
    channel: 'web',
    type: 'text',
    text,
    replyToMessageId: quoted ? String(quoted._id) : undefined,
    status: 'DELIVERED',
  });

  /**
   * The socket, the moment the message exists.
   *
   * It used to come after the activation write, the welcome message and
   * the conversation-row update — three more round trips to a database on
   * another continent, with the agent's app showing nothing for the whole
   * of it. None of them changes this message or decides whether it is
   * delivered, so none of them belongs in front of it.
   */
  perf.mark('db_insert');

  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(guest.tenantId, toRealtimeMessage(message), guest.whatsappPhoneNumberId);
  // SOCKET_EMIT_RECEIVER — every open agent app has it from here.
  perf.mark('emit');
  perf.end({ messageId: String(message._id) });

  // The customer has moved over. This is the moment three things stop or
  // start, and all three must happen exactly once — which is what
  // activateGuestSession's filter guarantees when two messages are sent
  // in the same breath.
  const justActivated = await activateGuestSession(guest.sessionId);
  if (justActivated) {
    // Release: everything they wrote on WhatsApp is already stored, so
    // clearing the flag is the whole of it. The agent's app finds the full
    // thread the first time it opens the conversation.
    await setAwaitingWebChat(guest.conversationId, guest.tenantId, false);
  }

  const updated = await recordGuestInboundActivity(guest.conversationId, guest.tenantId, text);
  if (updated) {
    realtime.emitConversationUpdated(guest.tenantId, toRealtimeConversation(updated));
  }

  // Never allowed to fail the request, and never waited on: the message is
  // already stored and already on every open agent app over the socket, so
  // a round trip to Google is time the customer spends watching a pending
  // tick for a message that has arrived.
  void pushIncomingMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
    contactName: contactDisplayName(contact),
    contactId: contact ? String(contact._id) : undefined,
    // The photo's own version, so the notification shows the picture the
    // contact has now rather than one the phone cached weeks ago.
    avatarVersion: contact?.avatarUpdatedAt?.toISOString(),
    sentAt: message.createdAt,
    messageType: 'text',
    text,
  }).catch(() => {});

  const view = toGuestMessage(message as unknown as MessageLean);
  if (quoted) {
    view.replyTo = quoteOf(quoted);
  }
  return view;
}


/**
 * The message a reply or reaction points at, or nothing.
 *
 * Absent rather than an error when the id does not resolve: the usual
 * reason is that the agent deleted the message between the customer
 * reading it and answering it, and refusing to accept the reply at that
 * point loses what they typed over something they cannot see or fix. The
 * reply lands without its quote instead.
 */
async function resolveQuotedMessage(
  guest: GuestContext,
  messageId?: string,
): Promise<MessageLean | null> {
  if (!messageId) return null;
  const [found] = await findMessagesByIds(guest.tenantId, guest.conversationId, [messageId]);
  return found ?? null;
}

/**
 * The customer reacting to a message.
 *
 * Stored the way the agent side already stores reactions — a row of type
 * 'reaction' whose text is the emoji and whose replyToMessageId is the
 * target — so one collection holds both, and the agent app renders a
 * customer's reaction with the code it already has.
 *
 * One reaction per customer per message, like the app it is modelled on:
 * reacting again replaces, and an empty emoji removes. A replacement is a
 * single upsert keyed on the row's identity rather than a delete followed
 * by an insert — two taps arriving together could otherwise both delete
 * and both insert, leaving one person with two reactions on one message.
 */
export async function postGuestReaction(
  guest: GuestContext,
  messageId: string,
  emoji: string,
): Promise<{ messageId: string; emoji: string | null }> {
  assertGuestNotBlocked(guest);

  const target = await resolveQuotedMessage(guest, messageId);
  if (!target) {
    throw ApiError.notFound('MESSAGE_NOT_FOUND', 'That message is no longer here.');
  }

  if (emoji.length === 0) {
    await deleteGuestReactions(guest.tenantId, guest.conversationId, messageId);
    // Nothing is emitted for a removal. A cleared reaction is not a
    // deleted message: message:updated (which deleteGuestMessage below
    // does send) carries a whole message and would arrive here with the
    // reaction's own row rather than the message it was attached to. The
    // agent app picks a cleared reaction up on its next fetch.
    return { messageId, emoji: null };
  }

  const phoneNumber = await findPhoneNumberByIdAndTenant(guest.whatsappPhoneNumberId, guest.tenantId);
  const row = await upsertGuestReaction({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    targetMessageId: messageId,
    recipientPhone: phoneNumber?.displayPhoneNumber?.trim() || guest.whatsappPhoneNumberId,
    emoji,
  });

  // Not recordGuestInboundActivity: a reaction is not a new message, and
  // bumping the chat list with "[reaction]" every time someone taps a
  // thumbs-up would bury the actual conversation.
  if (row) {
    getRealtimeEmitter().emitMessageNew(
      guest.tenantId,
      toRealtimeMessage(row),
      guest.whatsappPhoneNumberId,
    );
  }

  return { messageId, emoji };
}

/**
 * An image the customer picked in the web window.
 *
 * Stored the same way a typed message is — direction IN, on the same
 * conversation — so the agent reads one thread rather than photos landing
 * somewhere separate from the words around them. The bytes were already
 * put away by storeGuestMedia; this only records the message that points
 * at them.
 */
export async function postGuestMediaMessage(
  guest: GuestContext,
  mediaId: string,
  kind: GuestMediaKind,
): Promise<GuestMessageView> {
  assertGuestNotBlocked(guest);

  const [conversation, phoneNumber, contact] = await Promise.all([
    findConversationByIdAndTenant(guest.conversationId, guest.tenantId),
    findPhoneNumberByIdAndTenant(guest.whatsappPhoneNumberId, guest.tenantId),
    findContactByIdAndTenant(guest.contactId, guest.tenantId),
  ]);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'This conversation no longer exists');
  }

  const message = await createMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    recipientPhone: phoneNumber?.displayPhoneNumber?.trim() || guest.whatsappPhoneNumberId,
    direction: 'IN',
    channel: 'web',
    type: kind,
    mediaId,
    status: 'DELIVERED',
  });

  // The socket first — see postGuestMessage for why the two writes that
  // used to precede it do not belong in front of a message that is
  // already stored and final.
  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(guest.tenantId, toRealtimeMessage(message), guest.whatsappPhoneNumberId);

  // The chat list has one line per conversation and can show neither a
  // picture nor a recording, so it gets the same placeholder the WhatsApp
  // ingestion path uses for the same message types.
  const updated = await recordGuestInboundActivity(
    guest.conversationId,
    guest.tenantId,
    kind === 'image' ? '[image]' : '[voice message]',
  );
  if (updated) {
    realtime.emitConversationUpdated(guest.tenantId, toRealtimeConversation(updated));
  }

  void pushIncomingMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
    contactName: contactDisplayName(contact),
    contactId: contact ? String(contact._id) : undefined,
    // The photo's own version, so the notification shows the picture the
    // contact has now rather than one the phone cached weeks ago.
    avatarVersion: contact?.avatarUpdatedAt?.toISOString(),
    sentAt: message.createdAt,
    messageType: kind,
  }).catch(() => {});

  return toGuestMessage(message as unknown as MessageLean);
}

/**
 * A place the customer shared from the web window.
 *
 * Written as a `location` message, the same type WhatsApp ingestion writes
 * when a customer drops a pin in the app — so the agent's thread shows one
 * kind of location message whichever channel it came in through, and
 * nothing downstream needed a second case.
 *
 * `text` carries the readable line and `location` the numbers. Both, not
 * one: see the schema comment for why the coordinates are not parsed back
 * out of the sentence.
 */
export async function postGuestLocationMessage(
  guest: GuestContext,
  input: { latitude: number; longitude: number; name?: string; address?: string; replyToMessageId?: string },
): Promise<GuestMessageView> {
  assertGuestNotBlocked(guest);

  const [conversation, phoneNumber, contact] = await Promise.all([
    findConversationByIdAndTenant(guest.conversationId, guest.tenantId),
    findPhoneNumberByIdAndTenant(guest.whatsappPhoneNumberId, guest.tenantId),
    findContactByIdAndTenant(guest.contactId, guest.tenantId),
  ]);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'This conversation no longer exists');
  }

  const quoted = await resolveQuotedMessage(guest, input.replyToMessageId);
  const text = locationLine(input);

  const message = await createMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    recipientPhone: phoneNumber?.displayPhoneNumber?.trim() || guest.whatsappPhoneNumberId,
    direction: 'IN',
    channel: 'web',
    type: 'location',
    text,
    location: {
      latitude: input.latitude,
      longitude: input.longitude,
      name: input.name?.trim() || undefined,
      address: input.address?.trim() || undefined,
    },
    replyToMessageId: quoted ? String(quoted._id) : undefined,
    status: 'DELIVERED',
  });

  // The socket first, as on every other guest write path.
  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(guest.tenantId, toRealtimeMessage(message), guest.whatsappPhoneNumberId);

  const updated = await recordGuestInboundActivity(guest.conversationId, guest.tenantId, text);
  if (updated) {
    realtime.emitConversationUpdated(guest.tenantId, toRealtimeConversation(updated));
  }

  void pushIncomingMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
    contactName: contactDisplayName(contact),
    contactId: contact ? String(contact._id) : undefined,
    // The photo's own version, so the notification shows the picture the
    // contact has now rather than one the phone cached weeks ago.
    avatarVersion: contact?.avatarUpdatedAt?.toISOString(),
    sentAt: message.createdAt,
    messageType: 'location',
    text,
  }).catch(() => {});

  const view = toGuestMessage(message as unknown as MessageLean);
  if (quoted) {
    view.replyTo = quoteOf(quoted);
  }
  return view;
}

/** A customer may file this many reports through one link per day. */
const GUEST_REPORTS_PER_DAY = 5;

/**
 * The customer reporting this conversation, blocking it, or both.
 *
 * Blocking and reporting are one call because they are one decision on the
 * customer's screen, and splitting them would mean a window that reported
 * successfully and then failed to block — leaving someone who asked to
 * stop hearing from a business still hearing from them.
 *
 * The reported message is copied into the report rather than referenced,
 * so a workspace cannot make the evidence disappear by deleting the
 * message. And the report is stored, not emailed or logged: it has a
 * listing route on the agent side, because a complaint written into a
 * collection nobody reads is not a complaint, it is a shrug with a
 * database write.
 */
export async function submitGuestReport(
  guest: GuestContext,
  input: {
    reason?: GuestReportReason;
    details?: string;
    messageId?: string;
    block: boolean;
    report: boolean;
  },
): Promise<{ reportId?: string; blocked: boolean; reportedMessagePreview?: string }> {
  let reportId: string | undefined;
  let reportedMessagePreview: string | undefined;

  if (input.report) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if ((await countRecentGuestReports(guest.sessionId, since)) >= GUEST_REPORTS_PER_DAY) {
      throw ApiError.tooManyRequests(
        'GUEST_REPORT_LIMIT',
        'You have already sent several reports today. We are looking at them.',
      );
    }

    // Scoped to this conversation by resolveQuotedMessage, so a customer
    // cannot attach someone else's message to their complaint.
    const target = await resolveQuotedMessage(guest, input.messageId);
    reportedMessagePreview = target ? previewOf(target).slice(0, 500) : undefined;

    const report = await createGuestReport({
      tenantId: guest.tenantId,
      conversationId: guest.conversationId,
      contactId: guest.contactId,
      guestSessionId: guest.sessionId,
      reason: input.reason ?? 'OTHER',
      details: input.details?.trim() || undefined,
      reportedMessageId: target ? String(target._id) : undefined,
      reportedMessagePreview,
      blocked: input.block,
    });
    reportId = String(report._id);
  }

  if (input.block) {
    await setSessionBlocked(guest.sessionId, true);
  }

  return { reportId, blocked: input.block, reportedMessagePreview };
}

/**
 * The customer turning the block on or off.
 *
 * Separate from the report because unblocking exists: someone who blocked
 * a business and changed their mind is not filing anything, and the report
 * they already sent stays filed either way.
 */
export async function setGuestBlock(guest: GuestContext, blocked: boolean): Promise<{ blocked: boolean }> {
  await setSessionBlocked(guest.sessionId, blocked);
  return { blocked };
}

/**
 * An agent's reply delivered through the web window instead of WhatsApp.
 *
 * This exists because the two channels have different rules. A WhatsApp
 * reply is governed by Meta's 24-hour customer-service window, and once
 * that closes only an approved template may be sent — but a customer
 * sitting in the web chat is right there, and telling the agent to send a
 * marketing template to answer a live question would be absurd. So this
 * path writes the message and pushes it to the open web window, and never
 * calls Meta.
 *
 * Kept as its own function rather than a flag on sendOutboundMessage:
 * that function's whole job is the Meta send, its window check and its
 * failure handling, none of which applies here.
 */
export async function sendGuestReply(
  auth: AuthContext,
  conversationId: string,
  text: string,
): Promise<GuestMessageView> {
  /**
   * The same platform content policy sendOutboundMessage applies.
   *
   * Repeated here rather than shared through a wrapper because this is a
   * SECOND way out: an agent replying straight into the private window
   * never passes through sendOutboundMessage at all. A policy enforced on
   * one of two exits is not enforced. See contentPolicy.ts.
   */
  const violation = findPolicyViolationInSend({ text });
  if (violation) {
    logger.warn(
      {
        tenantId: auth.tenantId,
        conversationId,
        rule: violation.rule,
        terms: violation.terms,
      },
      'Web chat reply refused by the platform content policy',
    );
    throw new ApiError(422, CONTENT_POLICY_CODE, CONTENT_POLICY_MESSAGE);
  }

  const conversation = await findConversationByIdAndTenant(conversationId, auth.tenantId);
  const scope = visibleWhatsAppPhoneNumberId(auth);
  if (!conversation || (scope && String(conversation.whatsappPhoneNumberId) !== scope)) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  const session = await findActiveSessionForConversation(conversationId, auth.tenantId);
  if (!session) {
    throw ApiError.badRequest(
      'GUEST_LINK_INACTIVE',
      'This conversation has no active web chat link, so there is no web window to deliver to',
    );
  }

  // A block is the customer's decision, so it binds this side too. Storing
  // the message anyway and letting the socket carry it would mean the
  // window either shows it — making the block a lie — or silently drops
  // it, leaving the agent believing they answered someone who never heard
  // them. Refusing here is the only version that is true on both screens.
  if (session.blockedAt) {
    throw ApiError.conflict(
      'GUEST_BLOCKED',
      'This customer has blocked the web chat, so a message cannot be delivered to it.',
    );
  }

  const phoneNumber = await findPhoneNumberByIdAndTenant(
    String(conversation.whatsappPhoneNumberId),
    auth.tenantId,
  );

  const message = await createMessage({
    tenantId: auth.tenantId,
    conversationId,
    senderId: auth.userId,
    recipientPhone: phoneNumber?.displayPhoneNumber?.trim() || String(conversation.whatsappPhoneNumberId),
    direction: 'OUT',
    channel: 'web',
    type: 'text',
    text,
    // SENT, not QUEUED: there is no gateway to wait on. It reaches the
    // web window over the socket in the same tick.
    status: 'SENT',
  });

  const updated = await recordOutboundActivity(
    conversationId,
    auth.tenantId,
    text,
    new Date(),
    'SENT',
    String(message._id),
  );

  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(
    auth.tenantId,
    toRealtimeMessage(message),
    String(conversation.whatsappPhoneNumberId),
  );
  if (updated) {
    realtime.emitConversationUpdated(auth.tenantId, toRealtimeConversation(updated));
  }

  // The customer's own browser, if it asked to be told. Only on this path:
  // a reply sent through Meta arrives in the customer's WhatsApp, which
  // notifies them already, and pushing here too would buzz their phone
  // twice for one message.
  //
  // Last, and never allowed to fail the request — the message is stored
  // and already on the socket.
  //
  // The title has to be resolved the same way the window header is, or the
  // notification and the page it opens would name two different businesses.
  await pushGuestMessage({
    tenantId: auth.tenantId,
    conversationId,
    businessName: (
      await resolveBusinessNameForConversation(
        auth.tenantId,
        String(conversation.whatsappPhoneNumberId),
      )
    ).name,
    messageType: 'text',
    text,
  });

  return toGuestMessage(message as unknown as MessageLean);
}

/**
 * The customer has the window open, so the business's messages have been
 * seen. Bounded to a page: a thread with thousands of unread outbound
 * messages is a data problem, and rewriting all of them on one poll would
 * be a long blocking write on the hot path.
 */
export async function markBusinessMessagesRead(guest: GuestContext): Promise<{ read: number }> {
  const unread = await Message.find({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    direction: 'OUT',
    status: { $ne: 'READ' },
    deletedAt: { $exists: false },
  })
    .select('_id')
    .sort({ _id: -1 })
    .limit(100)
    .lean();

  if (unread.length === 0) return { read: 0 };

  const ids = unread.map((m) => m._id);
  const readAt = new Date();
  await Message.updateMany({ _id: { $in: ids } }, { $set: { status: 'READ', readAt } });

  const realtime = getRealtimeEmitter();
  for (const id of ids) {
    realtime.emitMessageStatus(
      guest.tenantId,
      guest.conversationId,
      String(id),
      'READ',
      guest.whatsappPhoneNumberId,
    );
  }

  /**
   * And the chat row, which was being left behind.
   *
   * The messages were marked read and the open conversation was told
   * over the socket — but nothing updated lastMessageStatus, so the chat
   * LIST kept showing the grey tick it was given when the message was
   * sent. The customer had read it; every screen said so except the one
   * the agent looks at most.
   *
   * unread is sorted newest first, so its first entry is the newest
   * message just marked read. updateLastMessageStatus only writes when
   * that id is still the conversation's last, which is the guard against
   * a late receipt rewriting a row that has since moved on.
   */
  const newest = String(ids[0]);
  await updateLastMessageStatus(guest.tenantId, newest, 'READ');
  const conversation = await findConversationByIdAndTenant(guest.conversationId, guest.tenantId);
  if (conversation) {
    // conversation:updated is what the agent app's list listens to.
    // message:status only patches the open thread's message cache — the
    // row in the list is a different query and hears nothing from it.
    realtime.emitConversationUpdated(guest.tenantId, toRealtimeConversation(conversation));
  }

  return { read: ids.length };
}


/**
 * The customer deleting one of the messages in their window.
 *
 * 'me' takes it off their screen only; the agent's thread is unchanged,
 * which is the same asymmetry the workspace already has in the other
 * direction. 'everyone' withdraws it from the agent's thread too, and is
 * allowed only on their own messages and only for an hour — see
 * messageRevoke.ts, which holds the whole rule and is shared with the
 * agent-side delete so the two sides cannot drift apart.
 *
 * Not gated on assertGuestNotBlocked: someone who has blocked the chat
 * can still tidy up what they said before they did. Blocking stops new
 * messages, it is not a punishment.
 */
export async function deleteGuestMessage(
  guest: GuestContext,
  messageId: string,
  scope: 'me' | 'everyone',
): Promise<{ id: string; scope: 'me' | 'everyone' }> {
  const [target] = await findMessagesByIds(guest.tenantId, guest.conversationId, [messageId]);
  if (!target) {
    throw ApiError.notFound('MESSAGE_NOT_FOUND', 'That message is no longer here.');
  }

  if (scope === 'me') {
    await hideMessageForGuest(messageId, guest.tenantId, guest.conversationId);
    return { id: messageId, scope };
  }

  const refusal = refusalToRevoke(target, 'customer');
  if (refusal) {
    throw ApiError.badRequest(`REVOKE_${refusal}`, REVOKE_REFUSAL_MESSAGE[refusal]);
  }

  // The same fan-out the agent side uses — tombstone to both audiences,
  // and the chat-list preview rewritten. A second tap that got there
  // first returns false, which is not an error: what was asked for has
  // happened.
  await revokeAndBroadcast(guest.tenantId, guest.conversationId, messageId, 'customer');

  return { id: messageId, scope };
}


/**
 * The business's photo, for the customer holding this link.
 *
 * Takes no id of any kind: the link says which conversation this is, the
 * conversation says which workspace AND which number, and that pair
 * resolves to exactly one photo. A customer therefore cannot ask for
 * anyone else's — which is the same shape every other guest route has,
 * and the reason none of them accept a conversation id either.
 *
 * Which photo is resolveBusinessAvatar's decision: the workspace's if an
 * admin set one, otherwise the profile picture of the person answering
 * this number — the same person whose name the window already shows.
 */
export async function getGuestBusinessAvatar(
  guest: GuestContext,
): Promise<{ data: Buffer; contentType: string }> {
  return getBusinessAvatar(guest.tenantId, guest.whatsappPhoneNumberId);
}
