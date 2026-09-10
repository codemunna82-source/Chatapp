import { z } from 'zod';
import { GUEST_REPORT_REASONS } from './guestReport.model';

/**
 * WhatsApp's own text limit. Matching it keeps the two channels
 * interchangeable: a message the customer can type here is one the agent
 * could also have received over WhatsApp, so nothing downstream needs a
 * second size rule.
 */
export const GUEST_TEXT_MAX = 4096;

/** A Mongo id, which is what every message id in this API is. */
const messageIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid message id');

export const guestMessageSchema = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(GUEST_TEXT_MAX),
  /** The message being answered. Checked against this conversation server-side. */
  replyToMessageId: messageIdSchema.optional(),
});

/**
 * A reaction.
 *
 * The emoji is length-bounded rather than pattern-matched: a single
 * "emoji" can be several code points once skin tones and joiners are
 * involved, and a regex tight enough to accept only emoji rejects half of
 * the ones a real keyboard produces. Eight characters is more than any
 * single glyph needs and far less than a message.
 *
 * An empty string is allowed and means "remove my reaction" — the same
 * shape the WhatsApp API itself uses.
 *
 * The bound counts UTF-16 units, which is not the same as characters: a
 * family emoji is four faces joined by zero-width joiners and comes to
 * eleven, and a flag with a skin tone is longer still. Eight rejected
 * every one of those with a 400. Thirty-two is still nowhere near a
 * message and accepts any single glyph a keyboard can produce.
 */
export const guestReactionSchema = z.object({
  messageId: messageIdSchema,
  emoji: z.string().trim().max(32),
});

/**
 * A place the customer shared.
 *
 * The bounds are the real ones: latitude past ±90 and longitude past ±180
 * are not points on Earth, and a geolocation API that produced them has
 * malfunctioned. Rejecting them here keeps a map pin from being drawn
 * somewhere that does not exist and, more usefully, keeps the number out
 * of the stored line the agent reads.
 *
 * `name` and `address` are optional because a browser's geolocation gives
 * neither — it gives coordinates. They exist for the labelled places a
 * future picker could offer, and for locations arriving from WhatsApp,
 * where the sender may have chosen a named place.
 */
export const guestLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  replyToMessageId: messageIdSchema.optional(),
});

/**
 * A customer reporting the conversation, blocking it, or both.
 *
 * `block` alone is a valid submission — someone who wants the business to
 * stop messaging them should not have to accuse them of anything first, so
 * the reason is required only when a report is actually being filed.
 */
export const guestReportSchema = z
  .object({
    reason: z.enum(GUEST_REPORT_REASONS).optional(),
    details: z.string().trim().max(1000).optional(),
    /** The message the complaint is about, shown back to the customer before they submit. */
    messageId: messageIdSchema.optional(),
    /** Whether to also stop this window from being written to, in either direction. */
    block: z.boolean().default(false),
    /** Whether a report is being filed at all, as opposed to only blocking. */
    report: z.boolean().default(true),
  })
  .refine((v) => v.block || v.report, {
    message: 'Nothing to do: choose to report, to block, or both.',
  })
  .refine((v) => !v.report || Boolean(v.reason), {
    message: 'Choose a reason for the report.',
    path: ['reason'],
  });

/**
 * A browser's Web Push registration token.
 *
 * Length-bounded and nothing more. FCM's token format is not documented as
 * stable and has changed shape before; a regex tight enough to be worth
 * having would start rejecting valid tokens the next time it does.
 */
export const guestPushSchema = z.object({
  token: z.string().trim().min(20).max(4096),
});

export const guestBlockSchema = z.object({
  blocked: z.boolean(),
});

export const guestMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const guestReplySchema = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(GUEST_TEXT_MAX),
});

export const guestConversationIdParamSchema = z.object({
  conversationId: z.string().min(1),
});

/**
 * The phone is validated by normalizePhone rather than a regex here.
 *
 * People paste "+91 98765-43210", "0091...", and the bare digits Meta
 * sends, and all three are the same customer — a strict E.164 regex at
 * this layer would reject two of them before the normaliser ever sees
 * them, which is the split this whole path exists to close.
 */
export const guestLinkByPhoneSchema = z.object({
  phone: z.string().trim().min(5).max(32),
  name: z.string().trim().min(1).max(120).optional(),
});
