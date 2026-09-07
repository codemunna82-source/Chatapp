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

/** Revokes every live link for a conversation. Returns how many were closed. */
export async function revokeSessionsForConversation(conversationId: string, tenantId: string): Promise<number> {
  if (!Types.ObjectId.isValid(conversationId)) return 0;
  const result = await GuestSession.updateMany(
    { conversationId, tenantId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount;
}
