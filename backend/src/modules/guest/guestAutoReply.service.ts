import { logger } from '../../lib/logger';
import { ApiError } from '../../lib/ApiError';
import {
  Tenant,
  AUTO_GUEST_LINK_BUTTON_INDEX,
  renderAutoGuestLinkText,
} from '../tenants/tenant.model';
import { sendOutboundMessage } from '../messages/message.service';
import { setAwaitingWebChat } from '../conversations/conversation.repository';
import { guestSessionExpiresAt } from './guestSessionExpiry';
import { findContactByIdAndTenant } from '../contacts/contact.repository';
import {
  createGuestSession,
  findActiveSessionForConversation,
  reissueGuestSessionToken,
  recordInviteSent,
} from './guestSession.repository';
import { guestChatUrl } from '../tenants/guestDomain';
import { guestLinkBaseUrlFor } from '../tenants/guestDomain.service';
import { findPhoneNumberByIdAndTenant } from '../whatsapp/whatsapp.repository';
import { WhatsAppAccount } from '../whatsapp/whatsappAccount.model';
import { tryReserveAutomaticSendSlot } from '../whatsapp/outboundPacing';
import { enqueueAutomaticInviteDispatch } from '../../queues/automaticInviteDispatch.queue';

/** The invitation config's own shape, independent of which slot it came from. */
interface AutoGuestLinkConfig {
  enabled?: boolean;
  mode?: 'text' | 'template';
  message?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  bodyVariable?: 'none' | 'customer_name';
  maxSends?: number;
  holdWhatsAppUntilOpened?: boolean;
  welcomeMessage?: string | null;
}

/**
 * Which invitation config applies to a send on THIS number.
 *
 * A template lives on one Business Manager's WhatsApp Business Account —
 * Meta rejects a send naming a template approved on a different one
 * (#132001) — while `Tenant.autoGuestLink` used to be the only config
 * there was, one setting for every number in the workspace regardless of
 * which Business Manager it answers on. A workspace running two Business
 * Managers had every number past the first silently sending nothing.
 *
 * `Tenant.autoGuestLinkByApp` is the fix: a config per Business Manager,
 * keyed by MetaApp id. This resolves which one applies — the number's own
 * Business Manager's config if an admin has set one up, the tenant-wide
 * default otherwise. That fallback is what keeps every workspace that has
 * never opened the per-Business-Manager picker working exactly as before:
 * a number with no entry in the map behaves as if the map did not exist.
 */
async function resolveAutoGuestLinkConfig(
  tenantId: string,
  whatsappPhoneNumberId: string,
): Promise<AutoGuestLinkConfig | undefined> {
  const tenant = await Tenant.findById(tenantId).select('autoGuestLink autoGuestLinkByApp').lean();
  if (!tenant) return undefined;

  const phoneNumber = await findPhoneNumberByIdAndTenant(whatsappPhoneNumberId, tenantId);
  const account = phoneNumber
    ? await WhatsAppAccount.findById(phoneNumber.whatsappAccountId).select('metaAppId').lean()
    : null;
  const metaAppId = account?.metaAppId ? String(account.metaAppId) : null;

  // `.lean()` turns a Mongoose Map field into a plain object at runtime —
  // there is no `.get()` to call — while its inferred TS type still says
  // Map, because that mismatch is how mongoose's lean() typing works. Cast
  // to what is actually there rather than fight the type.
  const byApp = tenant.autoGuestLinkByApp as unknown as
    | Record<string, AutoGuestLinkConfig>
    | undefined;
  const perApp = metaAppId ? byApp?.[metaAppId] : undefined;
  return perApp ?? tenant.autoGuestLink;
}

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
export type InvitationSentVia = 'text' | 'template' | 'text-after-template-failed';

export interface InvitationResult {
  /** What actually went out, which is not always what was configured. */
  sentVia: InvitationSentVia;
  /** Which invitation this was for this customer, counting from 1. */
  attempt: number;
}

interface InvitationTarget {
  tenantId: string;
  conversationId: string;
  contactId: string;
  whatsappPhoneNumberId: string;
}

/**
 * Sends the private-chat invitation, once.
 *
 * Two callers with the same body and opposite temperaments. The automatic
 * one fires on every inbound message and must be quiet and cautious: off
 * unless the workspace turned it on, never past the cap, and never
 * throwing, because it runs inside the webhook handler. The manual one is
 * an agent who has decided, looking at the chat, that this customer needs
 * the link now — so it ignores the cap and the on/off switch, and it says
 * out loud when it cannot do what was asked.
 *
 * `null` means a gate stopped it and that is not an error; every real
 * problem throws.
 */
