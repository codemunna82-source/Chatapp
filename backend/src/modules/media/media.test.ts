import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser, createTestChatFixture } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';

useMongoMemoryServer();
const app = createApp();

async function tokenFor(tenantId: string, permissions: string[]) {
  const user = await createTestUser({ tenantId, email: `u-${Date.now()}-${Math.random()}@voxo.test`, permissions: permissions as never });
  return signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });
}

describe('Media REST', () => {
  it('uploads a file (mock Meta gateway) and then retrieves its bytes', async () => {
    const tenant = await createTestTenant();
    const { phoneNumber } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_MEDIA']);

    const upload = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('whatsappPhoneNumberId', String(phoneNumber._id))
      .attach('file', Buffer.from('fake-jpeg-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(upload.status).toBe(201);
    expect(upload.body.data.status).toBe('READY');
    const mediaId = upload.body.data.id;

    const get = await request(app).get(`/api/media/${mediaId}`).set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toContain('application/octet-stream'); // mock gateway's fixed mime type
    expect(get.body.length).toBeGreaterThan(0);
  });

  it('rejects an unsupported MIME type', async () => {
    const tenant = await createTestTenant();
    const { phoneNumber } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), ['CHAT_MEDIA']);

    const upload = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('whatsappPhoneNumberId', String(phoneNumber._id))
      .attach('file', Buffer.from('exe content'), { filename: 'app.exe', contentType: 'application/x-msdownload' });

    expect(upload.status).toBe(400);
    expect(upload.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('requires CHAT_MEDIA to upload', async () => {
    const tenant = await createTestTenant();
    const { phoneNumber } = await createTestChatFixture(String(tenant._id));
    const token = await tokenFor(String(tenant._id), []); // no CHAT_MEDIA

    const upload = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('whatsappPhoneNumberId', String(phoneNumber._id))
      .attach('file', Buffer.from('fake-jpeg-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(upload.status).toBe(403);
  });

  it('tenant A cannot retrieve tenant B\'s media', async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');
    const { phoneNumber } = await createTestChatFixture(String(tenantB._id));
    const tokenB = await tokenFor(String(tenantB._id), ['CHAT_MEDIA']);
    const tokenA = await tokenFor(String(tenantA._id), ['CHAT_MEDIA']);

    const upload = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${tokenB}`)
      .field('whatsappPhoneNumberId', String(phoneNumber._id))
      .attach('file', Buffer.from('fake-jpeg-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    const get = await request(app)
      .get(`/api/media/${upload.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(get.status).toBe(404);
  });
});
