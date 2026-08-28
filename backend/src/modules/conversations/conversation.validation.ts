import { z } from 'zod';
import { CONVERSATION_STATUSES } from './conversation.model';

export const listConversationsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  pinnedOnly: z.coerce.boolean().optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
});

export const updateConversationSchema = z
  .object({
    pinned: z.boolean().optional(),
    status: z.enum(CONVERSATION_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const createConversationSchema = z.object({
  contactId: z.string().min(1),
});

export const conversationIdParamSchema = z.object({
  id: z.string().min(1),
});
