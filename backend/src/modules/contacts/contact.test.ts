import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';

useMongoMemoryServer();
const app = createApp();

async function tokenFor(tenantId: string, permissions: string[] = ['CHAT_READ', 'CHAT_SEND']) {
  const user = await createTestUser({ tenantId, email: `u-${Date.now()}-${Math.random()}@voxo.test`, permissions: permissions as never });
  return signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });
}

describe('Contacts REST', () => {
  it('creates and fetches a contact', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id));

    const create = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+14155551234', name: 'Jordan Lee' });
    expect(create.status).toBe(201);
    expect(create.body.data.phone).toBe('+14155551234');

    const get = await request(app)
      .get(`/api/contacts/${create.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.data.name).toBe('Jordan Lee');
  });

  it('rejects a non-E.164 phone number', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id));

    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '555-1234' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate phone within the same tenant', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id));
    await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({ phone: '+14155559999' });

    const dupe = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+14155559999' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('CONTACT_ALREADY_EXISTS');
  });

  it('a SUB_USER without CHAT_READ cannot list contacts', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id), []);

    const res = await request(app).get('/api/contacts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('search filters by name/phone substring', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id));
    await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({ phone: '+14155550001', name: 'Alex Rivera' });
    await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({ phone: '+14155550002', name: 'Sam Patel' });

    const res = await request(app).get('/api/contacts?search=Alex').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Alex Rivera');
  });
});
