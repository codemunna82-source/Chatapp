import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';
import { createSubscription } from './subscription.repository';

useMongoMemoryServer();
const app = createApp();

async function tokenFor(tenantId: string, role: 'MASTER_ADMIN' | 'SUB_USER' = 'MASTER_ADMIN') {
  const user = await createTestUser({ tenantId, email: `u-${Date.now()}-${Math.random()}@voxo.test`, role });
  return signAccessToken({ sub: String(user._id), tenantId, role });
}

describe('Subscription REST', () => {
  it('returns the live-computed status for the current plan', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const now = new Date();
    await createSubscription({
      tenantId,
      plan: 'PRO',
      validFrom: now,
      validUntil: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
    });
    const token = await tokenFor(tenantId);

    const res = await request(app).get('/api/subscription').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe('PRO');
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('reports EXPIRED once validUntil has passed, regardless of the stored cached status', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await createSubscription({ tenantId, plan: 'BASIC', validFrom: past, validUntil: new Date(Date.now() - 1000) });
    const token = await tokenFor(tenantId);

    const res = await request(app).get('/api/subscription').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('EXPIRED');
  });

  it('404s when no subscription record exists yet', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id));

    const res = await request(app).get('/api/subscription').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('a SUB_USER cannot view the tenant subscription', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id), 'SUB_USER');

    const res = await request(app).get('/api/subscription').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
