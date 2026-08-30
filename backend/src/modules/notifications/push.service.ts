import { logger } from '../../lib/logger';
import { getPushGateway } from '../../integrations/fcm';
import {
  listTokensForTenant,
  listTokensForTenantExcludingUser,
  listTokensForUsers,
  deleteTokens,
} from '../devices/deviceToken.repository';
import { findUserIdsWhoCanSeePhoneNumber } from '../users/user.repository';
import type { PushPayload } from '../../integrations/fcm';

/** Matches the channel the Android app creates at startup. If these ever
 *  drift, Android silently drops the notification. */
export const CHAT_CHANNEL_ID = 'voxo-messages';

/**
 * A one-line preview of a message, for the notification body.
 *
 * Media messages have no text, so they get a label rather than an empty
 * notification — a blank body reads as a bug, not as a photo.
 */
export function previewForMessage(type: string, text: string | undefined): string {
  if (type === 'text' && text) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  switch (type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎤 Voice message';
    case 'document':
      return '📄 Document';
    case 'location':
      return '📍 Location';
    case 'contacts':
      return '👤 Contact';
    case 'sticker':
      return 'Sticker';
    default:
      return text || 'New message';
  }
}

/**
 * Sends one push and prunes whatever FCM reports as dead.
 *
 * `whatsappPhoneNumberId` narrows the recipients to the users who may
 * actually see that number's chats. Without it a push carries a
 * colleague's customer name and message text to every phone in the
 * workspace — and a lock screen is the one place that is impossible to
 * take back.
 *
 * Never throws. Every caller is on a path that has already done the real
 * work — the message is stored and has gone out over the socket — so a push
 * failure must not roll any of that back or fail a webhook Meta will then
 * retry.
 */
async function sendToTenant(
  tenantId: string,
  payload: PushPayload,
  opts: { excludeUserId?: string; whatsappPhoneNumberId?: string } = {},
): Promise<void> {
  const gateway = getPushGateway();
  if (!gateway.isConfigured()) return;

  try {
    let devices;
    if (opts.whatsappPhoneNumberId) {
      const audience = await findUserIdsWhoCanSeePhoneNumber(tenantId, opts.whatsappPhoneNumberId);
      const permitted = opts.excludeUserId ? audience.filter((id) => id !== opts.excludeUserId) : audience;
      devices = await listTokensForUsers(tenantId, permitted);
    } else {
      devices = opts.excludeUserId
        ? await listTokensForTenantExcludingUser(tenantId, opts.excludeUserId)
        : await listTokensForTenant(tenantId);
    }
    if (devices.length === 0) return;

    const result = await gateway.send(
      devices.map((d) => d.token),
      payload,
    );

    if (result.invalidTokens.length > 0) {
      await deleteTokens(result.invalidTokens);
      logger.debug({ pruned: result.invalidTokens.length }, 'Pruned dead FCM tokens');
    }
    if (result.failureCount > 0) {
      logger.warn(
        { tenantId, sent: result.successCount, failed: result.failureCount },
        'Some push notifications could not be delivered',
      );
    }
  } catch (err) {
    logger.error({ err, tenantId }, 'Push notification failed — the message itself was unaffected');
  }
}

export interface MessagePushInput {
  tenantId: string;
  conversationId: string;
  /** Which number the chat is on — decides who gets the notification. */
  whatsappPhoneNumberId: string;
  contactName: string;
  messageType: string;
  text?: string;
}

/** A new customer message. Collapsed per conversation so a burst from one
 *  customer is one notification, not ten. */
export async function pushIncomingMessage(input: MessagePushInput): Promise<void> {
  await sendToTenant(input.tenantId, {
    title: input.contactName,
    body: previewForMessage(input.messageType, input.text),
    collapseKey: input.conversationId,
    channelId: CHAT_CHANNEL_ID,
    data: {
      type: 'message',
      conversationId: input.conversationId,
    },
  }, { whatsappPhoneNumberId: input.whatsappPhoneNumberId });
}

export interface ReactionPushInput {
  tenantId: string;
  conversationId: string;
  /** Which number the chat is on — decides who gets the notification. */
  whatsappPhoneNumberId: string;
  contactName: string;
  emoji?: string;
  /** The text of the message that was reacted to, for context. */
  targetPreview?: string;
}

/**
 * A reaction gets its own wording rather than reusing the message copy.
 * "Priya: 👍" is indistinguishable from Priya sending a thumbs-up as a
 * message, which is a different thing and would send an agent looking for
 * a reply that isn't there.
 *
 * Collapse key differs from the message one so a reaction never silently
 * replaces an unread message notification for the same conversation.
 */
export async function pushReaction(input: ReactionPushInput): Promise<void> {
  const target = input.targetPreview
    ? `: "${input.targetPreview.length > 40 ? `${input.targetPreview.slice(0, 39)}…` : input.targetPreview}"`
    : '';
  await sendToTenant(input.tenantId, {
    title: input.contactName,
    body: `Reacted ${input.emoji ?? ''} to your message${target}`.trim(),
    collapseKey: `${input.conversationId}:reaction`,
    channelId: CHAT_CHANNEL_ID,
    data: {
      type: 'reaction',
      conversationId: input.conversationId,
    },
  }, { whatsappPhoneNumberId: input.whatsappPhoneNumberId });
}

export interface CallPushInput {
  tenantId: string;
  /** The teammate who started the handoff — they don't need telling. */
  actorUserId: string;
  actorName: string;
  contactName: string;
  contactId: string;
}

/**
 * A teammate started a WhatsApp call handoff.
 *
 * This is the only call event this app actually has. Meta's Cloud API
 * webhook, as handled here, carries `messages` and `statuses` only — there
 * is no inbound-call event to notify anyone about, and the call itself
 * happens inside WhatsApp where nothing reports back. So this notifies the
 * REST of the team that a customer is being called, which is real and
 * useful in a shared inbox (two agents calling the same customer is the
 * problem it prevents) — it is not, and is not labelled as, an incoming
 * call.
 */
export async function pushCallStarted(input: CallPushInput): Promise<void> {
  await sendToTenant(
    input.tenantId,
    {
      title: 'Call started',
      body: `${input.actorName} is calling ${input.contactName} on WhatsApp`,
      collapseKey: `call:${input.contactId}`,
      channelId: CHAT_CHANNEL_ID,
      data: {
        type: 'call',
        contactId: input.contactId,
      },
    },
    { excludeUserId: input.actorUserId },
  );
}
