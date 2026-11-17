import { z } from 'zod';
import { normalizePhone } from '../../lib/phone';
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

/**
 * A sign-in phone number.
 *
 * Validated by normalizePhone rather than a regex, for the same reason
 * contacts are: people type "+91 98765-43210", "0091…" and bare digits,
 * and all three are the same number. A strict E.164 regex would reject two
 * of them before the normaliser that understands them ever ran.
 *
 * The country code is required, because it is what makes the number
 * unambiguous — "9876543210" is a different person in a different country,
 * and a login that guessed would eventually guess wrong.
 */
const loginPhoneSchema = z
  .string()
  .trim()
  .min(5)
  .max(32)
  .refine((v) => normalizePhone(v) !== null, {
    message: 'Enter the full number with country code, e.g. +91 98765 43210',
  });

export const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  /**
   * Required, because sign-in is by phone number. A user created without
   * one would be an account nobody can get into — and the only way to fix
   * it afterwards is an admin editing them, which is a strange thing to
   * make routine.
   */
  phone: loginPhoneSchema,
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
    /** Changing what someone signs in with. Optional here — an edit is not a re-registration. */
    phone: loginPhoneSchema.optional(),
    /**
     * Also editable, for the same reason the phone number is: a typo in
     * either one at creation time used to be permanent, and email is the
     * fallback identifier that login accepts when an account predates
     * phone sign-in.
     */
    email: z.string().email().toLowerCase().optional(),
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

/**
 * An admin setting someone's password for them.
 *
 * Deliberately NOT part of updateUserSchema. updateUserForTenant writes
 * its whole patch into the audit log's `metadata` field, so a password
 * folded into that patch would be stored in plaintext in a collection
 * built to be read — the reset therefore gets its own route, its own
 * service call, and an audit entry that records only that it happened.
 *
 * No current-password check here, unlike changePassword: the point of
 * this route is the person who forgot theirs. The MASTER_ADMIN guard on
 * the router is what stands in for it.
 */
export const resetUserPasswordSchema = z.object({
  password: z.string().min(8, 'At least 8 characters').max(200),
});
