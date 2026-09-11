import { buildUserUpdate } from './user.repository';
import { resetUserPasswordSchema, updateUserSchema } from './user.validation';

/**
 * No database: buildUserUpdate is pure, and the thing worth pinning down is
 * the shape of the update document it produces — specifically that
 * "unassign the WhatsApp number" comes out as an $unset rather than a $set
 * of null, which would leave the field present and holding null.
 */
describe('buildUserUpdate', () => {
  it('puts ordinary fields in $set', () => {
    expect(buildUserUpdate({ displayName: 'Asha', status: 'DISABLED' })).toEqual({
      $set: { displayName: 'Asha', status: 'DISABLED' },
    });
  });

  it('assigns a WhatsApp number via $set', () => {
    expect(buildUserUpdate({ whatsappPhoneNumberId: '507f1f77bcf86cd799439011' })).toEqual({
      $set: { whatsappPhoneNumberId: '507f1f77bcf86cd799439011' },
    });
  });

  it('clears a WhatsApp number via $unset, never $set: null', () => {
    const update = buildUserUpdate({ whatsappPhoneNumberId: null });
    expect(update).toEqual({ $unset: { whatsappPhoneNumberId: '' } });
    expect(update.$set).toBeUndefined();
  });

  it('combines a clear with other edits in one document', () => {
    expect(buildUserUpdate({ role: 'SUB_USER', whatsappPhoneNumberId: null })).toEqual({
      $set: { role: 'SUB_USER' },
      $unset: { whatsappPhoneNumberId: '' },
    });
  });

  it('drops explicitly-undefined fields rather than $set-ting undefined', () => {
    // This is the shape the mobile form sends: displayName is undefined
    // when the field was left blank. $set: { displayName: undefined } is a
    // Mongo error, not a no-op.
    expect(buildUserUpdate({ role: 'SUB_USER', displayName: undefined })).toEqual({
      $set: { role: 'SUB_USER' },
    });
  });

  it('returns an empty document for an empty patch, adding no $set', () => {
    // updateUserSchema refuses this upstream; if that ever changes, an
    // empty update is a harmless no-op rather than a Mongo error.
    expect(buildUserUpdate({})).toEqual({});
  });
});

/**
 * The password reset is a separate route from the generic PATCH for one
 * reason worth a test rather than only a comment: updateUserForTenant
 * writes its whole patch into the audit log's `metadata`, so a password
 * that reached it would be stored in plaintext. Zod stripping unknown keys
 * is what stops a request body from getting one in there, and stripping is
 * a default — a schema switched to `.passthrough()` some day would undo it
 * silently.
 */
describe('password cannot travel through the generic user update', () => {
  it('strips a password smuggled into the PATCH body', () => {
    const parsed = updateUserSchema.parse({
      displayName: 'Asha',
      password: 'hunter22-not-a-real-password',
    } as Record<string, unknown>);
    expect(parsed).toEqual({ displayName: 'Asha' });
    expect('password' in parsed).toBe(false);
  });

  it('strips a passwordHash smuggled into the PATCH body', () => {
    // The repository patch type carries passwordHash so setUserPasswordHash
    // can reuse the same write path. This is what keeps that from also
    // being a way to set an attacker-chosen hash from a request.
    const parsed = updateUserSchema.parse({
      role: 'SUB_USER',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$aaaa$bbbb',
    } as Record<string, unknown>);
    expect('passwordHash' in parsed).toBe(false);
  });
});

describe('resetUserPasswordSchema', () => {
  it('accepts a password of at least 8 characters', () => {
    expect(resetUserPasswordSchema.parse({ password: 'abcd1234' })).toEqual({
      password: 'abcd1234',
    });
  });

  it('refuses a short one, so the admin sees it before the server does', () => {
    expect(resetUserPasswordSchema.safeParse({ password: 'abc123' }).success).toBe(false);
  });

  it('refuses a body with no password at all', () => {
    expect(resetUserPasswordSchema.safeParse({}).success).toBe(false);
  });
});
