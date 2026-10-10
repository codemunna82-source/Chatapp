import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { findMediaByIdAndTenant } from '../media/media.repository';
import { resolveMetaCredentialsForPhoneNumber, type ResolvedMetaCredentials } from '../whatsapp/whatsapp.service';
import { markConnectionExpired } from '../whatsapp/embeddedSignup.service';
import { getMetaGateway, toMetaApiError, MetaApiError } from '../../integrations/meta';
import { mockMetaGateway } from '../../integrations/meta/mock/mockMetaGateway';
import { getRealtimeEmitter } from '../../realtime/events';
import { type PerfTrace } from '../../lib/perfTrace';
import { toRealtimeMessage, toRealtimeConversation } from '../../realtime/serializers';
import type { MessageDoc } from './message.model';
import { attachMetaMessageId, markMessageFailed, findMessageByIdAndTenant } from './message.repository';
import { recordOutboundActivity } from '../conversations/conversation.repository';
import { toWhatsAppId } from '../../lib/phone';
import type { ConversationDoc } from '../conversations/conversation.model';
import type { ContactDoc } from '../contacts/contact.model';
import type { SendOutboundMessageInput } from './message.service';

/**
 * The actual Graph API call, and nothing else — picking the right gateway
 * method per message type and translating this app's input into Meta's
 * shape. Shared by the synchronous send path and the paced dispatch queue
 * (outboundDispatch.queue.ts), which is the whole reason this lives in
 * its own module rather than inside message.service.ts: a queue worker
 * reconstructing a send from a job payload needs the exact same call a
 * live HTTP request makes, not a second copy that can quietly drift from
 * the first.
 */
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
    case 'location': {
      if (!input.location) {
        throw ApiError.badRequest('LOCATION_REQUIRED', 'latitude and longitude are required');
      }
      const result = await gateway.sendLocation(credentials, {
        to: toPhone,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        name: input.location.name,
        address: input.location.address,
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

/**
 * Calls Meta for an already-created QUEUED message row, and finalizes it
 * either way — attaches the real id and emits on success, marks it
 * FAILED and classifies the error on refusal.
 *
 * Called from two places: inline, synchronously, when sendOutboundMessage
 * finds the number has pacing room right now; and from the dispatch
 * queue's worker, when it didn't and this runs later instead. Either
 * caller gets the identical Meta call and the identical bookkeeping —
 * there is exactly one version of "what actually sending looks like."
 *
 * Throws on failure (the same ApiError/MetaApiError shapes
 * sendOutboundMessage always threw) — the synchronous caller lets that
 * propagate to the HTTP response as before; the queue worker catches it
 * itself, because by then there is no request left to answer.
 */
export async function dispatchAndFinalize(
  localMessage: MessageDoc,
  input: SendOutboundMessageInput,
  conversation: ConversationDoc,
  contact: ContactDoc,
  isDemoContact: boolean,
  replyToMetaMessageId: string | undefined,
  perf: PerfTrace,
): Promise<MessageDoc> {
  // Declared outside the try so the catch can name the connection that
  // failed; it is still undefined if resolution itself threw.
  let credentialsUsed: ResolvedMetaCredentials | undefined;

  try {
    const credentials = await resolveMetaCredentialsForPhoneNumber(
      input.tenantId,
      String(conversation.whatsappPhoneNumberId),
    );
    credentialsUsed = credentials;
    // Demo sends never leave this server, whatever META_MOCK_MODE is set to.
    const gateway = isDemoContact ? mockMetaGateway : getMetaGateway();

    // Digits without the plus — the form Meta's own webhook uses for this
    // customer. Contacts are stored canonically (+E.164), so sending the
    // stored string verbatim would put a `+` on the wire for every contact
    // once the duplicate merge has canonicalised them.
    const metaMessageId = await dispatch(
      gateway,
      credentials,
      toWhatsAppId(contact.phone),
      input,
      replyToMetaMessageId,
    );
    // The Meta round trip, which is why the WhatsApp path can never be as
    // quick as the web one: this is a call to someone else's servers, and
    // the message does not exist for them until it returns.
    perf.mark('meta_dispatch');

    const sentMessage = await attachMetaMessageId(String(localMessage._id), input.tenantId, metaMessageId);

    const realtime = getRealtimeEmitter();
    /**
     * The chat row and the socket both skip a system message.
     *
     * Hiding the bubble but leaving the invitation as the row's "last
     * message" — and pushing it live into an open thread — would show the
     * agent the very thing the bubble was hidden to spare them, in two
     * more places. The conversation's own timestamps are unaffected
     * either way; what is skipped is the preview text and the push.
     */
    if (!input.internal) {
      // Before the conversation row is touched, not after. Nobody is
      // waiting on a preview string; the people on this thread are
      // waiting on the message, and putting a write in front of the emit
      // held it back by a full round trip for no one's benefit.
      realtime.emitMessageNew(
        input.tenantId,
        toRealtimeMessage(sentMessage ?? localMessage),
        String(conversation.whatsappPhoneNumberId),
      );
      // SOCKET_EMIT_RECEIVER. The receiver's device has the message from
      // here; everything below is bookkeeping, and the trace ends now so
      // the total is the number that matters.
      perf.mark('emit');
      perf.end({ messageId: String(localMessage._id), channel: 'whatsapp' });

      const updatedConversation = await recordOutboundActivity(
        input.conversationId,
        input.tenantId,
        input.text ?? input.caption ?? `[${input.type}]`,
        new Date(),
        // SENT, matching the message row attachMetaMessageId just wrote
        // — a status webhook advances both from here.
        'SENT',
        String(localMessage._id),
      );
      if (updatedConversation) {
        realtime.emitConversationUpdated(input.tenantId, toRealtimeConversation(updatedConversation));
      }
    }

    return sentMessage ?? localMessage;
  } catch (err) {
    const serialized = err instanceof Error ? { name: err.name, message: err.message } : err;
    await markMessageFailed(String(localMessage._id), input.tenantId, serialized);

    // The one line that says WHICH number/account the refusal was on and
    // WHY, in Meta's own code — the thing the dashboard's "Rate limit
    // hit" row never does (it names the WABA, not the number, and not a
    // reason). Without this, a synchronous refusal (as opposed to the
    // delayed 130429 on the status webhook, which handleStatusUpdate
    // already logs with its own detail) left only `markMessageFailed`'s
    // name+message on a row nobody tails in real time.
    logger.warn(
      {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        messageId: String(localMessage._id),
        phoneNumberId: String(conversation.whatsappPhoneNumberId),
        messageType: input.type,
        ...(err instanceof MetaApiError
          ? {
              code: err.code,
              metaCode: err.metaCode,
              metaSubcode: err.metaSubcode,
              retryable: err.retryable,
              fbtraceId: err.fbtraceId,
            }
          : { errorName: err instanceof Error ? err.name : typeof err }),
      },
      'Meta refused a WhatsApp send',
    );

    // Meta rejected the credentials — an expired or revoked token. Recorded
    // on the connection so the app can say "reconnect your WhatsApp"
    // instead of showing a failed message with no explanation, on this
    // send and every one after it.
    if (err instanceof MetaApiError && err.code === 'META_AUTH_ERROR' && credentialsUsed) {
      await markConnectionExpired(credentialsUsed.whatsappAccountId);
      throw ApiError.badRequest(
        'WHATSAPP_RECONNECT_REQUIRED',
        'Your WhatsApp connection has expired. Open Settings → Connect WhatsApp and connect again.',
      );
    }

    if (err instanceof ApiError) throw err;
    throw toMetaApiError(err);
  }
}
