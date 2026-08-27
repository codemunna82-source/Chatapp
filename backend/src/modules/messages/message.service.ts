import { ApiError } from '../../lib/ApiError';
import { findConversationByIdAndTenant, isWithinCustomerServiceWindow, recordOutboundActivity } from '../conversations/conversation.repository';
import { findContactByIdAndTenant } from '../contacts/contact.repository';
import { createMessage, findMessageByIdAndTenant, attachMetaMessageId, markMessageFailed } from './message.repository';
import { findMediaByIdAndTenant } from '../media/media.repository';
import { resolveMetaCredentialsForPhoneNumber } from '../whatsapp/whatsapp.service';
import { getMetaGateway, toMetaApiError, type SendableMediaType } from '../../integrations/meta';
import { getRealtimeEmitter } from '../../realtime/events';
import type { MessageDoc } from './message.model';

/**
 * Message types this service can actually dispatch through the Meta
 * gateway today. Deliberately narrower than the full Message.type enum
 * (which also covers inbound-only/receive-side types like location,
 * contacts, reaction, sticker) — spec §20 forbids claiming unsupported
 * functionality, so anything outside this list is rejected explicitly
 * rather than silently mishandled.
 */
export type SendableMessageType = 'text' | 'template' | SendableMediaType;

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
  replyToMessageId?: string; // our Message._id
}

/**
 * Full outbound send flow (spec §17): tenant/permission checks happen at
 * the route layer before this is called; this function owns the 24-hour
 * customer-service-window check (§18), the Meta API call with idempotency-
 * safe status tracking, and persisting the result. Route wiring (POST
 * /api/conversations/:id/messages) lands in Phase 5 — this is the service
 * that route will call.
 */
export async function sendOutboundMessage(input: SendOutboundMessageInput): Promise<MessageDoc> {
  const conversation = await findConversationByIdAndTenant(input.conversationId, input.tenantId);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  const contact = await findContactByIdAndTenant(String(conversation.contactId), input.tenantId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }

  // Server-side 24h window enforcement — never trust an Android countdown.
  if (input.type !== 'template' && !isWithinCustomerServiceWindow(conversation)) {
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
  const localMessage = await createMessage({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    senderId: input.senderId,
    recipientPhone: contact.phone,
    direction: 'OUT',
    type: input.type,
    text: input.text,
    mediaId: input.mediaId,
    replyToMessageId: input.replyToMessageId,
    status: 'QUEUED',
  });

  try {
    const credentials = await resolveMetaCredentialsForPhoneNumber(
      input.tenantId,
      String(conversation.whatsappPhoneNumberId),
    );
    const gateway = getMetaGateway();

    const metaMessageId = await dispatch(gateway, credentials, contact.phone, input, replyToMetaMessageId);

    const sentMessage = await attachMetaMessageId(String(localMessage._id), input.tenantId, metaMessageId);
    await recordOutboundActivity(
      input.conversationId,
      input.tenantId,
      input.text ?? input.caption ?? `[${input.type}]`,
    );

    const realtime = getRealtimeEmitter();
    realtime.emitMessageNew(input.tenantId, input.conversationId, String(localMessage._id));
    realtime.emitConversationUpdated(input.tenantId, input.conversationId);

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
    default:
      throw ApiError.badRequest('UNSUPPORTED_MESSAGE_TYPE', `Cannot send message type "${input.type as string}"`);
  }
}
