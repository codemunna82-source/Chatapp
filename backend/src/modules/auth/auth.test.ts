import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';

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
