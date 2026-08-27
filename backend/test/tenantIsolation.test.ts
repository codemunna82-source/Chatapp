import request from 'supertest';
import { createApp } from '../src/app';
import { createTestTenant, createTestUser } from './helpers';
import { signAccessToken } from '../src/lib/jwt';

const app = createApp();

/**
 * Mandatory test (spec §13, §40): a user authenticated for Tenant A must
 * never be able to read or write Tenant B's data, even when they know (or
 * guess) Tenant B's resource IDs.
 */
describe('Tenant isolation', () => {
  it('cannot list, read, update, or disable another tenant\'s users', async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');

    const adminA = await createTestUser({
      tenantId: String(tenantA._id),
      email: 'admin-a@voxo.test',
      role: 'MASTER_ADMIN',
    });
    const userB = await createTestUser({
      tenantId: String(tenantB._id),
      email: 'user-b@voxo.test',
      role: 'SUB_USER',
    });

    const tokenA = signAccessToken({
      sub: String(adminA._id),
      tenantId: String(tenantA._id),
      role: 'MASTER_ADMIN',
    });

    // Direct fetch of Tenant B's user by id, authenticated as Tenant A's admin.
    const getRes = await request(app)
      .get(`/api/users/${userB._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(getRes.status).toBe(404); // not 403 — existence of the resource isn't confirmed either

    // List must never include Tenant B's user.
    const listRes = await request(app).get('/api/users').set('Authorization', `Bearer ${tokenA}`);
    expect(listRes.status).toBe(200);
    const emails = (listRes.body.data as Array<{ email: string }>).map((u) => u.email);
    expect(emails).not.toContain('user-b@voxo.test');

    // Update attempt against Tenant B's user must not succeed.
    const patchRes = await request(app)
      .patch(`/api/users/${userB._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ displayName: 'Hijacked' });
    expect(patchRes.status).toBe(404);

    // Disable attempt against Tenant B's user must not succeed.
    const deleteRes = await request(app)
      .delete(`/api/users/${userB._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(deleteRes.status).toBe(404);

    // Prove Tenant B's user is untouched.
    const stillActive = await request(app)
      .get(`/api/users/${userB._id}`)
      .set('Authorization', `Bearer ${signAccessToken({ sub: String(userB._id), tenantId: String(tenantB._id), role: 'SUB_USER' })}`);
    // A SUB_USER isn't MASTER_ADMIN so this specific call 403s — the point is
    // it never 500s or reveals cross-tenant state; re-fetch via Tenant B's
    // own admin instead to confirm data integrity:
    expect([403, 404]).toContain(stillActive.status);

    const adminB = await createTestUser({
      tenantId: String(tenantB._id),
      email: 'admin-b@voxo.test',
      role: 'MASTER_ADMIN',
    });
    const tokenB = signAccessToken({ sub: String(adminB._id), tenantId: String(tenantB._id), role: 'MASTER_ADMIN' });
    const confirm = await request(app)
      .get(`/api/users/${userB._id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.displayName).not.toBe('Hijacked');
    expect(confirm.body.data.status).toBe('ACTIVE');
  });

  it('rejects a JWT whose tenantId does not match the user\'s actual tenant', async () => {
    const tenantA = await createTestTenant('Tenant A2');
    const tenantB = await createTestTenant('Tenant B2');
    const userA = await createTestUser({ tenantId: String(tenantA._id), email: 'swap@voxo.test', role: 'MASTER_ADMIN' });

    // Forged token: real user id, but claims to belong to a different tenant.
    const forgedToken = signAccessToken({ sub: String(userA._id), tenantId: String(tenantB._id), role: 'MASTER_ADMIN' });

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${forgedToken}`);
    // The tenant-scoped lookup (User.findOne({_id, tenantId})) finds nothing,
    // so this must be rejected as unauthenticated, not silently scoped wrong.
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});
