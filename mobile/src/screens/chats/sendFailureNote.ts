/**
 * The line under a red bubble that says why, and what to do instead.
 *
 * "Failed · tap to retry" is the right words for a blip and the wrong
 * words for a rule. Three of the server's refusals are rules: the
 * WhatsApp allowance is spent, the wording is not one of the workspace's
 * fixed messages, or the 24-hour window has closed. Tapping retry on any
 * of them fails identically, and the agent is left tapping a red bubble
 * with a customer waiting.
 *
 * The toast that fires at the moment of failure carries the server's own
 * sentence, but it is gone in three seconds and never comes back — not
 * after a scroll, not after reopening the chat, and not for the colleague
 * who sees the red bubble an hour later. This note stays with the message
 * it belongs to.
 *
 * Returns null for everything else, which includes every genuine blip:
 * those really are "tap to retry", and explaining them at length would
 * bury the one instruction that works.
 */
export function sendFailureNote(code: string | undefined): string | null {
  switch (code) {
    case 'WHATSAPP_NUDGE_LIMIT_REACHED':
      return 'No WhatsApp replies left for this customer. Nothing more will go out on WhatsApp — you can reply again the moment they open the private chat link.';
    case 'WHATSAPP_NUDGE_NOT_ALLOWED':
      return 'Until the customer opens the private chat, only the fixed WhatsApp messages your workspace set can be sent.';
    case 'NUDGE_NOT_NEEDED':
      return 'This customer is already in the private chat — reply to them here instead.';
    case 'MESSAGE_TEMPLATE_REQUIRED':
      return 'More than 24 hours since their last message, so WhatsApp allows only an approved template until they write again.';
    default:
      return null;
  }
}
