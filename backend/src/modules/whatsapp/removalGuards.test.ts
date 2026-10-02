import { blockNumberRemoval, blockBusinessManagerRemoval } from './removalGuards';

describe('blockNumberRemoval', () => {
  it('allows removing a number nothing points at', () => {
    expect(blockNumberRemoval({ displayPhoneNumber: '+911234567890', conversationCount: 0 })).toBeNull();
  });

  it('refuses a number that carries chats, and says what to do instead', () => {
    const blocked = blockNumberRemoval({ displayPhoneNumber: '+911234567890', conversationCount: 42 });
    expect(blocked?.code).toBe('WHATSAPP_NUMBER_HAS_HISTORY');
    // The count and the number, so the admin can tell WHICH number and how
    // much is at stake without going to look.
    expect(blocked?.message).toContain('42 customer chats');
    expect(blocked?.message).toContain('+911234567890');
    // The alternative is the whole point of refusing rather than deleting.
    expect(blocked?.message).toContain('Switch the number off');
  });

  it('says "chat" for one', () => {
    const blocked = blockNumberRemoval({ displayPhoneNumber: '+1', conversationCount: 1 });
    expect(blocked?.message).toContain('1 customer chat on it');
  });

  it('treats a negative count as nothing to protect rather than as history', () => {
    // countDocuments cannot return this, but a guard that reads "> 0" as
    // "blocked" and anything else as "allowed" must not invert on a value
    // it did not expect.
    expect(blockNumberRemoval({ displayPhoneNumber: '+1', conversationCount: -1 })).toBeNull();
  });
});

describe('blockBusinessManagerRemoval', () => {
  it('allows removing a Business Manager holding nothing', () => {
    expect(blockBusinessManagerRemoval({ name: 'Acme BM', accountCount: 0, numberCount: 0 })).toBeNull();
  });

  it('refuses one holding numbers, and asks for them to be moved', () => {
    const blocked = blockBusinessManagerRemoval({ name: 'Acme BM', accountCount: 2, numberCount: 5 });
    expect(blocked?.code).toBe('META_APP_IN_USE');
    expect(blocked?.message).toContain('Acme BM');
    expect(blocked?.message).toContain('5 WhatsApp numbers');
    expect(blocked?.message).toContain('Move them');
  });

  it('asks for accounts to be disconnected when it holds accounts but no numbers', () => {
    const blocked = blockBusinessManagerRemoval({ name: 'Acme BM', accountCount: 1, numberCount: 0 });
    // A different next step, not a reworded version of the same one — this
    // is why the two refusals are separate.
    expect(blocked?.message).toContain('1 connected WhatsApp account');
    expect(blocked?.message).toContain('Disconnect them');
    expect(blocked?.message).not.toContain('Move them');
  });
});
