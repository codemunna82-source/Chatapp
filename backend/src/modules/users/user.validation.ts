import { z } from 'zod';
import { PERMISSIONS } from './permission';
import { USER_ROLES, USER_STATUSES } from './user.model';

export const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  role: z.enum(USER_ROLES).default('SUB_USER'),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
  validFrom: z.coerce.date().default(() => new Date()),
  validUntil: z.coerce.date(),
  displayName: z.string().trim().min(1).optional(),
});

export const updateUserSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    permissions: z.array(z.enum(PERMISSIONS)).optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
    status: z.enum(USER_STATUSES).optional(),
    displayName: z.string().trim().min(1).optional(),
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
