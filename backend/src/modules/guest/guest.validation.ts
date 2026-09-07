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
