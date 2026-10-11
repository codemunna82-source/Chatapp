/**
 * The fixed list every lead-SMS feature filters for — the Settings > SMS
 * inbox, the auto-reply receiver (SmsAutoReplyReceiver.kt, which keeps its
 * own copy since Kotlin can't import this), and the Chats-tab SMS threads.
 * A message has to contain at least one of these (case-insensitive) to
 * count as a lead at all; everything else a device's SMS app holds (OTPs,
 * bank alerts, personal messages) is read but never surfaced anywhere.
 */
export const MATCH_KEYWORDS = ['hii', 'saw', 'profile'];

export function matchesLeadKeywords(body: string): boolean {
  const lower = body.toLowerCase();
  return MATCH_KEYWORDS.some((kw) => lower.includes(kw));
}
