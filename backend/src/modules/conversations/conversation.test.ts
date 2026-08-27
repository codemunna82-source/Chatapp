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
