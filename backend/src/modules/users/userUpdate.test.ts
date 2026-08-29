import { buildUserUpdate } from './user.repository';

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
