import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';
import { createNotification } from './notification.repository';

useMongoMemoryServer();
const app = createApp();

describe('Notifications REST', () => {
  it('lists only the caller\'s own notifications and can mark one read', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const user = await createTestUser({ tenantId, email: `u-${Date.now()}@voxo.test` });
    const otherUser = await createTestUser({ tenantId, email: `other-${Date.now()}@voxo.test` });
    const token = signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });

    const mine = await createNotification({
      tenantId,
      userId: String(user._id),
      type: 'MESSAGE_RECEIVED',
      title: 'New message',
      body: 'You have a new message',
    });
    await createNotification({
      tenantId,
      userId: String(otherUser._id),
      type: 'MESSAGE_RECEIVED',
      title: 'Not mine',
      body: 'Belongs to someone else',
    });

    const list = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].title).toBe('New message');

    const markRead = await request(app)
      .patch(`/api/notifications/${String(mine._id)}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(markRead.status).toBe(200);
    expect(markRead.body.data.readAt).not.toBeNull();
  });

  it('cannot mark another user\'s notification read', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const user = await createTestUser({ tenantId, email: `u-${Date.now()}@voxo.test` });
    const otherUser = await createTestUser({ tenantId, email: `other-${Date.now()}@voxo.test` });
    const token = signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });

    const theirs = await createNotification({
      tenantId,
      userId: String(otherUser._id),
      type: 'SYSTEM',
      title: 'Not yours',
      body: 'x',
    });

    const res = await request(app)
      .patch(`/api/notifications/${String(theirs._id)}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('read-all marks every unread notification for the caller as read', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const user = await createTestUser({ tenantId, email: `u-${Date.now()}@voxo.test` });
    const token = signAccessToken({ sub: String(user._id), tenantId, role: 'SUB_USER' });

    await createNotification({ tenantId, userId: String(user._id), type: 'SYSTEM', title: 'A', body: 'a' });
    await createNotification({ tenantId, userId: String(user._id), type: 'SYSTEM', title: 'B', body: 'b' });

    const res = await request(app).post('/api/notifications/read-all').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(2);

    const unread = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${token}`);
    expect(unread.body.data).toHaveLength(0);
  });
});
