import { z } from 'zod';
import { PERMISSIONS } from './permission';
import { USER_ROLES, USER_STATUSES } from './user.model';

/**
 * The WhatsApp number this user sends from, as the ObjectId of one of the
 * tenant's WhatsAppPhoneNumber records — not Meta's own numeric
 * `phone_number_id`, which carries no tenancy and so can't be checked.
 *
 * Shape only; that the id actually belongs to the caller's tenant is
 * enforced in user.service.ts, where the tenant is known.
 */
const whatsappPhoneNumberIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid WhatsApp number id');

export const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  role: z.enum(USER_ROLES).default('SUB_USER'),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
  validFrom: z.coerce.date().default(() => new Date()),
  validUntil: z.coerce.date(),
  displayName: z.string().trim().min(1).optional(),
  whatsappPhoneNumberId: whatsappPhoneNumberIdSchema.optional(),
});

export const updateUserSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    permissions: z.array(z.enum(PERMISSIONS)).optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
    status: z.enum(USER_STATUSES).optional(),
    displayName: z.string().trim().min(1).optional(),
    // `null` clears the assignment. `undefined` cannot: it is
    // indistinguishable from a patch that simply doesn't touch this field.
    whatsappPhoneNumberId: whatsappPhoneNumberIdSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const listUsersQuerySchema = z.object({
  status: z.enum(USER_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().min(1),
});
