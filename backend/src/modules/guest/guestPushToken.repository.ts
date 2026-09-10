import { Types } from 'mongoose';
import { GuestPushToken, type GuestPushTokenLean } from './guestPushToken.model';

export interface RegisterGuestPushInput {
  tenantId: string;
  conversationId: string;
  guestSessionId: string;
  token: string;
}

/**
 * Records this browser's push token, or re-points one already recorded.
 *
 * An upsert on the token rather than an insert: browsers hand back the
 * same registration token every time until it rotates, so a customer who
 * opens the chat forty times would otherwise leave forty identical rows
 * and get forty copies of every notification.
 */
export async function registerGuestPushToken(input: RegisterGuestPushInput): Promise<void> {
  await GuestPushToken.updateOne(
    { token: input.token },
    {
      $set: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        guestSessionId: input.guestSessionId,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function deleteGuestPushTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await GuestPushToken.deleteMany({ token: { $in: tokens } });
}

/** Every browser still listening to this conversation. */
export async function listGuestPushTokens(
  tenantId: string,
  conversationId: string,
): Promise<GuestPushTokenLean[]> {
  if (!Types.ObjectId.isValid(conversationId)) return [];
  return GuestPushToken.find({ tenantId, conversationId }).lean<GuestPushTokenLean[]>();
}

/**
 * Drops every token for a conversation.
 *
 * Called when the agent revokes the link. A notification for a chat the
 * customer can no longer open is the worst kind — it names the business on
 * their lock screen and leads to a dead page.
 */
export async function deleteGuestPushTokensForConversation(
  tenantId: string,
  conversationId: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(conversationId)) return;
  await GuestPushToken.deleteMany({ tenantId, conversationId });
}

/**
 * Drops every token registered against a session.
 *
 * Called when the link is revoked or the customer blocks: a notification
 * for a chat they can no longer open, or have deliberately shut off, is
 * the worst kind — it names the business on their lock screen and leads
 * nowhere.
 */
export async function deleteGuestPushTokensForSessions(guestSessionIds: string[]): Promise<void> {
  const ids = guestSessionIds.filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return;
  await GuestPushToken.deleteMany({ guestSessionId: { $in: ids } });
}
