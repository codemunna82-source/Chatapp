/**
 * The fixed keyword list the AUTO-REPLY receiver filters for
 * (SmsAutoReplyReceiver.kt, which keeps its own copy since Kotlin can't
 * import this) — a message has to contain at least one of these
 * (case-insensitive) before VOXO texts back a link on its own. Kept
 * narrow on purpose: auto-replying to every personal text a device
 * receives would mean a stray "hi" from a friend gets a chat-link SMS
 * back.
 *
 * NOT what decides what the Chats tab or Settings > SMS show any more —
 * see isIndianMobileSender below for that.
 */
export const MATCH_KEYWORDS = ['hii', 'saw', 'profile'];

export function matchesLeadKeywords(body: string): boolean {
  const lower = body.toLowerCase();
  return MATCH_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * What the Chats tab and Settings > SMS actually filter the inbox by:
 * does this text look like it came from a real person's mobile number,
 * not a keyword in its body. An OTP, a bank alert, or a promotional
 * blast comes from a DLT-registered alphanumeric sender id ("VM-
 * HDFCBK", "AD-OTPSMS") or a short numeric gateway code ("56070",
 * "121") — never a 10-digit number a person could actually be texted
 * back on — so excluding those is what keeps this list to texts an
 * agent could plausibly reply to, without needing to know in advance
 * what the message says.
 *
 * Deliberately not SMS_RECEIVED-side (SmsAutoReplyReceiver.kt still
 * matches on keyword, by design — see MATCH_KEYWORDS): showing a text
 * in VOXO and auto-replying to it are different enough in consequence
 * that one relaxing its filter is not a reason for the other to.
 */
export function isIndianMobileSender(address: string): boolean {
  if (/[A-Za-z]/.test(address)) return false;
  const digits = address.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 12) return false;
  const last10 = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(last10);
}
