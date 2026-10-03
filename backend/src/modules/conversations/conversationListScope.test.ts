import { conversationListNumberScope } from './conversation.service';
import type { AuthContext } from '../../types/express';

/**
 * The filter must only ever narrow.
 *
 * It arrives from the client, and the whole point of the per-number scope
 * is that a member assigned one number cannot read another team's
 * conversations. A filter that can widen is not a filter — it is a way in.
 */
function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'AGENT',
    permissions: [],
    ...overrides,
  } as AuthContext;
}

describe('conversationListNumberScope', () => {
  const OWN = '6abfbae96b16d9bb5dd29300';
  const SOMEONE_ELSE = '6aac1ed5371afd0773d2e9b3';

  it('keeps a scoped member on their own number, whatever they ask for', () => {
    const scoped = auth({ whatsappPhoneNumberId: OWN });
    expect(conversationListNumberScope(scoped, SOMEONE_ELSE)).toBe(OWN);
    expect(conversationListNumberScope(scoped, undefined)).toBe(OWN);
    expect(conversationListNumberScope(scoped, '')).toBe(OWN);
  });

  it('lets an unscoped admin narrow to one number', () => {
    expect(conversationListNumberScope(auth({ role: 'MASTER_ADMIN' }), SOMEONE_ELSE)).toBe(SOMEONE_ELSE);
  });

  it('leaves an unscoped admin seeing everything when they ask for nothing', () => {
    const admin = auth({ role: 'MASTER_ADMIN' });
    expect(conversationListNumberScope(admin, undefined)).toBeUndefined();
    // Blank and whitespace are "no filter", not "a number called nothing",
    // which would match no conversation and read as an empty inbox.
    expect(conversationListNumberScope(admin, '')).toBeUndefined();
    expect(conversationListNumberScope(admin, '   ')).toBeUndefined();
  });

  it('trims what it passes on', () => {
    expect(conversationListNumberScope(auth({ role: 'MASTER_ADMIN' }), `  ${OWN} `)).toBe(OWN);
  });
});
