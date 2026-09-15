import { logger } from '../../lib/logger';
import { getPushGateway } from '../../integrations/fcm';
import {
  listTokensForTenant,
  listTokensForTenantExcludingUser,
  listTokensForUsers,
  deleteTokens,
} from '../devices/deviceToken.repository';
import { findUserIdsWhoCanSeePhoneNumber } from '../users/user.repository';
import type { PushPayload, SendResult } from '../../integrations/fcm';

/** Matches the channel the Android app creates at startup. If these ever
 *  drift, Android silently drops the notification. */
export const CHAT_CHANNEL_ID = 'voxo-messages';

/**
 * The ringing-call channel, created by the app alongside the chat one.
 *
 * Its own channel because an Android channel's sound and importance are
 * fixed at creation — a call and a message sharing one can never sound
 * different, whatever this payload says. The app gives this one the
 * ringtone, MAX importance and a phone-like vibration; naming it here is
 * what routes a call to it.
 *
 * Same warning as above, and it bites harder: a channelId the device does
 * not have is dropped SILENTLY, and for a call that means a customer
 * ringing a phone that never makes a sound.
 */
export const CALL_CHANNEL_ID = 'voxo-calls';

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
  opts: {
    excludeUserId?: string;
    whatsappPhoneNumberId?: string;
    /**
     * Send on each device's OWN channel rather than the payload's.
     *
     * For ringing calls, where the channel is how the ringtone is chosen
     * — see DeviceToken.callChannelId. Devices are grouped by channel and
     * one send goes out per group, because a single FCM message carries a
     * single channel id and two phones may want different sounds.
     *
     * The payload's channelId is the fallback for anything with none
     * stored: iOS, the web, and Android builds older than the picker,
     * all of which already have that channel.
     */
    perDeviceCallChannel?: boolean;
  } = {},
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

    /**
     * One send per distinct channel, not one per device.
     *
     * In practice a workspace's phones nearly all sit on the default, so
     * this is usually a single group and a single send — the grouping
     * exists so that the one agent who picked "Marimba" gets Marimba,
     * without costing everyone else a separate request.
     */
    const groups = new Map<string | undefined, string[]>();
    for (const device of devices) {
      const channelId = opts.perDeviceCallChannel
        ? (device.callChannelId ?? payload.channelId)
        : payload.channelId;
      const bucket = groups.get(channelId);
      if (bucket) bucket.push(device.token);
      else groups.set(channelId, [device.token]);
    }

    const result: SendResult = { invalidTokens: [], successCount: 0, failureCount: 0 };
    for (const [channelId, tokens] of groups) {
      const sent = await gateway.send(tokens, {
        ...payload,
        channelId,
        // Also in `data`, because a call is sent data-only: with no
        // notification block there is no android.notification.channelId
        // for FCM to carry, and the app is the one drawing the
        // notification now. This is how the ringtone the agent picked
        // reaches the notification they actually hear.
        data: channelId ? { ...payload.data, channelId } : payload.data,
      });
      result.invalidTokens.push(...sent.invalidTokens);
      result.successCount += sent.successCount;
      result.failureCount += sent.failureCount;
    }

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

export interface IncomingCallPushInput {
  tenantId: string;
  whatsappPhoneNumberId: string;
  contactId: string;
  contactName: string;
  callId: string;
  /** Audio today. Carried so the notification can say which, and so the
   *  day video lands nothing about this payload has to change. */
  callType?: 'audio' | 'video';
  /**
   * Where the call came from. A call from the web chat window is not a
   * WhatsApp call and must not say it is — the agent decides whether to
   * pick up partly on what the notification claims, and the two behave
   * differently once answered.
   */
  channel?: 'whatsapp' | 'web';
}

/**
 * A ringing call.
 *
 * Unlike every other push here, this one is time-critical: the caller is
 * waiting, and a notification that arrives after they hang up is worse
 * than none. It carries `type: 'incoming_call'` so the app can put a full
 * call screen up rather than a notification the agent has to notice and
 * tap.
 *
 * Addressed by number like the chat pushes, so a call ringing on one
 * agent's line does not light up the whole workspace's phones.
 */
export async function pushIncomingCall(input: IncomingCallPushInput): Promise<void> {
  await sendToTenant(
    input.tenantId,
    {
      title: input.contactName,
      body: input.channel === 'web' ? 'Incoming call from the chat window' : 'Incoming WhatsApp call',
      // Not collapsed with the chat key: a call must never replace, or be
      // replaced by, a message notification from the same contact.
      collapseKey: `incoming-call:${input.callId}`,
      // The ringing channel, not the chat one — see CALL_CHANNEL_ID.
      channelId: CALL_CHANNEL_ID,
      /**
       * No notification block, so the APP draws this one.
       *
       * Android cannot put Accept and Reject on a notification it drew
       * itself — the system tray owns it and the app's code never runs.
       * The buttons are the whole point of a call notification, so the
       * message goes as data and the app builds it. See PushPayload for
       * what that costs.
       */
      dataOnly: true,
      data: {
        type: 'incoming_call',
        callId: input.callId,
        contactId: input.contactId,
        callerName: input.contactName,
        callType: input.callType ?? 'audio',
        // Which signalling path answers it — the app picks a completely
        // different answer routine for each.
        channel: input.channel ?? 'whatsapp',
        // Milliseconds, as a string: FCM rejects non-string data values.
        // The app drops a ring that arrived after it was already over.
        ringingSince: String(Date.now()),
      },
    },
    { whatsappPhoneNumberId: input.whatsappPhoneNumberId, perDeviceCallChannel: true },
  );
}

export interface CallCancelledPushInput {
  tenantId: string;
  whatsappPhoneNumberId: string;
  callId: string;
}

/**
 * Take the ring back.
 *
 * Sent when a call stops being answerable — the caller hung up, it timed
 * out, or another of this agent's devices picked it up. Without it a
 * phone keeps ringing at a call that no longer exists, and the agent
 * answers into silence.
 *
 * Data-only and carrying nothing but the id: there is no notification to
 * show here, only one to remove, and the app matches it by callId.
 *
 * Deliberately unaddressed by user: EVERY device that may have been rung
 * has to be told, including the one that just answered — it cancels its
 * own notification and keeps the call.
 */
export async function pushCallCancelled(input: CallCancelledPushInput): Promise<void> {
  await sendToTenant(
    input.tenantId,
    {
      title: '',
      body: '',
      collapseKey: `incoming-call:${input.callId}`,
      dataOnly: true,
      data: { type: 'call_cancelled', callId: input.callId },
    },
    { whatsappPhoneNumberId: input.whatsappPhoneNumberId },
  );
}
