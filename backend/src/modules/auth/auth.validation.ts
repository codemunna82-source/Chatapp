import { z } from 'zod';

/**
 * Signing in.
 *
 * The field is called `identifier` and takes a phone number or an email.
 * One field rather than two because there is only ever one thing to type,
 * and the server can tell them apart without being told — a phone number
 * normalises to E.164 and an email cannot.
 *
 * `email` is still accepted as an alias, and that is not tidiness: apps
 * already installed post `{ email, password }`, and dropping it would
 * sign every one of them out permanently the moment this deploys.
 *
 * No `.email()` validation on any of them. The lookup decides what the
 * value was, and rejecting "9876543210" here as an invalid email — or a
 * misspelt address as an invalid phone — would refuse the request before
 * the code that knows how to read it ever runs.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(320).optional(),
    phone: z.string().trim().min(1).max(320).optional(),
    email: z.string().trim().min(1).max(320).optional(),
    password: z.string().min(1),
  })
  .transform((body) => ({
    identifier: body.identifier ?? body.phone ?? body.email ?? '',
    password: body.password,
  }))
  .refine((body) => body.identifier.length > 0, {
    message: 'Enter your phone number',
    path: ['identifier'],
  });

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});
