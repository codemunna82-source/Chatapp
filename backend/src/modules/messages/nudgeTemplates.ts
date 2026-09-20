/**
 * The only things a workspace may say over WhatsApp before the customer
 * opens their private chat.
 *
 * The allowance next door (whatsappQuota.ts) limits HOW MANY nudges go
 * out. This limits WHAT they are. Both exist for the same reason and the
 * second is the stronger of the two: free-form WhatsApp messages to a
 * customer who has not engaged are what Meta's policy reviewers act on,
 * and one agent improvising costs the whole business account — every
 * number on it, including other workspaces'.
 *
 * So the nudges are fixed wording, in a fixed order: the first message
 * says one thing, the second says another, and there is no third. An
 * admin can change the wording; an agent cannot, and does not choose the
 * order either.
 *
 * These are NOT Meta-approved templates, and the difference matters. They
 * are ordinary free-form messages, which Meta allows only inside the
 * 24-hour window the customer's own message opened — which is exactly
 * when these are sent. The private-chat link itself goes out separately —
 * an agent sends it by hand, or it arrives via the workspace's own Meta
 * automation; these follow it and refer back to it.
 */

/**
 * The wording a workspace starts with.
 *
 * Neither carries the link itself, deliberately: the link travels in the
 * approved template that went first, and its plaintext token is returned
 * once at creation and never stored, so it cannot be rendered into a
 * later message without minting a new one — which would turn every copy
 * already in the customer's thread into a dead link.
 */
export const DEFAULT_WHATSAPP_NUDGES: readonly string[] = [
  `🌟 DEAR CUSTOMER 🌟

Mujhse directly baat karne ke liye PRIVATE CHAT LINK 🔗 par click karein.

💬 Wahi par baat hogi aur photos/details bhi available hain. 📸

👉 Private Chat par message karein, main aapko wahi reply karunga thank you 🙏`,

  `🔐 PRIVATE & SECURE CHAT

Aapse directly baat karne ke liye
👆 PRIVATE CHAT LINK 🔗 par click karein.

🛡️ Aapki shared details private chat mein hi rahengi.
📸 Photos & complete details bhi wahi available hain.

🕐 24/7 RESPONSE AVAILABLE

👉 Abhi Private Chat par click karke message karein.
Main wahi aapko reply karunga. 🙏`,
];

/** As long as a WhatsApp text message may be. */
export const NUDGE_MAX_LENGTH = 1024;

/**
 * Two strings that would arrive at the customer identically.
 *
 * Compared this way because a client that renders the wording into a text
 * box and posts it back cannot be relied on to return the bytes it was
 * given: a keyboard turns CRLF into LF, a copy-paste picks up a trailing
 * newline, and an editor trims. None of those change what the customer
 * reads, so none of them should be the difference between a message
 * sending and being refused.
 *
 * Only whitespace is forgiven. A word changed is a different message.
 */
export function sameNudgeText(a: string, b: string): boolean {
  return normalizeNudge(a) === normalizeNudge(b);
}

function normalizeNudge(value: string): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * The workspace's nudges, falling back to the defaults.
 *
 * A stored list that is empty means "never configured", not "no nudges
 * allowed" — the difference between a workspace that has not opened the
 * settings screen and one that has deliberately emptied it. Emptying it
 * is expressed by switching enforcement off, which is a decision with a
 * visible switch rather than an absence nobody sees.
 */
export function nudgesFor(configured: readonly string[] | undefined | null): string[] {
  const list = (configured ?? []).map((t) => String(t ?? '').trim()).filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_WHATSAPP_NUDGES];
}

/**
 * Which nudge comes next, given how many have already gone.
 *
 * Null once they are spent. The count comes from the messages themselves
 * (countWhatsAppNudges), not from a stored pointer, so a deleted or
 * failed message cannot leave the sequence out of step.
 */
export function nudgeAt(nudges: readonly string[], used: number): string | null {
  if (used < 0 || used >= nudges.length) return null;
  return nudges[used] ?? null;
}

/** What an agent is told when they try to send something else. */
export function nudgeRefusalMessage(position: number, total: number): string {
  return (
    `Until this customer opens their private chat, only the set WhatsApp message can be sent — ` +
    `this would be message ${position} of ${total}. Use the suggested wording in the composer, ` +
    'or send them the private chat link.'
  );
}
