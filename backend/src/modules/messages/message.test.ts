import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser, createTestChatFixture } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';

useMongoMemoryServer();
const app = createApp();

async function tokenFor(tenantId: string, permissions: string[]) {
  const user = await createTestUser({ tenantId, email: `u-${Date.now()}-${Math.random()}@voxo.test`, permissions: permissions as never });
  return signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });
}

describe('Messages REST', () => {
  it('sends a text message within the 24h window (mock Meta gateway)', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'text', text: 'Hello there' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('SENT');
    expect(res.body.data.text).toBe('Hello there');
  });

  it('rejects a free-form send outside the 24h window with MESSAGE_TEMPLATE_REQUIRED', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id), { withinWindow: false });
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'text', text: 'Hello there' });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'MESSAGE_TEMPLATE_REQUIRED', message: 'An approved WhatsApp template is required.' },
    });
  });

  it('allows a template send even outside the 24h window', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id), { withinWindow: false });
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND', 'CHAT_TEMPLATE']);

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'template', templateName: 'order_ready_for_pickup', languageCode: 'en_US' });

    expect(res.status).toBe(201);
  });

  it('requires CHAT_TEMPLATE to send a template message even within the window', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']); // no CHAT_TEMPLATE

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'template', templateName: 'order_ready_for_pickup', languageCode: 'en_US' });

    expect(res.status).toBe(403);
  });

  it('requires CHAT_MEDIA to send a media message', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']); // no CHAT_MEDIA

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'image', mediaLink: 'https://example.com/photo.jpg' });

    expect(res.status).toBe(403);
  });

  it('lists messages newest-first, cursor-paginated', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    for (const text of ['first', 'second', 'third']) {
      await request(app)
        .post(`/api/conversations/${conversation._id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'text', text });
    }

    const res = await request(app)
      .get(`/api/conversations/${conversation._id}/messages?limit=2`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].text).toBe('third');
    expect(res.body.meta.nextCursor).toEqual(expect.any(String));
  });

  it('sends a reaction to a delivered message and links it via replyToMessageId', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND', 'CHAT_REACTION']);

    const sent = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'text', text: 'React to me' });
    expect(sent.status).toBe(201);
    const targetId = sent.body.data.id;

    const reaction = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'reaction', reactToMessageId: targetId, emoji: '👍' });

    expect(reaction.status).toBe(201);
    expect(reaction.body.data.type).toBe('reaction');
    expect(reaction.body.data.text).toBe('👍');
    expect(reaction.body.data.replyToMessageId).toBe(targetId);
  });

  it('requires CHAT_REACTION to send a reaction', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']); // no CHAT_REACTION

    const sent = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'text', text: 'React to me' });

    const reaction = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'reaction', reactToMessageId: sent.body.data.id, emoji: '👍' });

    expect(reaction.status).toBe(403);
  });

  it('rejects reacting to a message that has not been delivered yet', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND', 'CHAT_REACTION']);

    // A random, never-sent id — never delivered, so it has no metaMessageId.
    const fakeId = String(conversation._id);
    const reaction = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'reaction', reactToMessageId: fakeId, emoji: '👍' });

    expect(reaction.status).toBe(400);
    expect(reaction.body.error.code).toBe('REACTION_TARGET_NOT_SENT');
  });

  it('a message send against another tenant\'s conversation 404s', async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');
    const { conversation } = await createTestChatFixture(String(tenantB._id));
    const tokenA = await tokenFor(String(tenantA._id), ['CHAT_READ', 'CHAT_SEND']);

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'text', text: 'hijack attempt' });
    expect(res.status).toBe(404);
  });
});
