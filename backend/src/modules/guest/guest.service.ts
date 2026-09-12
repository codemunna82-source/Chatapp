import { env } from '../../config/env';
import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../types/express';
import { Tenant } from '../tenants/tenant.model';
import { findContactByIdAndTenant, findOrCreateContactByPhone } from '../contacts/contact.repository';
import { normalizePhone } from '../../lib/phone';
import type { GuestMediaKind } from './guestMedia.service';
import { findPhoneNumberByIdAndTenant } from '../whatsapp/whatsapp.repository';
import {
  findConversationByIdAndTenant,
  findOrCreateConversation,
  recordGuestInboundActivity,
  recordOutboundActivity,
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
} from '../messages/message.repository';
import { Message, type MessageLean } from '../messages/message.model';
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
import { resolveBusinessName } from './businessName';

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
    /** One line: the text, or a bracketed type for a photo or a recording. */
    preview: string;
  };
  /** Emoji reactions on this message, most-used first. */
  reactions?: { emoji: string; mine: boolean }[];
  /** Present on `type: 'location'` — what the map pin should be drawn at. */
  location?: { latitude: number; longitude: number; name?: string; address?: string };
}

/**
 * The stored row carries tenantId, senderId, Meta's message id and raw
 * send errors. None of that is the customer's to see, so the guest views
 * are built field by field rather than by deleting keys off the document —
 * a field added to Message later then has to be opted in, instead of
 * leaking the moment it lands.
 */
function toGuestMessage(doc: MessageLean): GuestMessageView {
  const view: GuestMessageView = {
    id: String(doc._id),
    from: doc.direction === 'IN' ? 'me' : 'business',
    type: doc.type,
    text: doc.text ?? undefined,
    hasMedia: Boolean(doc.mediaId),
    mediaId: doc.mediaId ? String(doc.mediaId) : undefined,
    createdAt: doc.createdAt.toISOString(),
  };
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

/** One line standing in for a message inside a quote. */
function previewOf(doc: MessageLean): string {
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
      view.replyTo = {
        id: String(quoted._id),
        from: quoted.direction === 'IN' ? 'me' : 'business',
        preview: previewOf(quoted),
      };
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
  if (!env.GUEST_LINK_BASE_URL) {
    throw ApiError.serviceUnavailable(
      'GUEST_LINK_NOT_CONFIGURED',
      'GUEST_LINK_BASE_URL is not set on the server, so a chat link cannot be built yet',
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

  const expiresAt = new Date(Date.now() + env.GUEST_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { token } = await createGuestSession({
    tenantId: auth.tenantId,
    conversationId,
    contactId: String(conversation.contactId),
    whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
    createdByUserId: auth.userId,
    expiresAt,
  });

  return {
    url: `${env.GUEST_LINK_BASE_URL}/c/${token}`,
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

  // findOrCreate is keyed on (tenant, contact), so an existing chat comes
  // back on whatever number it was created with — possibly a colleague's.
  // Issuing a link for it would be a way to read a conversation this agent
  // is not allowed to see.
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
    openedByCustomer: Boolean(session.activatedAt) && !session.blockedAt,
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
  const [tenant, contact, phoneNumber] = await Promise.all([
    Tenant.findById(guest.tenantId).select('name displayName').lean(),
    findContactByIdAndTenant(guest.contactId, guest.tenantId),
    findPhoneNumberByIdAndTenant(guest.whatsappPhoneNumberId, guest.tenantId),
  ]);

  // APPROVED is the only value that means "Meta reviewed this and accepted
  // it". PENDING_REVIEW and DECLINED are both "not verified", and treating
  // a pending review as a pass would put the badge up during exactly the
  // window in which Meta has not decided.
  const verifiedByWhatsApp = phoneNumber?.nameStatus === 'APPROVED';

  return {
    conversationId: guest.conversationId,
    businessName: resolveBusinessName({
      displayName: tenant?.displayName,
      verifiedName: phoneNumber?.verifiedName,
      tenantName: tenant?.name,
    }).name,
    contactName: contact?.name ?? undefined,
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

  const [conversation, phoneNumber, contact] = await Promise.all([
    findConversationByIdAndTenant(guest.conversationId, guest.tenantId),
    findPhoneNumberByIdAndTenant(guest.whatsappPhoneNumberId, guest.tenantId),
    findContactByIdAndTenant(guest.contactId, guest.tenantId),
  ]);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'This conversation no longer exists');
  }

  // The quoted message must be one from this conversation. The id comes
  // from a client that is otherwise trusted only for its own token, and a
  // reply pointing at someone else's message would put a line of their
  // thread on this customer's screen.
  const quoted = await resolveQuotedMessage(guest, replyToMessageId);

  const message = await createMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    // Delivered by definition: it was written straight into our own
    // database, with no gateway in between that could still drop it.
    recipientPhone: phoneNumber?.displayPhoneNumber ?? '',
    direction: 'IN',
    type: 'text',
    text,
    replyToMessageId: quoted ? String(quoted._id) : undefined,
    status: 'DELIVERED',
  });

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
    await postWelcomeMessage(guest);
  }

  const updated = await recordGuestInboundActivity(guest.conversationId, guest.tenantId, text);

  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(guest.tenantId, toRealtimeMessage(message), guest.whatsappPhoneNumberId);
  if (updated) {
    realtime.emitConversationUpdated(guest.tenantId, toRealtimeConversation(updated));
  }

  // Last, and never allowed to fail the request: the message is already
  // stored and already on every open agent app over the socket.
  await pushIncomingMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
    contactName: contact?.name || contact?.phone || 'Web chat',
    messageType: 'text',
    text,
  });

  const view = toGuestMessage(message as unknown as MessageLean);
  if (quoted) {
    view.replyTo = {
      id: String(quoted._id),
      from: quoted.direction === 'IN' ? 'me' : 'business',
      preview: previewOf(quoted),
    };
  }
  return view;
}