async function deliverGuestLinkInvitation(
  input: InvitationTarget,
  opts: { trigger: 'auto' | 'manual'; onRateLimited?: () => void },
): Promise<InvitationResult | null> {
  const auto = opts.trigger === 'auto';

  const linkBaseUrl = await guestLinkBaseUrlFor(input.tenantId);
  if (!linkBaseUrl) {
    if (auto) return null;
    throw ApiError.badRequest(
      'GUEST_LINK_NOT_CONFIGURED',
      'This workspace has no private-chat web address set up yet.',
    );
  }

  // Resolved per this number's Business Manager, not the tenant's single
  // default — see resolveAutoGuestLinkConfig for why a template config
  // has to be scoped that narrowly.
  const config = await resolveAutoGuestLinkConfig(input.tenantId, input.whatsappPhoneNumberId);

  // The on/off switch governs the AUTOMATIC reply only. An agent tapping
  // "send the invitation" has made the decision that switch exists to
  // make, so turning the automatic one off should not take the manual one
  // away with it.
  if (auto && !config?.enabled) return null;

  const mode = config?.mode ?? 'text';

  // Template mode with no template is configured-but-unusable. On the
  // automatic path it used to be SILENT, which made "the admin has not
  // finished configuring it" and "the new code is not deployed" look
  // identical in the logs — hours apart to diagnose. An agent who asked
  // for it by hand gets told to their face instead.
  if (mode === 'template' && (!config?.templateName || !config?.templateLanguage)) {
    if (!auto) {
      throw ApiError.badRequest(
        'INVITATION_TEMPLATE_NOT_SET',
        'The invitation is set to send an approved template, but no template is named. Set one on the admin page.',
      );
    }
    logger.warn(
      {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        hasTemplateName: Boolean(config?.templateName),
        hasTemplateLanguage: Boolean(config?.templateLanguage),
      },
      'Automatic chat invitation is set to template mode but names no approved template, so nothing was sent',
    );
    return null;
  }

  // Read immediately before minting, not cached from earlier in the
  // request: two messages arriving together would otherwise both pass a
  // stale check and send two invitations.
  const existing = await findActiveSessionForConversation(input.conversationId, input.tenantId);
  const maxSends = config?.maxSends ?? 1;

  // The one rule the manual path keeps. A customer sitting in the private
  // chat does not need to be invited to it, and an invitation arriving on
  // WhatsApp mid-sentence reads as a business that is not paying
  // attention — which is as true when an agent sends it as when a machine
  // does.
  if (existing?.activatedAt) {
    if (auto) return null;
    throw ApiError.badRequest(
      'ALREADY_IN_PRIVATE_CHAT',
      'This customer is already in the private chat — they do not need the link.',
    );
  }

  if (auto && !shouldSendInvite(existing, maxSends)) return null;

  // Paced, not gated by config — see outboundPacing.ts for why this one
  // send is what absorbs a throughput spike instead of every send on the
  // number. A customer turned away here is not lost: onRateLimited tells
  // the caller to hold them in automaticInviteDispatch.queue.ts and try
  // again once the window has room, rather than giving up on this attempt
  // for good.
  if (auto && !(await tryReserveAutomaticSendSlot(input.whatsappPhoneNumberId))) {
    logger.info(
      { tenantId: input.tenantId, conversationId: input.conversationId, whatsappPhoneNumberId: input.whatsappPhoneNumberId },
      'Deferring the automatic private-chat invitation — too many automatic sends on this number in the last minute',
    );
    opts.onRateLimited?.();
    return null;
  }

  // Re-send on the SAME link rather than minting a new one. Their
  // WhatsApp thread keeps every copy ever sent, and a fresh token would
  // turn the earlier ones into dead links they are just as likely to
  // tap — which is worse than not re-sending at all.
  let token: string;
  if (existing) {
    const reissued = await reissueGuestSessionToken(String(existing._id), input.tenantId);
    if (!reissued) {
      if (auto) return null;
      throw ApiError.badRequest('GUEST_LINK_UNAVAILABLE', 'Could not prepare a link for this customer.');
    }
    token = reissued;
  } else {
    const expiresAt = guestSessionExpiresAt();
    const created = await createGuestSession({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      expiresAt,
    });
    token = created.token;
  }

  const url = guestChatUrl(linkBaseUrl, token);
  let sentVia: InvitationSentVia = mode;

  // No senderId on either path: nobody sent this. Recording a human's id
  // would put an agent's name on a message they did not write, and the
  // agent app reads that field to decide whose bubble it is.
  if (mode === 'text') {
    // Free-form, which Meta allows because this fires in direct response
    // to the customer's own message — the 24-hour window is open by
    // definition at this exact moment. That is what lets the default work
    // with no approved template and no waiting on a review.
    await sendOutboundMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: 'text',
      text: renderAutoGuestLinkText(config?.message ?? undefined, url),
      // Kept out of the agent's thread. It is addressed to the customer
      // and carries their own link; an agent gained nothing from a bubble
      // full of a URL they cannot use, sitting between the customer's
      // message and their reply. It still went out on WhatsApp, still
      // counts against the nudge budget, and is still in the record.
      internal: true,
      // This wording is the admin's own (Automatic replies), carries the
      // actual link, and must not be swapped for a configured nudge's
      // text — see the field's doc comment in message.service.ts.
      exemptFromNudgeWording: true,
    });
  } else {
    // Resolved before building so the builder itself stays pure and
    // testable — the component shape is what Meta rejects a send on.
    let customerName: string | null = null;
    if (config?.bodyVariable === 'customer_name') {
      const contact = await findContactByIdAndTenant(input.contactId, input.tenantId);
      customerName = contact?.name?.trim() || null;
    }
    const components = buildAutoGuestLinkComponents(customerName, token, config?.bodyVariable ?? 'none');

    try {
      await sendOutboundMessage({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        type: 'template',
        templateName: config?.templateName ?? undefined,
        languageCode: config?.templateLanguage ?? undefined,
        templateComponents: components,
        internal: true,
        exemptFromNudgeWording: true,
      });
    } catch (templateErr) {
      // A template belongs to a WhatsApp Business Account, not to this
      // workspace — while this setting is one per workspace. A workspace
      // running two numbers on two Business Managers has two WABAs, and a
      // template approved on one simply does not exist on the other: Meta
      // answers (#132001) and the customer gets NOTHING. The same happens
      // for a language code that does not match the approved copy, or a
      // template still in review.
      //
      // So the invitation falls back to text rather than to silence.
      // Free-form is allowed here for the reason the text mode relies on —
      // this follows the customer's own message, so the 24-hour window is
      // open. The link is the same one the template would have carried, on
      // the same token; it arrives as a bare URL instead of a tappable
      // button, which is worse than the template and far better than
      // nothing.
      //
      // Logged at warn with the name and language, because the fix is an
      // admin's: create and submit this template on THAT number's WhatsApp
      // Business Account too.
      logger.warn(
        {
          err: templateErr,
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          whatsappPhoneNumberId: input.whatsappPhoneNumberId,
          template: config?.templateName,
          language: config?.templateLanguage,
        },
        "The approved template could not be sent on this number — sending the invitation as plain text instead. Check the template exists, in this language, on this number's WhatsApp Business Account.",
      );

      await sendOutboundMessage({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        type: 'text',
        text: renderAutoGuestLinkText(config?.message ?? undefined, url),
        internal: true,
        exemptFromNudgeWording: true,
      });
      sentVia = 'text-after-template-failed';
    }
  }

  const attempt = (existing?.invitesSent ?? 0) + 1;
  await recordInviteSent(input.conversationId, input.tenantId);

  // Held from here, not from the customer's first message: the hold only
  // makes sense once they have actually been given somewhere else to go.
  // Setting it before the invitation is out would silence a customer who
  // has not been told anything yet.
  if (config?.holdWhatsAppUntilOpened) {
    await setAwaitingWebChat(input.conversationId, input.tenantId, true);
  }

  logger.info(
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      trigger: opts.trigger,
      mode,
      sentVia,
      template: config?.templateName,
      attempt,
      maxSends,
    },
    'Sent the private-chat invitation',
  );

  return { sentVia, attempt };
}

