import { storage } from './mmkv';

const STORAGE_KEY = 'voxo.invitationSmsTemplate';

/**
 * What "Send invitation via SMS" (ConversationDetailScreen's smsGuestLink)
 * sends by default — the wording before an agent ever customizes it.
 * Matches the existing WhatsApp nudge wording so an invitation sent by
 * SMS reads like the same business, not a different product. No {name}
 * or {link} placeholder in the body on purpose — {link} is still filled
 * in by buildInvitationSmsText, which appends it on its own line below
 * since this template never mentions it.
 */
export const DEFAULT_INVITATION_SMS_TEMPLATE =
  '🙏 नमस्कार! पूरी जानकारी, संबंधित फोटो और लोकेशन के लिए नीचे दिए गए लिंक के माध्यम से संपर्क करें।\n\n📩 आपकी आगे की बातचीत इसी चैट पर की जाएगी।\n\n🔗 अभी मैसेज करने के लिए नीचे दिए गए लिंक पर क्लिक करें।';

/** Local-only, same as every other SMS-wording preference in this app — see smsSendTracker.ts. */
export function getInvitationSmsTemplate(): string {
  return storage.getString(STORAGE_KEY) ?? DEFAULT_INVITATION_SMS_TEMPLATE;
}

export function setInvitationSmsTemplate(template: string): void {
  const trimmed = template.trim();
  if (trimmed) {
    storage.set(STORAGE_KEY, trimmed);
  } else {
    storage.delete(STORAGE_KEY);
  }
}

/**
 * Fills {name} and {link} into a template. A template that never mentions
 * {link} still gets it — on its own line, with a blank line above it to
 * match the paragraph spacing of the default wording above, so the link
 * reads as its own line rather than crammed under the last sentence — so
 * an agent who drops the placeholder (or never used one, like the
 * default) still sends a link that works rather than a message with
 * nothing to tap.
 */
export function buildInvitationSmsText(template: string, name: string, link: string): string {
  const withName = template.replace(/\{name\}/gi, name);
  if (/\{link\}/i.test(withName)) {
    return withName.replace(/\{link\}/gi, link);
  }
  return `${withName}\n\n${link}`;
}
