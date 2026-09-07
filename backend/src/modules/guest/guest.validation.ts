import { z } from 'zod';

/**
 * WhatsApp's own text limit. Matching it keeps the two channels
 * interchangeable: a message the customer can type here is one the agent
 * could also have received over WhatsApp, so nothing downstream needs a
 * second size rule.
 */
export const GUEST_TEXT_MAX = 4096;

export const guestMessageSchema = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(GUEST_TEXT_MAX),
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
