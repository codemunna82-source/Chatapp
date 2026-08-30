import { ApiError } from '../../lib/ApiError';
import { findConversationByIdAndTenant, isWithinCustomerServiceWindow, recordOutboundActivity } from '../conversations/conversation.repository';
import { findContactByIdAndTenant } from '../contacts/contact.repository';
import {
  createMessage,
  findMessageByIdAndTenant,
  attachMetaMessageId,
  markMessageFailed,
  softDeleteMessage,
  setMessageStarred,
} from './message.repository';
import { findMediaByIdAndTenant } from '../media/media.repository';
import { resolveMetaCredentialsForPhoneNumber } from '../whatsapp/whatsapp.service';
import { getMetaGateway, toMetaApiError, type SendableMediaType } from '../../integrations/meta';
import { mockMetaGateway } from '../../integrations/meta/mock/mockMetaGateway';
import { getRealtimeEmitter } from '../../realtime/events';
import { toRealtimeMessage, toRealtimeConversation } from '../../realtime/serializers';
import type { MessageDoc } from './message.model';

/**
 * Message types this service can actually dispatch through the Meta
 * gateway today. Deliberately narrower than the full Message.type enum
 * (which also covers inbound-only/receive-side types like location,
 * contacts, sticker) — spec §20 forbids claiming unsupported
 * functionality, so anything outside this list is rejected explicitly
 * rather than silently mishandled. `reaction` IS included: Meta's Cloud
 * API genuinely supports sending one (spec §51 — Meta's docs win).
 */
export type SendableMessageType = 'text' | 'template' | 'reaction' | SendableMediaType;

export interface SendOutboundMessageInput {
  tenantId: string;
  conversationId: string;
  senderId: string;
  type: SendableMessageType;
  text?: string;
  mediaId?: string; // our Media._id — must already be uploaded to Meta (has metaMediaId)
  mediaLink?: string; // alternative to mediaId: a public HTTPS URL
  caption?: string;
  filename?: string;
  templateName?: string;
  languageCode?: string;
  templateComponents?: unknown[];
  replyToMessageId?: string; // our Message._id — quotes another message when sending text/media
  reactToMessageId?: string; // our Message._id — the target of a `type: 'reaction'` send
  emoji?: string; // '' removes a previously-sent reaction (real, documented Meta behavior)
}

/**
 * Full outbound send flow (spec §17): tenant/permission checks happen at
 * the route layer before this is called; this function owns the 24-hour
 * customer-service-window check (§18), the Meta API call with idempotency-
 * safe status tracking, and persisting the result. Route wiring (POST
 * /api/conversations/:id/messages) lands in Phase 5 — this is the service
 * that route will call.
 */
/**
 * Hides a message from this workspace's inbox ("delete for me").
 *
 * Deliberately has no delete-for-everyone counterpart: Meta's WhatsApp
 * Cloud API exposes no delete or recall endpoint, so a message that has
 * already been delivered cannot be withdrawn from the customer's WhatsApp.
 * Offering that would remove it here while leaving it visible to them.
 */
export async function deleteMessageForTenant(
  tenantId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const message = await findMessageByIdAndTenant(messageId, tenantId);
  if (!message || String(message.conversationId) !== conversationId) {
    throw ApiError.notFound('MESSAGE_NOT_FOUND', 'That message does not exist.');
  }
  await softDeleteMessage(messageId, tenantId);
}

/**
 * Stars or unstars a message. Workspace-wide by design (see the model's
 * starredAt note) — the conversation check is what scopes it, exactly as
 * with delete, so a message id from another chat cannot be starred through
 * this conversation's route.
 */
export async function setMessageStarredForTenant(
  tenantId: string,
  conversationId: string,
  messageId: string,
  starred: boolean,
): Promise<MessageDoc> {
  const message = await findMessageByIdAndTenant(messageId, tenantId);
  if (!message || String(message.conversationId) !== conversationId) {
    throw ApiError.notFound('MESSAGE_NOT_FOUND', 'That message does not exist.');
  }
  const updated = await setMessageStarred(messageId, tenantId, starred);
  if (!updated) {
    throw ApiError.notFound('MESSAGE_NOT_FOUND', 'That message does not exist.');
  }
  return updated;
}

