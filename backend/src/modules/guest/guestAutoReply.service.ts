import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { Tenant, renderAutoGuestLinkMessage } from '../tenants/tenant.model';
import { sendOutboundMessage } from '../messages/message.service';
import { createGuestSession, findActiveSessionForConversation } from './guestSession.repository';

/**
 * Hands a customer the private-chat link the moment they message in.
 *
 * The manual path — an agent taps a button, a link is minted, the OS share
 * sheet opens — needs a person to be awake and looking. A customer who
 * writes "hi" at 2am gets nothing until someone notices. This closes that
 * gap without changing what the agent's button does.
 *
 * Four rules decide whether anything is sent, and each one exists because
 * the alternative is worse:
 *
 * 1. Off unless the workspace turned it on. See Tenant.autoGuestLink.
 * 2. Never when a live link already exists. This is the important one:
 *    without it every single inbound message gets the invitation again,
 *    which is what a customer experiences as spam and what makes a
 *    business look broken. One link per conversation, until it expires or
 *    an agent revokes it.
 * 3. Never for a reaction. A thumbs-up on an old message is not somebody
 *    opening a conversation, and answering it with an invitation reads as
 *    a machine that is not listening.
 * 4. Never throw. This runs inside the webhook handler; an exception here
 *    would fail the delivery, Meta would retry it, and the customer's
 *    message would be processed twice. A failed auto-reply must cost the
 *    auto-reply and nothing else.
 */
export async function maybeSendGuestLinkAutoReply(input: {
  tenantId: string;
  conversationId: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  inboundMessageType: string;
}): Promise<void> {
  try {
    if (input.inboundMessageType === 'reaction') return;
    if (!env.GUEST_LINK_BASE_URL) return;

    const tenant = await Tenant.findById(input.tenantId).select('autoGuestLink').lean();
    if (!tenant?.autoGuestLink?.enabled) return;

    // Checked immediately before minting, not cached from earlier in the
    // request: two messages arriving together would otherwise both pass a
    // stale check and send two invitations.
    const existing = await findActiveSessionForConversation(input.conversationId, input.tenantId);
    if (existing) return;

    const expiresAt = new Date(Date.now() + env.GUEST_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const { token } = await createGuestSession({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      expiresAt,
    });

    const url = `${env.GUEST_LINK_BASE_URL}/c/${token}`;
    const text = renderAutoGuestLinkMessage(tenant.autoGuestLink.message ?? undefined, url);

    // No senderId: nobody sent this. Recording a human's id would put an
    // agent's name on a message they did not write, and the agent app
    // reads that field to decide whose bubble it is.
    await sendOutboundMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: 'text',
      text,
    });

    logger.info(
      { tenantId: input.tenantId, conversationId: input.conversationId },
      'Sent the private-chat link automatically in reply to an inbound message',
    );
  } catch (err) {
    logger.warn(
      { err, tenantId: input.tenantId, conversationId: input.conversationId },
      'Could not send the automatic private-chat link — the inbound message itself is unaffected',
    );
  }
}
