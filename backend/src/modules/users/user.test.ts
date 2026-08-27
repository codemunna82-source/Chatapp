import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';

const app = createApp();

async function masterAdminToken(tenantId: string) {
  const admin = await createTestUser({ tenantId, email: `admin-${Date.now()}@voxo.test`, role: 'MASTER_ADMIN' });
  return signAccessToken({ sub: String(admin._id), tenantId, role: 'MASTER_ADMIN' });
}

describe('Users module — RBAC', () => {
  it('MASTER_ADMIN can create a SUB_USER with specific permissions and a validity window', async () => {
    const tenant = await createTestTenant();
    const token = await masterAdminToken(String(tenant._id));

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'sub@voxo.test',
        password: 'Password123!',
        role: 'SUB_USER',
        permissions: ['CHAT_READ', 'CHAT_SEND'],
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('SUB_USER');
    expect(res.body.data.permissions).toEqual(['CHAT_READ', 'CHAT_SEND']);
  });

  it('rejects creating a user with validUntil before validFrom', async () => {
    const tenant = await createTestTenant();
    const token = await masterAdminToken(String(tenant._id));

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'bad-window@voxo.test',
        password: 'Password123!',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() - 1000).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_VALIDITY_WINDOW');
  });

  it('SUB_USER cannot access user management endpoints (MASTER_ADMIN-only)', async () => {
    const tenant = await createTestTenant();
    const subUser = await createTestUser({ tenantId: String(tenant._id), email: 'plain@voxo.test', role: 'SUB_USER' });
    const token = signAccessToken({ sub: String(subUser._id), tenantId: String(tenant._id), role: 'SUB_USER' });

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('rejects a duplicate email', async () => {
    const tenant = await createTestTenant();
    const token = await masterAdminToken(String(tenant._id));
    await createTestUser({ tenantId: String(tenant._id), email: 'dupe@voxo.test' });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'dupe@voxo.test',
        password: 'Password123!',
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('DELETE soft-disables a user rather than removing the record', async () => {
    const tenant = await createTestTenant();
    const token = await masterAdminToken(String(tenant._id));
    const target = await createTestUser({ tenantId: String(tenant._id), email: 'todisable@voxo.test' });

    const res = await request(app).delete(`/api/users/${target._id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DISABLED');

    const stillThere = await request(app)
      .get(`/api/users/${target._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.data.status).toBe('DISABLED');
  });
});
