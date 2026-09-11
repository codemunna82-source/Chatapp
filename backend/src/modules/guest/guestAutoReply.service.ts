import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { Tenant, AUTO_GUEST_LINK_BUTTON_INDEX } from '../tenants/tenant.model';
import { sendOutboundMessage } from '../messages/message.service';
import { findContactByIdAndTenant } from '../contacts/contact.repository';
import { createGuestSession, findActiveSessionForConversation } from './guestSession.repository';

/**
 * Hands a customer the private-chat link the moment they message in.
 *
 * The manual path — an agent taps a button, a link is minted, the OS share
 * sheet opens — needs a person to be awake and looking. A customer who
 * writes "hi" at 2am gets nothing until somebody notices. This closes that
 * gap without changing what the agent's button does.
 *
 * Sent as an approved WhatsApp template, never as text composed here. Meta
 * renders a template's URL button as a real tappable control with the
 * address behind a label, which is what makes a stranger willing to tap
 * it; free-form text can only carry a bare link. It also keeps the wording
 * in WhatsApp Manager where Meta has reviewed it.
 *
 * Four rules decide whether anything is sent, and each exists because the
 * alternative is worse:
 *
 * 1. Off unless the workspace turned it on, with a template named. See
 *    Tenant.autoGuestLink.
 * 2. Never when a live link already exists. This is the important one:
 *    without it every inbound message gets the invitation again, which is
 *    what a customer experiences as spam and what makes a business look
 *    broken. One link per conversation, until it expires or an agent
 *    revokes it.
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
    const config = tenant?.autoGuestLink;
    if (!config?.enabled || !config.templateName || !config.templateLanguage) return;

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

    // Resolved before building so the builder itself stays pure and
    // testable — the component shape is what Meta rejects a send on.
    let customerName: string | null = null;
    if (config.bodyVariable === 'customer_name') {
      const contact = await findContactByIdAndTenant(input.contactId, input.tenantId);
      customerName = contact?.name?.trim() || null;
    }
    const components = buildAutoGuestLinkComponents(customerName, token, config.bodyVariable);

    // No senderId: nobody sent this. Recording a human's id would put an
    // agent's name on a message they did not write, and the agent app
    // reads that field to decide whose bubble it is.
    await sendOutboundMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: 'template',
      templateName: config.templateName,
      languageCode: config.templateLanguage,
      templateComponents: components,
    });

    logger.info(
      { tenantId: input.tenantId, conversationId: input.conversationId, template: config.templateName },
      'Sent the private-chat invitation template in reply to an inbound message',
    );
  } catch (err) {
    logger.warn(
      { err, tenantId: input.tenantId, conversationId: input.conversationId },
      'Could not send the automatic private-chat invitation — the inbound message itself is unaffected',
    );
  }
}

/**
 * The template's variable slots, filled.
 *
 * Only the TOKEN goes into the button, not the whole URL: Meta lets a
 * template's URL vary only in a suffix appended to the fixed address saved
 * with the template, so the template must be created with
 * `https://your-app/c/{{1}}` and this supplies the `{{1}}`. Sending a full
 * URL here would produce `https://your-app/c/https://your-app/c/<token>`.
 *
 * Exported for its test. Meta rejects a send outright when the components
 * do not match the approved template — a body parameter sent to a template
 * with no variables fails exactly as hard as a missing one — and that
 * rejection lands inside the webhook handler where nobody sees it.
 */
export function buildAutoGuestLinkComponents(
  customerName: string | null,
  token: string,
  bodyVariable: 'none' | 'customer_name',
): unknown[] {
  const components: unknown[] = [];

  if (bodyVariable === 'customer_name') {
    // Never empty: Meta rejects a blank parameter, and an unnamed contact
    // is ordinary — most customers message before they are ever named.
    components.push({
      type: 'body',
      parameters: [{ type: 'text', text: customerName || 'there' }],
    });
  }

  components.push({
    type: 'button',
    sub_type: 'url',
    index: AUTO_GUEST_LINK_BUTTON_INDEX,
    parameters: [{ type: 'text', text: token }],
  });

  return components;
}
