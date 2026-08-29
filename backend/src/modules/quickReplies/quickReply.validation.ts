import { z } from 'zod';

export const createQuickReplySchema = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(4096),
});

export const updateQuickReplySchema = z
  .object({
    title: z.string().trim().min(1).max(60).optional(),
    body: z.string().trim().min(1).max(4096).optional(),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined, {
    message: 'Provide at least one of title or body',
  });

export const quickReplyIdParamSchema = z.object({
  id: z.string().min(1),
});
