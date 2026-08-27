import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';
import { Contact } from '../contacts/contact.model';

useMongoMemoryServer();
const app = createApp();

async function tokenFor(tenantId: string, permissions: string[]) {
  const user = await createTestUser({ tenantId, email: `u-${Date.now()}-${Math.random()}@voxo.test`, permissions: permissions as never });
  return signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });
}

describe('Calls REST', () => {
  it('initiates a call: logs it and returns a real wa.me deep link', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const contact = await Contact.create({ tenantId, phone: '+14155551234', name: 'Jordan Lee' });
    const token = await tokenFor(tenantId, ['CALL_ACCESS']);

    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(contact._id) });

    expect(res.status).toBe(201);
    expect(res.body.data.deepLink).toBe('https://wa.me/14155551234');
    expect(res.body.data.call.status).toBe('INITIATED');
    expect(res.body.data.call.direction).toBe('OUTBOUND');
    expect(res.body.data.call.contact.name).toBe('Jordan Lee');
  });

  it('404s when the contact does not exist in this tenant', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id), ['CALL_ACCESS']);

    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONTACT_NOT_FOUND');
  });

  it('requires CALL_ACCESS to initiate a call', async () => {
    const tenant = await createTestTenant();
    const contact = await Contact.create({ tenantId: String(tenant._id), phone: '+14155559999' });
    const token = await tokenFor(String(tenant._id), []);

    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(contact._id) });
    expect(res.status).toBe(403);
  });

  it('requires CALL_HISTORY to list calls, and lists tenant-scoped history', async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');
    const contactA = await Contact.create({ tenantId: String(tenantA._id), phone: '+14155550001' });
    const contactB = await Contact.create({ tenantId: String(tenantB._id), phone: '+14155550002' });
    const tokenA = await tokenFor(String(tenantA._id), ['CALL_ACCESS', 'CALL_HISTORY']);
    const tokenB = await tokenFor(String(tenantB._id), ['CALL_ACCESS']);

    await request(app).post('/api/calls').set('Authorization', `Bearer ${tokenA}`).send({ contactId: String(contactA._id) });
    await request(app).post('/api/calls').set('Authorization', `Bearer ${tokenB}`).send({ contactId: String(contactB._id) });

    const list = await request(app).get('/api/calls').set('Authorization', `Bearer ${tokenA}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].contact.phone).toBe('+14155550001');

    const noPermission = await tokenFor(String(tenantA._id), []);
    const denied = await request(app).get('/api/calls').set('Authorization', `Bearer ${noPermission}`);
    expect(denied.status).toBe(403);
  });
});