/**
 * The greeting the business shows a customer who has just arrived.
 *
 * Written into the conversation as a real outbound message rather than
 * rendered as a banner in the window, so the agent sees exactly what the
 * customer was told. A greeting only one side can see is a greeting the
 * agent then repeats.
 *
 * Stored directly rather than going through sendOutboundMessage: this is
 * a message in the WEB window, and sending it would push it to WhatsApp
 * as well — the customer would get welcomed twice, once in each place,
 * for having moved to one of them.
 *
 * Never throws. It runs on the customer's first message, and losing that
 * message because a greeting failed would be a poor trade.
 */
async function postWelcomeMessage(guest: GuestContext): Promise<void> {
  try {
    const tenant = await Tenant.findById(guest.tenantId).select('autoGuestLink').lean();
    const text = tenant?.autoGuestLink?.welcomeMessage?.trim();
    if (!text) return;

    const message = await createMessage({
      tenantId: guest.tenantId,
      conversationId: guest.conversationId,
      // No senderId: nobody wrote this. Stamping an agent's id would put
      // their name on a greeting they never typed.
      recipientPhone: '',
      direction: 'OUT',
      type: 'text',
      text,
      status: 'DELIVERED',
    });

    // One emit covers both sides: the guest socket and the agents' sockets
    // are all in this conversation's room, which is how every other
    // business message reaches the window too.
    getRealtimeEmitter().emitMessageNew(
      guest.tenantId,
      toRealtimeMessage(message),
      guest.whatsappPhoneNumberId,
    );
  } catch (err) {
    logger.warn(
      { err, conversationId: guest.conversationId },
      'Could not post the welcome message — the customer\'s own message is unaffected',
    );
  }
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
    // Nothing is emitted for a removal. There is no message-deleted event
    // anywhere in this system — the agent app picks the change up on its
    // next fetch — and inventing a half-wired one for this single case
    // would leave a second way for messages to vanish that only reactions
    // ever use.
    return { messageId, emoji: null };
  }

  const phoneNumber = await findPhoneNumberByIdAndTenant(guest.whatsappPhoneNumberId, guest.tenantId);
  const row = await upsertGuestReaction({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    targetMessageId: messageId,
    recipientPhone: phoneNumber?.displayPhoneNumber ?? '',
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
    recipientPhone: phoneNumber?.displayPhoneNumber ?? '',
    direction: 'IN',
    type: kind,
    mediaId,
    status: 'DELIVERED',
  });

  // The chat list has one line per conversation and can show neither a
  // picture nor a recording, so it gets the same placeholder the WhatsApp
  // ingestion path uses for the same message types.
  const updated = await recordGuestInboundActivity(
    guest.conversationId,
    guest.tenantId,
    kind === 'image' ? '[image]' : '[voice message]',
  );

  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(guest.tenantId, toRealtimeMessage(message), guest.whatsappPhoneNumberId);
  if (updated) {
    realtime.emitConversationUpdated(guest.tenantId, toRealtimeConversation(updated));
  }

  await pushIncomingMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
    contactName: contact?.name || contact?.phone || 'Web chat',
    messageType: kind,
  });

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
    recipientPhone: phoneNumber?.displayPhoneNumber ?? '',
    direction: 'IN',
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

  const updated = await recordGuestInboundActivity(guest.conversationId, guest.tenantId, text);

  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(guest.tenantId, toRealtimeMessage(message), guest.whatsappPhoneNumberId);
  if (updated) {
    realtime.emitConversationUpdated(guest.tenantId, toRealtimeConversation(updated));
  }

  await pushIncomingMessage({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
    contactName: contact?.name || contact?.phone || 'Web chat',
    messageType: 'location',
    text,
  });

  const view = toGuestMessage(message as unknown as MessageLean);
  if (quoted) {
    view.replyTo = {
      id: String(quoted._id),
      from: quoted.direction === 'IN' ? 'me' : 'business',
      preview: previewOf(quoted),
    };
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
    recipientPhone: phoneNumber?.displayPhoneNumber ?? '',
    direction: 'OUT',
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
  const tenant = await Tenant.findById(auth.tenantId).select('name displayName').lean();
  await pushGuestMessage({
    tenantId: auth.tenantId,
    conversationId,
    businessName: resolveBusinessName({
      displayName: tenant?.displayName,
      verifiedName: phoneNumber?.verifiedName,
      tenantName: tenant?.name,
    }).name,
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

  return { read: ids.length };
}
