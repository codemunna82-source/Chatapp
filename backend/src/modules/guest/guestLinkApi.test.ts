import { useMongoMemoryServer } from '../../../test/withMongo';
import { createTestTenant, createTestChatFixture } from '../../../test/helpers';
import { ApiError } from '../../lib/ApiError';
import { Contact } from '../contacts/contact.model';
import { GuestSession } from './guestSession.model';
import { issuePublicGuestLink, resolveGuestContextFromToken } from './guest.service';

useMongoMemoryServer();

async function fixture() {
  const tenant = await createTestTenant();
  const tenantId = String(tenant._id);
  const chat = await createTestChatFixture(tenantId);
  return { tenantId, ...chat };
}

/**
 * The public guest-link API's only reason to exist: an external
 * automation has nothing but a phone number, and this is what has to turn
 * that into a working, per-customer private-chat link — see
 * guestLinkApi.routes.ts.
 */
describe('issuePublicGuestLink', () => {
  it('creates the contact, conversation and a resolvable link for a new phone number', async () => {
    const { tenantId, phoneNumber } = await fixture();
    const link = await issuePublicGuestLink(tenantId, String(phoneNumber._id), '+91 98765-43210');

    expect(link.url).toMatch(/^https:\/\/chat\.example\.com\/c\/[A-Za-z0-9_-]+$/);
    const token = link.url.split('/c/')[1]!;
    const guest = await resolveGuestContextFromToken(token);
    expect(guest.whatsappPhoneNumberId).toBe(String(phoneNumber._id));

    const contacts = await Contact.find({ tenantId, phone: '+919876543210' });
    expect(contacts).toHaveLength(1);
  });

  it('reuses the same conversation and reissues rather than refusing on a second call', async () => {
    const { tenantId, phoneNumber } = await fixture();
    const first = await issuePublicGuestLink(tenantId, String(phoneNumber._id), '+919876543210');
    const second = await issuePublicGuestLink(tenantId, String(phoneNumber._id), '+919876543210');

    // Exactly one session for this customer — a second call must not spin
    // up a competing thread.
    const sessions = await GuestSession.find({ tenantId });
    expect(sessions).toHaveLength(1);

    // Both tokens still open it: an automation calling on every inbound
    // message must never invalidate a link already sitting in the
    // customer's WhatsApp thread.
    const firstToken = first.url.split('/c/')[1]!;
    const secondToken = second.url.split('/c/')[1]!;
    expect(firstToken).not.toBe(secondToken);
    await expect(resolveGuestContextFromToken(firstToken)).resolves.toBeTruthy();
    await expect(resolveGuestContextFromToken(secondToken)).resolves.toBeTruthy();
  });

  it('rejects a phone number it cannot parse', async () => {
    const { tenantId, phoneNumber } = await fixture();
    await expect(issuePublicGuestLink(tenantId, String(phoneNumber._id), 'not-a-phone')).rejects.toThrow(
      ApiError,
    );
  });
});
