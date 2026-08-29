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

describe('In-chat search and starring', () => {
  async function seed() {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);
    const base = `/api/conversations/${conversation._id}/messages`;

    for (const text of ['Invoice-2024 attached', 'Thanks!', 'My number is 9876543210']) {
      await request(app).post(base).set('Authorization', `Bearer ${token}`).send({ type: 'text', text });
    }
    return { token, base };
  }

  it('matches inside a word, not just whole words', async () => {
    const { token, base } = await seed();

    // The reason this uses a regex rather than a $text index: $text is
    // word-based and would miss both of these.
    const partial = await request(app).get(`${base}?search=voice`).set('Authorization', `Bearer ${token}`);
    expect(partial.body.data).toHaveLength(1);

    const digits = await request(app).get(`${base}?search=98765`).set('Authorization', `Bearer ${token}`);
    expect(digits.body.data).toHaveLength(1);
  });

  it('treats regex metacharacters in the query as literal text', async () => {
    const { token, base } = await seed();

    // Unescaped, ".*" would match every message in the conversation.
    const res = await request(app).get(`${base}?search=.*`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('stars a message, lists it under starredOnly, and unstars it', async () => {
    const { token, base } = await seed();
    const all = await request(app).get(base).set('Authorization', `Bearer ${token}`);
    const target = all.body.data[0];

    const starred = await request(app)
      .patch(`${base}/${target.id}/star`)
      .set('Authorization', `Bearer ${token}`)
      .send({ starred: true });
    expect(starred.status).toBe(200);
    expect(starred.body.data.starredAt).toBeTruthy();

    const list = await request(app).get(`${base}?starredOnly=true`).set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(target.id);

    await request(app)
      .patch(`${base}/${target.id}/star`)
      .set('Authorization', `Bearer ${token}`)
      .send({ starred: false });

    const after = await request(app).get(`${base}?starredOnly=true`).set('Authorization', `Bearer ${token}`);
    expect(after.body.data).toHaveLength(0);
  });

  it('re-starring keeps the original timestamp instead of bumping it', async () => {
    const { token, base } = await seed();
    const all = await request(app).get(base).set('Authorization', `Bearer ${token}`);
    const target = all.body.data[0];

    const first = await request(app)
      .patch(`${base}/${target.id}/star`)
      .set('Authorization', `Bearer ${token}`)
      .send({ starred: true });
    const second = await request(app)
      .patch(`${base}/${target.id}/star`)
      .set('Authorization', `Bearer ${token}`)
      .send({ starred: true });

    expect(second.body.data.starredAt).toBe(first.body.data.starredAt);
  });

  it("cannot star a message through another conversation's route", async () => {
    const tenant = await createTestTenant();
    const a = await createTestChatFixture(String(tenant._id));
    const b = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    const sent = await request(app)
      .post(`/api/conversations/${a.conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'text', text: 'belongs to conversation a' });

    const res = await request(app)
      .patch(`/api/conversations/${b.conversation._id}/messages/${sent.body.data.id}/star`)
      .set('Authorization', `Bearer ${token}`)
      .send({ starred: true });
    expect(res.status).toBe(404);
  });
});
