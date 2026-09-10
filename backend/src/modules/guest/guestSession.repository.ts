import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { GuestSession, type GuestSessionDoc } from './guestSession.model';

/**
 * 32 bytes of CSPRNG output, base64url-encoded so it survives being a path
 * segment in a link that goes through WhatsApp's own URL handling without
 * any escaping.
 */
export function generateGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreateGuestSessionInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  createdByUserId?: string;
  expiresAt: Date;
}

/** Returns the persisted session together with the one-time plaintext token. */
export async function createGuestSession(
  input: CreateGuestSessionInput,
): Promise<{ session: GuestSessionDoc; token: string }> {
  const token = generateGuestToken();
  const session = await GuestSession.create({ ...input, tokenHash: hashGuestToken(token) });
  return { session, token };
}

/**
 * The live session for a conversation, if there is one.
 *
 * Re-sending "Open private chat" should hand back the link the customer
 * may already be holding: their WhatsApp thread keeps every copy that was
 * ever sent, and minting a fresh token each time would turn all the older
 * ones into dead links they are just as likely to tap.
 */
export async function findActiveSessionForConversation(
  conversationId: string,
  tenantId: string,
): Promise<GuestSessionDoc | null> {
  if (!Types.ObjectId.isValid(conversationId)) return null;
  return GuestSession.findOne({
    conversationId,
    tenantId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });
}

/**
 * Resolves a presented token. Returns null for unknown, revoked and
 * expired alike — a caller that could tell those apart would let anyone
 * probe which tokens once existed.
 */
export async function findSessionByToken(token: string): Promise<GuestSessionDoc | null> {
  if (!token) return null;
  return GuestSession.findOne({
    tokenHash: hashGuestToken(token),
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
}

/**
 * Fire-and-forget: the customer's activity timestamp is worth having but
 * never worth failing their request over, and it would otherwise add a
 * write to every poll and every reconnect.
 */
export function touchSession(sessionId: string): void {
  void GuestSession.updateOne({ _id: sessionId }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
}

/**
 * The customer blocking, or unblocking, the business from their window.
 *
 * Scoped to the one session rather than the conversation: the block is a
 * property of this link, and a link the agent later reissues is a fresh
 * decision the customer has not made yet.
 */
export async function setSessionBlocked(sessionId: string, blocked: boolean): Promise<Date | null> {
  if (!Types.ObjectId.isValid(sessionId)) return null;
  const blockedAt = blocked ? new Date() : null;
  await GuestSession.updateOne(
    { _id: sessionId },
    blocked ? { $set: { blockedAt } } : { $unset: { blockedAt: '' } },
  );
  return blockedAt;
}

/**
 * Whether this session is blocked, read fresh.
 *
 * A socket resolves its guest context once, at connect, and then holds it
 * for as long as the tab is open — so a block set five minutes into a
 * session is invisible to every handler on that socket. HTTP has no such
 * problem, because the token is re-resolved per request. This is the query
 * that closes the gap for the socket, and it exists rather than trusting
 * the window to disconnect itself: a block enforced only by the client
 * that asked for it is not enforced.
 */
export async function isSessionBlocked(sessionId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId)) return false;
  const session = await GuestSession.findById(sessionId).select('blockedAt').lean();
  return Boolean(session?.blockedAt);
}

/**
 * Whether the customer has blocked the live link for a conversation.
 *
 * Read by the agent's side before it writes into the web window, so a
 * reply cannot be stored into a chat the customer has closed off.
 */
export async function isConversationBlockedByGuest(
  conversationId: string,
  tenantId: string,
): Promise<boolean> {
  const session = await findActiveSessionForConversation(conversationId, tenantId);
  return Boolean(session?.blockedAt);
}

/** Revokes every live link for a conversation. Returns how many were closed. */
export async function revokeSessionsForConversation(conversationId: string, tenantId: string): Promise<number> {
  if (!Types.ObjectId.isValid(conversationId)) return 0;
  const result = await GuestSession.updateMany(
    { conversationId, tenantId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount;
}