/**
 * One attempt at the automatic invitation, pacing gate included.
 *
 * 'rate-limited' means outboundPacing.ts's cap was the ONLY reason
 * nothing went out — the one outcome worth retrying. 'done' covers
 * everything else: sent, or skipped for a reason a retry cannot fix
 * (the automatic reply is off, the customer is already in the private
 * chat, this customer is already at its own invite cap, no template is
 * configured). Exported so automaticInviteDispatch.queue.ts can re-run
 * the exact same attempt later rather than a second copy of these gates.
 */
export async function attemptAutomaticGuestLinkInvitation(input: InvitationTarget): Promise<'rate-limited' | 'done'> {
  let rateLimited = false;
  await deliverGuestLinkInvitation(input, {
    trigger: 'auto',
    onRateLimited: () => {
      rateLimited = true;
    },
  });
  return rateLimited ? 'rate-limited' : 'done';
}

export async function maybeSendGuestLinkAutoReply(input: {
  tenantId: string;
  conversationId: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  inboundMessageType: string;
}): Promise<void> {
  try {
    // A thumbs-up on an old message is not somebody opening a
    // conversation, and answering it with an invitation reads as a machine
    // that is not listening.
    if (input.inboundMessageType === 'reaction') return;

    const outcome = await attemptAutomaticGuestLinkInvitation(input);
    if (outcome === 'rate-limited') {
      await enqueueAutomaticInviteDispatch({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      });
    }
  } catch (err) {
    // Never throw. This runs inside the webhook handler; an exception here
    // would fail the delivery, Meta would retry it, and the customer's
    // message would be processed twice. A failed auto-reply must cost the
    // auto-reply and nothing else.
    logger.warn(
      { err, tenantId: input.tenantId, conversationId: input.conversationId },
      'Could not send the automatic private-chat invitation at all — the inbound message itself is unaffected',
    );
  }
}

