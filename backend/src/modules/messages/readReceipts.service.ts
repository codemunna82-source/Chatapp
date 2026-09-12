import { logger } from '../../lib/logger';
import { getMetaGateway } from '../../integrations/meta';
import { mockMetaGateway } from '../../integrations/meta/mock/mockMetaGateway';
import { resolveMetaCredentialsForPhoneNumber } from '../whatsapp/whatsapp.service';
import { markInboundMessagesRead } from './message.repository';
import { getRealtimeEmitter } from '../../realtime/events';

/**
 * What happens when an agent opens a chat.
 *
 * Opening a conversation used to do exactly one thing: zero its unread
 * count. The customer was told nothing. Their message sat on a single
 * grey tick in the private window and on a single tick in WhatsApp, for
 * a message someone had just read — so "did they even see it?" had no
 * answer on either screen.
 *
 * Three things now follow from the same act, because they are the same
 * fact stated to three audiences:
 *   - the messages are marked READ, so a reload agrees with the socket;
 *   - message:status goes to the conversation room, which the customer's
 *     web window is in, so their ticks turn immediately;
 *   - Meta is told, so a customer reading in WhatsApp sees it there too.
 *
 * Never throws. This runs behind "open the chat", and a Graph hiccup must
 * not turn opening a conversation into an error.
 */
export async function markInboundReadAndNotify(input: {
  tenantId: string;
  conversationId: string;
  whatsappPhoneNumberId: string;
  /** Demo chats never reach Meta; see contact.model.ts. */
  isDemo?: boolean;
}): Promise<{ read: number }> {
  const { ids, latestMetaMessageId } = await markInboundMessagesRead(
    input.tenantId,
    input.conversationId,
  );
  if (ids.length === 0) return { read: 0 };

  // First, and synchronously: this is the half the customer sees in the
  // private window, and it costs nothing but a socket emit.
  const realtime = getRealtimeEmitter();
  for (const id of ids) {
    realtime.emitMessageStatus(
      input.tenantId,
      input.conversationId,
      id,
      'READ',
      input.whatsappPhoneNumberId,
    );
  }

  // Then Meta, for the customer reading in WhatsApp instead. Deliberately
  // not awaited by the caller's critical path and never allowed to throw:
  // the messages are already READ here, and failing to tell Meta is worth
  // a log line, not a failed request to open a chat.
  if (latestMetaMessageId) {
    void sendMetaReadReceipt({ ...input, metaMessageId: latestMetaMessageId });
  }

  return { read: ids.length };
}

async function sendMetaReadReceipt(input: {
  tenantId: string;
  whatsappPhoneNumberId: string;
  metaMessageId: string;
  isDemo?: boolean;
}): Promise<void> {
  try {
    const credentials = await resolveMetaCredentialsForPhoneNumber(
      input.tenantId,
      input.whatsappPhoneNumberId,
    );
    const gateway = input.isDemo ? mockMetaGateway : getMetaGateway();
    await gateway.markAsRead(credentials, input.metaMessageId);
  } catch (err) {
    logger.warn(
      { err, metaMessageId: input.metaMessageId },
      'Could not send a read receipt to Meta',
    );
  }
}
