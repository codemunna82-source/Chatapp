import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';

useMongoMemoryServer();
const app = createApp();

async function tokenFor(tenantId: string, permissions: string[] = ['CHAT_READ', 'CHAT_SEND']) {
  const user = await createTestUser({
    tenantId,
    email: `qr-${Date.now()}-${Math.random()}@voxo.test`,
    permissions: permissions as never,
  });
  return signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });
}

describe('Quick replies REST', () => {
  it('creates, lists and deletes a saved reply', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id));

    const create = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Price list', body: 'Our current pricing is attached.' });
    expect(create.status).toBe(201);
    expect(create.body.data.useCount).toBe(0);

    const list = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const del = await request(app)
      .delete(`/api/quick-replies/${create.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const after = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${token}`);
    expect(after.body.data).toHaveLength(0);
  });

  it('rejects a duplicate title with a conflict rather than a 500', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id));
    const payload = { title: 'Working hours', body: 'Mon-Sat, 10am to 7pm.' };

    await request(app).post('/api/quick-replies').set('Authorization', `Bearer ${token}`).send(payload);
    const second = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('QUICK_REPLY_EXISTS');
  });

  it('orders by use count so the most-used reply comes first', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id));

    const rare = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Aardvark', body: 'Rarely used, but alphabetically first.' });
    const common = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Zebra', body: 'Used constantly, alphabetically last.' });

    await request(app)
      .post(`/api/quick-replies/${common.body.data.id}/use`)
      .set('Authorization', `Bearer ${token}`);

    const list = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${token}`);
    // Alphabetical order would put Aardvark first — this asserts usage wins.
    expect(list.body.data[0].id).toBe(common.body.data.id);
    expect(list.body.data[1].id).toBe(rare.body.data.id);
  });

  it("does not expose another tenant's saved replies", async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');
    const tokenA = await tokenFor(String(tenantA._id));
    const tokenB = await tokenFor(String(tenantB._id));

    const created = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Internal', body: "Tenant A's wording." });

    const listB = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.data).toHaveLength(0);

    const deleteAcrossTenants = await request(app)
      .delete(`/api/quick-replies/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(deleteAcrossTenants.status).toBe(404);
  });

  it('requires CHAT_SEND to create, but only CHAT_READ to list', async () => {
    const tenant = await createTestTenant();
    const readOnly = await tokenFor(String(tenant._id), ['CHAT_READ']);

    const list = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${readOnly}`);
    expect(list.status).toBe(200);

    const create = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${readOnly}`)
      .send({ title: 'Nope', body: 'Should not be allowed.' });
    expect(create.status).toBe(403);
  });
});
