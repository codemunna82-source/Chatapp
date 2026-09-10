import { z } from 'zod';

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
