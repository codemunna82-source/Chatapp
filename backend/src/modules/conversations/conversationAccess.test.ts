import { visibleWhatsAppPhoneNumberId } from './conversation.access';
import type { AuthContext } from '../../types/express';

function ctx(over: Partial<AuthContext> = {}): AuthContext {
  return { userId: 'u1', tenantId: 't1', role: 'SUB_USER', permissions: [], ...over };
}

/**
 * No database: this pure rule decides who can see which chats, and every
 * scoped query and socket room in the app is built from its result.
 */
describe('visibleWhatsAppPhoneNumberId', () => {
  it('gives a MASTER_ADMIN full visibility even when they have an assignment', () => {
    // An admin with a number of their own still manages the workspace.
    // Scoping them would hide the inbox from the person who assigns it.
    expect(visibleWhatsAppPhoneNumberId(ctx({ role: 'MASTER_ADMIN', whatsappPhoneNumberId: 'n1' }))).toBeUndefined();
  });

  it('scopes a SUB_USER to their assigned number', () => {
    expect(visibleWhatsAppPhoneNumberId(ctx({ whatsappPhoneNumberId: 'n1' }))).toBe('n1');
  });

  it('leaves an unassigned SUB_USER unscoped', () => {
    // Every user in every deployment predating assignments is in this
    // state. Defaulting them to "sees nothing" would empty their inbox on
    // deploy; isolation is opt-in, switched on by assigning a number.
    expect(visibleWhatsAppPhoneNumberId(ctx())).toBeUndefined();
    expect(visibleWhatsAppPhoneNumberId(ctx({ whatsappPhoneNumberId: undefined }))).toBeUndefined();
  });

  it('does not treat an empty-string assignment as a scope', () => {
    // An empty string is falsy, so it must read as "unassigned" rather
    // than becoming a filter that matches no conversation at all.
    expect(visibleWhatsAppPhoneNumberId(ctx({ whatsappPhoneNumberId: '' }))).toBeUndefined();
  });
});
