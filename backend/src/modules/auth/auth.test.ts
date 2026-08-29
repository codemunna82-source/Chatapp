import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';
import { useMongoMemoryServer } from '../../../test/withMongo';
import { signAccessToken } from '../../lib/jwt';
import { User } from '../users/user.model';

useMongoMemoryServer();
const app = createApp();

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials and returns access + refresh tokens', async () => {
    const tenant = await createTestTenant();
    await createTestUser({ tenantId: String(tenant._id), email: 'admin@voxo.test', password: 'Password123!' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@voxo.test', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe('admin@voxo.test');
  });

  it('rejects an incorrect password without leaking which field was wrong', async () => {
    const tenant = await createTestTenant();
    await createTestUser({ tenantId: String(tenant._id), email: 'admin2@voxo.test', password: 'Password123!' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin2@voxo.test', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login for a disabled account', async () => {
    const tenant = await createTestTenant();
    await createTestUser({
      tenantId: String(tenant._id),
      email: 'disabled@voxo.test',
      status: 'DISABLED',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'disabled@voxo.test', password: 'Password123!' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('rejects login for an expired subscription window', async () => {
    const tenant = await createTestTenant();
    const past = new Date();
    past.setDate(past.getDate() - 30);
    const alsoPast = new Date();
    alsoPast.setDate(alsoPast.getDate() - 1);
    await createTestUser({
      tenantId: String(tenant._id),
      email: 'expired@voxo.test',
      validFrom: past,
      validUntil: alsoPast,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'expired@voxo.test', password: 'Password123!' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and detects reuse of a superseded one', async () => {
    const tenant = await createTestTenant();
    await createTestUser({ tenantId: String(tenant._id), email: 'rotate@voxo.test', password: 'Password123!' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rotate@voxo.test', password: 'Password123!' });
    const firstRefreshToken = login.body.data.refreshToken as string;

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: firstRefreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).not.toBe(firstRefreshToken);

    // Reusing the now-rotated-away token must fail and invalidate the family.
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: firstRefreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // The token issued by the (now-revoked-due-to-reuse) rotation should also stop working.
    const secondRefreshToken = refreshed.body.data.refreshToken as string;
    const afterReuse = await request(app).post('/api/auth/refresh').send({ refreshToken: secondRefreshToken });
    expect(afterReuse.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('requires the current password and revokes other sessions', async () => {
    const tenant = await createTestTenant();
    await createTestUser({ tenantId: String(tenant._id), email: 'change@voxo.test', password: 'Password123!' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'change@voxo.test', password: 'Password123!' });
    const accessToken = login.body.data.accessToken as string;

    const wrongCurrent = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'NotItPassword!', newPassword: 'NewPassword456!' });
    expect(wrongCurrent.status).toBe(401);

    const ok = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' });
    expect(ok.status).toBe(200);

    const loginWithNewPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'change@voxo.test', password: 'NewPassword456!' });
    expect(loginWithNewPassword.status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  it("returns the user's CURRENT role, not the one baked into the token", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser({
      tenantId: String(tenant._id),
      email: `promote-${Date.now()}@voxo.test`,
      role: 'SUB_USER',
    });
    // A token issued while they were a SUB_USER — the stale snapshot the
    // app used to be stuck with.
    const token = signAccessToken({ sub: String(user._id), tenantId: String(tenant._id), role: 'SUB_USER' });

    await User.updateOne({ _id: user._id }, { $set: { role: 'MASTER_ADMIN' } });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // This is the whole point: the JWT still says SUB_USER.
    expect(res.body.data.role).toBe('MASTER_ADMIN');
  });

  it('reflects a permission granted after the token was issued', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser({
      tenantId: String(tenant._id),
      email: `perm-${Date.now()}@voxo.test`,
      permissions: ['CHAT_READ'],
    });
    const token = signAccessToken({ sub: String(user._id), tenantId: String(tenant._id), role: 'SUB_USER' });

    await User.updateOne({ _id: user._id }, { $set: { permissions: ['CHAT_READ', 'CHAT_SEND'] } });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.permissions).toContain('CHAT_SEND');
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it("401s once the account is gone, rather than serving a token's claims", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser({ tenantId: String(tenant._id), email: `gone-${Date.now()}@voxo.test` });
    const token = signAccessToken({ sub: String(user._id), tenantId: String(tenant._id), role: 'SUB_USER' });

    await User.deleteOne({ _id: user._id });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
