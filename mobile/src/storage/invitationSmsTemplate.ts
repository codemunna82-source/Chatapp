import { storage } from './mmkv';

const STORAGE_KEY = 'voxo.invitationSmsTemplate';

/**
 * What "Send invitation via SMS" (ConversationDetailScreen's smsGuestLink)
 * sends by default — the wording before an agent ever customizes it.
 * {name} and {link} are replaced by buildInvitationSmsText; {link} is
 * optional in a custom template (see there) but always present here so a
 * reader who never opens Settings still gets a complete default message.
 */
export const DEFAULT_INVITATION_SMS_TEMPLATE = 'Hi {name}, continue our conversation privately here: {link}';

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
 * {link} still gets it — on its own line, the same convention
 * buildAutoReplyText in PrivateChatLinkSection.tsx uses — so an agent who
 * deletes the placeholder by accident still sends a link that works rather
 * than a message with nothing to tap.
 */
export function buildInvitationSmsText(template: string, name: string, link: string): string {
  const withName = template.replace(/\{name\}/gi, name);
  if (/\{link\}/i.test(withName)) {
    return withName.replace(/\{link\}/gi, link);
  }
  return `${withName}\n${link}`;
}