export async function sendOutboundMessage(input: SendOutboundMessageInput): Promise<MessageDoc> {
  const conversation = await findConversationByIdAndTenant(input.conversationId, input.tenantId);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  const contact = await findContactByIdAndTenant(String(conversation.contactId), input.tenantId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }

  // A demo contact is a local sandbox: the number is not on WhatsApp, so
  // neither the window rule nor a real send means anything on it. Both are
  // bypassed together on purpose — bypassing only the window would leave a
  // composer that opens and then fails at Meta instead, which is worse than
  // the template prompt it replaced. See contact.model.ts.
  const isDemoContact = contact.isDemo === true;

  // Server-side 24h window enforcement — never trust an Android countdown.
  if (!isDemoContact && input.type !== 'template' && !isWithinCustomerServiceWindow(conversation)) {
    throw new ApiError(
      422,
      'MESSAGE_TEMPLATE_REQUIRED',
      'An approved WhatsApp template is required.',
    );
  }

  let replyToMetaMessageId: string | undefined;
  if (input.replyToMessageId) {
    const replyTarget = await findMessageByIdAndTenant(input.replyToMessageId, input.tenantId);
    replyToMetaMessageId = replyTarget?.metaMessageId ?? undefined;
  }

  // Our own row is created before calling Meta (status QUEUED) so a
  // mid-flight crash never loses the attempt — see markMessageFailed below.
  // A reaction's row links to its target via replyToMessageId (same field
  // a reply uses) — see realtime/serializers.ts / the mobile client for how
  // that's read back to attach the reaction badge to the right bubble.
  const localMessage = await createMessage({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    senderId: input.senderId,
    recipientPhone: contact.phone,
    direction: 'OUT',
    type: input.type,
    text:
      input.type === 'reaction'
        ? input.emoji
        : input.type === 'template'
          ? `Template: ${input.templateName}`
          : input.text,
    mediaId: input.mediaId,
    replyToMessageId: input.type === 'reaction' ? input.reactToMessageId : input.replyToMessageId,
    status: 'QUEUED',
  });

  try {
    const credentials = await resolveMetaCredentialsForPhoneNumber(
      input.tenantId,
      String(conversation.whatsappPhoneNumberId),
    );
    // Demo sends never leave this server, whatever META_MOCK_MODE is set to.
    const gateway = isDemoContact ? mockMetaGateway : getMetaGateway();

    const metaMessageId = await dispatch(gateway, credentials, contact.phone, input, replyToMetaMessageId);

    const sentMessage = await attachMetaMessageId(String(localMessage._id), input.tenantId, metaMessageId);
    const updatedConversation = await recordOutboundActivity(
      input.conversationId,
      input.tenantId,
      input.text ?? input.caption ?? `[${input.type}]`,
      new Date(),
      // SENT, matching the message row attachMetaMessageId just wrote — a
      // status webhook advances both from here.
      'SENT',
      String(localMessage._id),
    );

    const realtime = getRealtimeEmitter();
    realtime.emitMessageNew(
      input.tenantId,
      toRealtimeMessage(sentMessage ?? localMessage),
      String(conversation.whatsappPhoneNumberId),
    );
    if (updatedConversation) {
      realtime.emitConversationUpdated(input.tenantId, toRealtimeConversation(updatedConversation));
    }

    return sentMessage ?? localMessage;
  } catch (err) {
    const serialized = err instanceof Error ? { name: err.name, message: err.message } : err;
    await markMessageFailed(String(localMessage._id), input.tenantId, serialized);
    if (err instanceof ApiError) throw err;
    throw toMetaApiError(err);
  }
}

async function dispatch(
  gateway: ReturnType<typeof getMetaGateway>,
  credentials: Awaited<ReturnType<typeof resolveMetaCredentialsForPhoneNumber>>,
  toPhone: string,
  input: SendOutboundMessageInput,
  replyToMetaMessageId: string | undefined,
): Promise<string> {
  switch (input.type) {
    case 'text': {
      if (!input.text) throw ApiError.badRequest('TEXT_REQUIRED', 'text is required for a text message');
      const result = await gateway.sendText(credentials, { to: toPhone, text: input.text, replyToMetaMessageId });
      return result.metaMessageId;
    }
    case 'template': {
      if (!input.templateName || !input.languageCode) {
        throw ApiError.badRequest('TEMPLATE_REQUIRED', 'templateName and languageCode are required');
      }
      const result = await gateway.sendTemplate(credentials, {
        to: toPhone,
        templateName: input.templateName,
        languageCode: input.languageCode,
        components: input.templateComponents as never,
      });
      return result.metaMessageId;
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'document': {
      if (!input.mediaId && !input.mediaLink) {
        throw ApiError.badRequest('MEDIA_REQUIRED', 'mediaId or mediaLink is required');
      }
      let metaMediaId: string | undefined;
      if (input.mediaId) {
        const mediaDoc = await findMediaByIdAndTenant(input.mediaId, input.tenantId);
        if (!mediaDoc?.metaMediaId) {
          throw ApiError.badRequest('MEDIA_NOT_UPLOADED', 'This media has not finished uploading to Meta yet');
        }
        metaMediaId = mediaDoc.metaMediaId;
      }
      const result = await gateway.sendMedia(credentials, {
        to: toPhone,
        mediaType: input.type,
        mediaId: metaMediaId,
        link: input.mediaLink,
        caption: input.caption,
        filename: input.filename,
        replyToMetaMessageId,
      });
      return result.metaMessageId;
    }
    case 'reaction': {
      if (!input.reactToMessageId || input.emoji === undefined) {
        throw ApiError.badRequest('REACTION_REQUIRED', 'reactToMessageId and emoji are required');
      }
      const target = await findMessageByIdAndTenant(input.reactToMessageId, input.tenantId);
      if (!target?.metaMessageId) {
        throw ApiError.badRequest(
          'REACTION_TARGET_NOT_SENT',
          'Cannot react to a message that has not been delivered by Meta yet',
        );
      }
      const result = await gateway.sendReaction(credentials, {
        to: toPhone,
        reactToMetaMessageId: target.metaMessageId,
        emoji: input.emoji,
      });
      return result.metaMessageId;
    }
    default:
      throw ApiError.badRequest('UNSUPPORTED_MESSAGE_TYPE', `Cannot send message type "${input.type as string}"`);
  }
}
