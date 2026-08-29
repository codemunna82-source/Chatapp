import { z } from 'zod';

// E.164: leading '+', country code 1-9, up to 15 digits total.
const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format, e.g. +14155551234');

export const createContactSchema = z.object({
  phone: e164,
  name: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const updateContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const listContactsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const contactIdParamSchema = z.object({
  id: z.string().min(1),
});
