import { useMongoMemoryServer } from '../../../test/withMongo';
import { createTestTenant, createTestUser, createTestChatFixture } from '../../../test/helpers';
import type { AuthContext } from '../../types/express';
import { Conversation } from '../conversations/conversation.model';
import { Message } from '../messages/message.model';
import { GuestSession } from './guestSession.model';
import { createGuestSession, findSessionByToken } from './guestSession.repository';
import { Contact } from '../contacts/contact.model';
import {
  issueGuestLinkForConversation,
  issueGuestLinkForPhone,
  revokeGuestLinkForConversation,
  resolveGuestContextFromToken,
  postGuestMessage,
  listGuestMessages,
  sendGuestReply,
  markBusinessMessagesRead,
} from './guest.service';

useMongoMemoryServer();

async function fixture() {
  const tenant = await createTestTenant();
  const tenantId = String(tenant._id);
  const user = await createTestUser({
    tenantId,
    email: `agent-${Date.now()}@example.com`,
    role: 'MASTER_ADMIN',
  });
  const chat = await createTestChatFixture(tenantId);
  const auth: AuthContext = {
    userId: String(user._id),
    tenantId,
    role: 'MASTER_ADMIN',
    permissions: [],
  };
  return { tenantId, auth, ...chat };
}

describe('guest link lifecycle', () => {
  it('issues a link built from the configured public origin', async () => {
    const { auth, conversation } = await fixture();
    const link = await issueGuestLinkForConversation(auth, String(conversation._id));

    expect(link.url).toMatch(/^https:\/\/chat\.example\.com\/c\/[A-Za-z0-9_-]+$/);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('never stores the token itself, only its hash', async () => {
    // The link lives in a WhatsApp thread forever. A database dump must
    // not be a working key to every customer conversation.
    const { auth, conversation } = await fixture();
    const link = await issueGuestLinkForConversation(auth, String(conversation._id));

    const stored = await GuestSession.findOne({ conversationId: conversation._id }).lean();
    expect(stored?.tokenHash).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(link.token);
  });

  it('refuses to issue a second link while one is live', async () => {
    const { auth, conversation } = await fixture();
    await issueGuestLinkForConversation(auth, String(conversation._id));

    await expect(issueGuestLinkForConversation(auth, String(conversation._id))).rejects.toMatchObject({
      code: 'GUEST_LINK_EXISTS',
    });
  });

  it('stops resolving a revoked link', async () => {
    const { auth, conversation } = await fixture();
    const link = await issueGuestLinkForConversation(auth, String(conversation._id));
    expect(await findSessionByToken(link.token)).not.toBeNull();

    await revokeGuestLinkForConversation(auth, String(conversation._id));

    expect(await findSessionByToken(link.token)).toBeNull();
    await expect(resolveGuestContextFromToken(link.token)).rejects.toMatchObject({
      code: 'GUEST_LINK_INVALID',
    });
  });

  it('stops resolving an expired link', async () => {
    const { tenantId, conversation, contact, phoneNumber } = await fixture();
    const { token } = await createGuestSession({
      tenantId,
      conversationId: String(conversation._id),
      contactId: String(contact._id),
      whatsappPhoneNumberId: String(phoneNumber._id),
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(resolveGuestContextFromToken(token)).rejects.toMatchObject({
      code: 'GUEST_LINK_INVALID',
    });
  });

  it('rejects a token that was never issued', async () => {
    await expect(resolveGuestContextFromToken('not-a-real-token')).rejects.toMatchObject({
      code: 'GUEST_LINK_INVALID',
    });
  });

  it('will not issue a link for another tenant’s conversation', async () => {
    const a = await fixture();
    const b = await fixture();

    await expect(
      issueGuestLinkForConversation(a.auth, String(b.conversation._id)),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });
});

describe('customer messages from the web chat', () => {
  it('stores the message as inbound on the same conversation', async () => {
    const { auth, conversation } = await fixture();
    const link = await issueGuestLinkForConversation(auth, String(conversation._id));
    const guest = await resolveGuestContextFromToken(link.token);

    const view = await postGuestMessage(guest, 'hello from the web');

    expect(view.from).toBe('me');
    expect(view.text).toBe('hello from the web');

    const stored = await Message.findById(view.id).lean();
    expect(stored?.direction).toBe('IN');
    expect(String(stored?.conversationId)).toBe(String(conversation._id));
  });

  it('does NOT reopen Meta’s 24-hour customer-service window', async () => {
    // The whole reason recordGuestInboundActivity exists. A web message is
    // not a WhatsApp message: treating it as one would tell the agent the
    // window was open and have Meta reject their free-form reply.
    const { auth, conversation } = await fixture();
    const before = await Conversation.findById(conversation._id).lean();

    const link = await issueGuestLinkForConversation(auth, String(conversation._id));
    const guest = await resolveGuestContextFromToken(link.token);
    await postGuestMessage(guest, 'still here');

    const after = await Conversation.findById(conversation._id).lean();
    expect(after?.conversationWindowExpiresAt?.getTime()).toBe(
      before?.conversationWindowExpiresAt?.getTime(),
    );
    expect(after?.lastCustomerMessageAt?.getTime()).toBe(before?.lastCustomerMessageAt?.getTime());
    // The chat row still moves and still counts as unread for the agent.
    expect(after?.lastMessagePreview).toBe('still here');
    expect(after?.unreadCount).toBe((before?.unreadCount ?? 0) + 1);
  });

  it('shows the customer only their own conversation', async () => {
    const a = await fixture();
    const b = await fixture();

    const linkA = await issueGuestLinkForConversation(a.auth, String(a.conversation._id));
    const guestA = await resolveGuestContextFromToken(linkA.token);
    await postGuestMessage(guestA, 'mine');

    const linkB = await issueGuestLinkForConversation(b.auth, String(b.conversation._id));
    const guestB = await resolveGuestContextFromToken(linkB.token);
    await postGuestMessage(guestB, 'theirs');

    const page = await listGuestMessages(guestA, {});
    expect(page.items.map((m) => m.text)).toEqual(['mine']);
  });

  it('presents the business’s own messages as coming from the business', async () => {
    const { auth, conversation } = await fixture();
    const link = await issueGuestLinkForConversation(auth, String(conversation._id));
    const guest = await resolveGuestContextFromToken(link.token);

    await postGuestMessage(guest, 'customer asks');
    await sendGuestReply(auth, String(conversation._id), 'agent answers');

    const page = await listGuestMessages(guest, {});
    const byText = Object.fromEntries(page.items.map((m) => [m.text, m.from]));
    expect(byText['customer asks']).toBe('me');
    expect(byText['agent answers']).toBe('business');
  });
});

describe('agent replies into the web window', () => {
  it('refuses when the conversation has no live link', async () => {
    const { auth, conversation } = await fixture();

    await expect(sendGuestReply(auth, String(conversation._id), 'anyone there?')).rejects.toMatchObject({
      code: 'GUEST_LINK_INACTIVE',
    });
  });

  it('stores an outbound message without going through Meta', async () => {
    const { auth, conversation } = await fixture();
    await issueGuestLinkForConversation(auth, String(conversation._id));

    const view = await sendGuestReply(auth, String(conversation._id), 'on it');

    const stored = await Message.findById(view.id).lean();
    expect(stored?.direction).toBe('OUT');
    // SENT, not QUEUED: there is no gateway left to wait on.
    expect(stored?.status).toBe('SENT');
    expect(stored?.metaMessageId).toBeUndefined();
    expect(String(stored?.senderId)).toBe(auth.userId);
  });

  it('will not reply into another tenant’s conversation', async () => {
    const a = await fixture();
    const b = await fixture();
    await issueGuestLinkForConversation(b.auth, String(b.conversation._id));

    await expect(
      sendGuestReply(a.auth, String(b.conversation._id), 'wrong chat'),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });
});

describe('read receipts from the web window', () => {
  it('marks the business’s messages read and leaves the customer’s alone', async () => {
    const { auth, conversation } = await fixture();
    const link = await issueGuestLinkForConversation(auth, String(conversation._id));
    const guest = await resolveGuestContextFromToken(link.token);

    await sendGuestReply(auth, String(conversation._id), 'first');
    await sendGuestReply(auth, String(conversation._id), 'second');
    const mine = await postGuestMessage(guest, 'got it');

    const result = await markBusinessMessagesRead(guest);
    expect(result.read).toBe(2);

    const outbound = await Message.find({ conversationId: conversation._id, direction: 'OUT' }).lean();
    expect(outbound.every((m) => m.status === 'READ')).toBe(true);

    const inbound = await Message.findById(mine.id).lean();
    expect(inbound?.status).toBe('DELIVERED');
  });
});

describe('issuing a link by phone number', () => {
  it('reuses the contact Meta already created from bare digits', async () => {
    // The case this whole path exists for. An inbound WhatsApp message
    // stores `from` exactly as Meta sends it — no leading +. An agent then
    // types the number the way a person writes it. Matching only on the
    // exact string would create a second contact, a second conversation,
    // and a customer whose web messages never appear in the thread the
    // agent is reading.
    const { auth, tenantId, phoneNumber } = await fixture();
    const webhookContact = await Contact.create({ tenantId, phone: '919876543210' });

    const link = await issueGuestLinkForPhone(auth, '+91 98765-43210');

    const contacts = await Contact.find({ tenantId, phone: { $in: ['919876543210', '+919876543210'] } });
    expect(contacts).toHaveLength(1);
    expect(String(contacts[0]!._id)).toBe(String(webhookContact._id));
    expect(link.phone).toBe('+919876543210');
    expect(String(phoneNumber._id)).toBeTruthy();

    const guest = await resolveGuestContextFromToken(link.token);
    expect(guest.contactId).toBe(String(webhookContact._id));
  });

  it('creates the contact in canonical form when it is new', async () => {
    const { auth, tenantId } = await fixture();
    await issueGuestLinkForPhone(auth, '00919999988888', 'New Customer');

    const contact = await Contact.findOne({ tenantId, phone: '+919999988888' });
    expect(contact).not.toBeNull();
    expect(contact?.name).toBe('New Customer');
  });

  it('lands the customer in the conversation their WhatsApp messages already use', async () => {
    const { auth, conversation, contact } = await fixture();

    const link = await issueGuestLinkForPhone(auth, contact.phone);
    const guest = await resolveGuestContextFromToken(link.token);

    expect(guest.conversationId).toBe(String(conversation._id));
    expect(link.conversationId).toBe(String(conversation._id));
  });

  it('refuses something that is not a phone number', async () => {
    const { auth } = await fixture();
    await expect(issueGuestLinkForPhone(auth, '12345')).rejects.toMatchObject({ code: 'INVALID_PHONE' });
  });
});
