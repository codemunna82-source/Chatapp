import { z } from 'zod';

export const listCallsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const initiateCallSchema = z.object({
  contactId: z.string().min(1),
});
