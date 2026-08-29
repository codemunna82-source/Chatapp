import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser, createTestChatFixture } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';
import { Message } from '../messages/message.model';
import { resetDashboardCache } from './dashboard.service';

useMongoMemoryServer();
const app = createApp();

describe('Dashboard REST', () => {
  // The summary is cached per tenant for 30s (see dashboard.service.ts).
  // Tenants are freshly created per test so a collision is unlikely, but
  // an assertion that silently reads a cached rollup is the kind of test
  // failure that costs an afternoon.
  beforeEach(() => resetDashboardCache());

  it('aggregates tenant-scoped counts only', async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');
    const tenantIdA = String(tenantA._id);
    const tenantIdB = String(tenantB._id);

    const { conversation: convoA } = await createTestChatFixture(tenantIdA);
    const { conversation: convoB } = await createTestChatFixture(tenantIdB);

    await Message.create({
      tenantId: tenantIdA,
      conversationId: convoA._id,
      recipientPhone: '+15550001234',
      direction: 'OUT',
      type: 'text',
      text: 'hi',
      status: 'SENT',
    });
    await Message.create({
      tenantId: tenantIdB,
      conversationId: convoB._id,
      recipientPhone: '+15550001234',
      direction: 'OUT',
      type: 'text',
      text: 'should not count for tenant A',
      status: 'SENT',
    });

    const user = await createTestUser({
      tenantId: tenantIdA,
      email: `u-${Date.now()}@voxo.test`,
      permissions: ['ANALYTICS_VIEW'],
    });
    const token = signAccessToken({ sub: String(user._id), tenantId: tenantIdA, role: 'SUB_USER' });

    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.contactsTotal).toBe(1);
    expect(res.body.data.conversations.open).toBe(1);
    expect(res.body.data.messages.sentTotal).toBe(1);
    expect(Array.isArray(res.body.data.messagesByDay)).toBe(true);
  });

  it('requires ANALYTICS_VIEW', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser({ tenantId: String(tenant._id), email: `u-${Date.now()}@voxo.test`, permissions: [] });
    const token = signAccessToken({ sub: String(user._id), tenantId: String(tenant._id), role: 'SUB_USER' });

    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
