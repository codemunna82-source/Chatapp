import { refuseUserRemoval } from './userRemoval';

const OTHER = { actorUserId: 'admin-1', targetUserId: 'member-2' };

describe('refuseUserRemoval', () => {
  it('allows removing another member', () => {
    expect(refuseUserRemoval({ ...OTHER, targetRole: 'SUB_USER', masterAdminCount: 1 })).toBeNull();
  });

  it('refuses removing yourself', () => {
    const refusal = refuseUserRemoval({
      actorUserId: 'admin-1',
      targetUserId: 'admin-1',
      targetRole: 'MASTER_ADMIN',
      masterAdminCount: 5,
    });
    expect(refusal?.code).toBe('CANNOT_REMOVE_SELF');
    // 400, not 409: the request is wrong in itself, not blocked by state.
    expect(refusal?.kind).toBe('bad_request');
  });

  it('refuses the last admin', () => {
    const refusal = refuseUserRemoval({ ...OTHER, targetRole: 'MASTER_ADMIN', masterAdminCount: 1 });
    expect(refusal?.code).toBe('LAST_ADMIN');
    expect(refusal?.kind).toBe('conflict');
    expect(refusal?.message).toContain('Make someone else an admin first');
  });

  it('allows removing an admin when another remains', () => {
    expect(refuseUserRemoval({ ...OTHER, targetRole: 'MASTER_ADMIN', masterAdminCount: 2 })).toBeNull();
  });

  it('does not block the last SUB_USER', () => {
    // The rule protects administrability, not headcount. A workspace with
    // one member and one admin must still be able to remove the member.
    expect(refuseUserRemoval({ ...OTHER, targetRole: 'SUB_USER', masterAdminCount: 1 })).toBeNull();
  });

  it('checks self before role, so an admin cannot remove themselves even with others around', () => {
    const refusal = refuseUserRemoval({
      actorUserId: 'admin-1',
      targetUserId: 'admin-1',
      targetRole: 'MASTER_ADMIN',
      masterAdminCount: 9,
    });
    expect(refusal?.code).toBe('CANNOT_REMOVE_SELF');
  });
});
