import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser, createTestChatFixture } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';

useMongoMemoryServer();
const app = createApp();

async function tokenFor(tenantId: string, permissions: string[] = ['CHAT_READ']) {
  const user = await createTestUser({ tenantId, email: `u-${Date.now()}-${Math.random()}@voxo.test`, permissions: permissions as never });
  return signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });
}

describe('Conversations REST', () => {
  it('lists conversations enriched with contact info and the 24h-window flag', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id));

    const res = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(String(conversation._id));
    expect(res.body.data[0].contact.phone).toBe('+15550001234');
    expect(res.body.data[0].withinCustomerServiceWindow).toBe(true);
  });

  it('a conversation outside the 24h window reports withinCustomerServiceWindow: false', async () => {
    const tenant = await createTestTenant();
    await createTestChatFixture(String(tenant._id), { withinWindow: false });
    const token = await tokenFor(String(tenant._id));

    const res = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.body.data[0].withinCustomerServiceWindow).toBe(false);
  });

  it('pinning requires CHAT_PIN even for a user with CHAT_READ', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ']);

    const denied = await request(app)
      .patch(`/api/conversations/${conversation._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pinned: true });
    expect(denied.status).toBe(403);

    const tokenWithPin = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_PIN']);
    const allowed = await request(app)
      .patch(`/api/conversations/${conversation._id}`)
      .set('Authorization', `Bearer ${tokenWithPin}`)
      .send({ pinned: true });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.pinned).toBe(true);
  });

  it('tenant A cannot read tenant B\'s conversation', async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');
    const { conversation } = await createTestChatFixture(String(tenantB._id));
    const tokenA = await tokenFor(String(tenantA._id));

    const res = await request(app)
      .get(`/api/conversations/${conversation._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it('search only returns conversations for matching contacts', async () => {
    const tenant = await createTestTenant();
    await createTestChatFixture(String(tenant._id), { contactPhone: '+14155550001' });
    await createTestChatFixture(String(tenant._id), { contactPhone: '+14155550002' });
    const token = await tokenFor(String(tenant._id));

    const res = await request(app).get('/api/conversations?search=0001').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].contact.phone).toBe('+14155550001');
  });
});

describe('Mark as unread', () => {
  it('marks a read chat unread without inventing an unread count', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    const res = await request(app)
      .patch(`/api/conversations/${conversation._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ manuallyUnread: true });

    expect(res.status).toBe(200);
    expect(res.body.data.manuallyUnread).toBe(true);
    // The regression this guards: bumping unreadCount to 1 would make the
    // badge claim one unread message that does not exist.
    expect(res.body.data.unreadCount).toBe(0);
  });

  it('rejects manuallyUnread: false — clearing it is what opening the chat does', async () => {
    const tenant = await createTestTenant();
    const { conversation } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    const res = await request(app)
      .patch(`/api/conversations/${conversation._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ manuallyUnread: false });

    expect(res.status).toBe(400);
  });
});

describe('Bulk conversation actions', () => {
  async function seedChats(tenantId: string, count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const { conversation } = await createTestChatFixture(tenantId, { contactPhone: `+1415555${1000 + i}` });
      ids.push(String(conversation._id));
    }
    return ids;
  }

  it('archives a selection in one request', async () => {
    const tenant = await createTestTenant();
    const ids = await seedChats(String(tenant._id), 3);
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    const res = await request(app)
      .post('/api/conversations/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids, action: 'archive' });

    expect(res.status).toBe(200);
    expect(res.body.data.affected).toBe(3);

    const archived = await request(app)
      .get('/api/conversations?status=ARCHIVED')
      .set('Authorization', `Bearer ${token}`);
    expect(archived.body.data).toHaveLength(3);
  });

  it('deletes a selection and its messages', async () => {
    const tenant = await createTestTenant();
    const ids = await seedChats(String(tenant._id), 2);
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    await request(app)
      .post(`/api/conversations/${ids[0]}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'text', text: 'should not survive the delete' });

    const res = await request(app)
      .post('/api/conversations/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids, action: 'delete' });
    expect(res.body.data.affected).toBe(2);

    const remaining = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(remaining.body.data).toHaveLength(0);
  });

  it("skips ids from another tenant instead of touching them", async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');
    const idsA = await seedChats(String(tenantA._id), 1);
    const idsB = await seedChats(String(tenantB._id), 1);
    const tokenA = await tokenFor(String(tenantA._id), ['CHAT_READ', 'CHAT_SEND']);

    const res = await request(app)
      .post('/api/conversations/bulk')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ids: [...idsA, ...idsB], action: 'delete' });

    // Two requested, only the one this tenant owns affected — and the count
    // reported back says so rather than claiming both.
    expect(res.body.data.affected).toBe(1);

    const tokenB = await tokenFor(String(tenantB._id), ['CHAT_READ']);
    const survivorsB = await request(app).get('/api/conversations').set('Authorization', `Bearer ${tokenB}`);
    expect(survivorsB.body.data).toHaveLength(1);
  });

  it('caps the batch size', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id), ['CHAT_READ', 'CHAT_SEND']);

    const res = await request(app)
      .post('/api/conversations/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: Array.from({ length: 201 }, (_, i) => `id-${i}`), action: 'archive' });

    expect(res.status).toBe(400);
  });

  it('requires CHAT_SEND, not just CHAT_READ', async () => {
    const tenant = await createTestTenant();
    const ids = await seedChats(String(tenant._id), 1);
    const readOnly = await tokenFor(String(tenant._id), ['CHAT_READ']);

    const res = await request(app)
      .post('/api/conversations/bulk')
      .set('Authorization', `Bearer ${readOnly}`)
      .send({ ids, action: 'archive' });
    expect(res.status).toBe(403);
  });
});