/**
 * Recovers an invitation Meta accepted and then refused, by sending the
 * same link as plain text.
 *
 * `deliverGuestLinkInvitation`'s own template-mode fallback only catches a
 * SYNCHRONOUS rejection — Meta saying no on the request itself, which is
 * what a missing or unapproved template looks like. A rate limit or a
 * quality cap is not that: Meta answers the send with a 200 and a message
 * id, and only refuses minutes later over the status webhook, by which
 * point `deliverGuestLinkInvitation` has already returned and counted the
 * send as done. This is that second fallback, called from the webhook
 * handler once such a refusal is known.
 *
 * Re-sent on the SAME session's link, the same way a manual re-invite
 * reuses it — a fresh token would turn the copy Meta just refused into a
 * dead link sitting in the thread next to a live one.
 *
 * Never throws: this already runs inside a webhook handler that must not
 * fail the delivery it is reacting to. `false` covers every way there was
 * nothing left to recover with — no guest-link address configured, no
 * session (the original attempt never got far enough to mint one), the
 * session already activated — and the caller decides what a failed
 * recovery means for the invite count.
 */
export async function sendInvitationTextFallback(input: {
  tenantId: string;
  conversationId: string;
  whatsappPhoneNumberId: string;
}): Promise<boolean> {
  try {
    const linkBaseUrl = await guestLinkBaseUrlFor(input.tenantId);
    if (!linkBaseUrl) return false;

    const existing = await findActiveSessionForConversation(input.conversationId, input.tenantId);
    // No session, or the customer has since activated it themselves —
    // either way there is nothing this should be re-sending.
    if (!existing || existing.activatedAt) return false;

    const token = await reissueGuestSessionToken(String(existing._id), input.tenantId);
    if (!token) return false;

    const config = await resolveAutoGuestLinkConfig(input.tenantId, input.whatsappPhoneNumberId);
    const url = guestChatUrl(linkBaseUrl, token);

    await sendOutboundMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: 'text',
      text: renderAutoGuestLinkText(config?.message ?? undefined, url),
      internal: true,
      exemptFromNudgeWording: true,
    });
    return true;
  } catch (err) {
    logger.warn(
      { err, tenantId: input.tenantId, conversationId: input.conversationId },
      'Could not recover a refused template invitation by sending it as text either',
    );
    return false;
  }
}

/**
 * The same invitation, sent because an agent asked for it.
 *
 * The automatic reply is the normal path and it fails in ways nobody in
 * the app can see or fix: Meta accepts a template and declines to deliver
 * it minutes later, the cap is spent on an invitation that never arrived,
 * the customer wrote in before the workspace had finished configuring
 * anything. Each leaves an agent looking at a chat where the customer was
 * never given the link — and, until now, nothing to do about it.
 *
 * So this ignores the cap and the on/off switch: an agent looking at the
 * conversation is a better judge of whether this customer needs the link
 * than a counter is. It still counts the send, so the record of how many
 * times this customer has been asked stays true.
 */
export async function sendGuestLinkInvitationNow(
  input: InvitationTarget,
): Promise<InvitationResult> {
  const result = await deliverGuestLinkInvitation(input, { trigger: 'manual' });
  if (!result) {
    // Every gate that stops the manual path throws its own reason above,
    // so reaching here means one was added without one.
    throw ApiError.badRequest('INVITATION_NOT_SENT', 'The invitation could not be sent.');
  }
  return result;
}

/**
 * Whether this customer should be sent the invitation now.
 *
 * Two rules, and each exists against a specific failure:
 *
 * - Already in the window → never. An invitation arriving on WhatsApp
 *   while they are mid-sentence in the chat reads as a business that is
 *   not paying attention.
 * - At the cap → never. "More than once" is useful; "every time" is spam
 *   from a business they were trying to talk to.
 *
 * A missing invitesSent counts as zero rather than as "already sent":
 * sessions created before the field existed have no value for it, and
 * reading that as sent would silence every one of them.
 *
 * Exported for its test — neither mistake throws, and both are invisible
 * from the agent's side.
 */
export function shouldSendInvite(
  session: { invitesSent?: number | null; activatedAt?: Date | null } | null,
  maxSends: number,
): boolean {
  if (!session) return true;
  if (session.activatedAt) return false;
  return (session.invitesSent ?? 0) < maxSends;
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
