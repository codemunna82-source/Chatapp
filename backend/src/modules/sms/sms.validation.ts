import { z } from 'zod';

/**
 * One SMS the device's own inbox/sent box holds, as read off the Android
 * content provider — see smsSync.ts and localSmsInbox.ts on the mobile
 * side. `clientMessageId` is the device's own SMS row id (offset for a
 * sent-box row — see smsSync.ts) turned into a string, stable across
 * repeated syncs of the same text, which is what makes this endpoint
 * safe to call again with messages it already accepted (see
 * findMessageByClientId's existing dedup index).
 */
const syncedSms = z.object({
  phone: z.string().trim().min(1).max(32),
  body: z.string().max(4096),
  date: z.number().int().positive(),
  direction: z.enum(['IN', 'OUT']),
  clientMessageId: z.string().trim().min(1).max(128),
});

export const smsSyncSchema = z.object({
  // Capped well above what one device could plausibly generate between
  // polls (smsSync.ts scans at most 300 per box) — a request this large
  // is a bug or abuse, not a real sync.
  messages: z.array(syncedSms).min(1).max(500),
});

export const smsConversationQuerySchema = z.object({
  phone: z.string().trim().min(1).max(32),
});

/**
 * POST /api/sms/send's body — one item, shaped exactly like a
 * syncedSms entry but always OUT: this is the agent's own composer
 * sending text live, never a device re-reporting something it already
 * received.
 */
export const smsSendSchema = syncedSms.extend({
  direction: z.literal('OUT'),
});
