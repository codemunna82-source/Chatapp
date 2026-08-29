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
    /** Only true is meaningful — clearing it is what opening the chat does,
     *  so there is no reason to accept false here. */
    manuallyUnread: z.literal(true).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

/**
 * Bulk multi-select action. Capped so one request cannot be turned into an
 * unbounded write across the whole workspace — well above any realistic
 * hand-selection, and small enough to stay a single fast query.
 */
export const bulkConversationSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(['archive', 'unarchive', 'delete', 'read']),
});

export const createConversationSchema = z.object({
  contactId: z.string().min(1),
});

export const conversationIdParamSchema = z.object({
  id: z.string().min(1),
});
