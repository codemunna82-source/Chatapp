/**
 * The shape of the message FCM is actually sent.
 *
 * This is worth a test precisely because getting it wrong is silent: a
 * misspelt key inside `webpush` is not rejected, the request succeeds, and
 * the notification simply never appears on anyone's phone. There is no
 * error anywhere to notice.
 */
jest.mock('axios');
jest.mock('jsonwebtoken', () => ({ sign: () => 'signed.jwt.token' }));

import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

const SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'voxo-test',
  client_email: 'push@voxo-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----\\n',
});

/** Loads the gateway with a service account present, isolated per test. */
async function loadGateway() {
  process.env.FCM_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT;
  let gateway: typeof import('./client').fcmGateway;
  await jest.isolateModulesAsync(async () => {
    ({ fcmGateway: gateway } = await import('./client'));
  });
  return gateway!;
}

/** The body of the messages:send call, which is the thing under test. */
function sentMessage(): Record<string, any> {
  const call = mockedAxios.post.mock.calls.find(([url]) => String(url).includes('messages:send'));
  if (!call) throw new Error('no FCM send was made');
  return (call[1] as { message: Record<string, any> }).message;
}

beforeEach(() => {
  mockedAxios.post.mockReset();
  mockedAxios.post.mockImplementation(async (url: string) =>
    String(url).includes('oauth2')
      ? { data: { access_token: 'access-token', expires_in: 3600 } }
      : { data: {} },
  );
});

describe('fcmGateway web push', () => {
  it('carries a webpush block beside the android one', async () => {
    const gateway = await loadGateway();
    await gateway.send(['browser-token'], {
      title: 'RK Enterprises',
      body: 'Your order shipped',
      collapseKey: 'guest:c1',
      data: { type: 'message', conversationId: 'c1' },
      link: 'https://chat.example/c/abc',
    });

    const message = sentMessage();
    // Both platforms on one message: FCM applies only the block matching
    // the token, so the caller never has to know what it is notifying.
    expect(message.android).toBeDefined();
    expect(message.webpush.notification.title).toBe('RK Enterprises');
    expect(message.webpush.notification.body).toBe('Your order shipped');
    // The tag is what makes ten replies one entry instead of ten.
    expect(message.webpush.notification.tag).toBe('guest:c1');
    expect(message.webpush.fcmOptions.link).toBe('https://chat.example/c/abc');
    expect(message.webpush.data).toEqual({ type: 'message', conversationId: 'c1' });
  });

  it('lets a message notification fade and keeps a ring on screen', async () => {
    const gateway = await loadGateway();

    await gateway.send(['t'], { title: 'a', body: 'b' });
    expect(sentMessage().webpush.notification.requireInteraction).toBe(false);
    // A day is right for a message the customer will read later.
    expect(sentMessage().webpush.headers.TTL).toBe('86400');

    mockedAxios.post.mockClear();
    await gateway.send(['t'], { title: 'a', body: 'b', requireInteraction: true });
    expect(sentMessage().webpush.notification.requireInteraction).toBe(true);
    // A ring delivered ten minutes late is worse than not delivered: the
    // call is long over and the customer calls back into silence.
    expect(sentMessage().webpush.headers.TTL).toBe('60');
  });

  it('omits fcmOptions rather than sending an empty link', async () => {
    const gateway = await loadGateway();
    await gateway.send(['t'], { title: 'a', body: 'b' });
    // FCM rejects fcm_options with no link, which would fail the send for
    // every notification that has no chat URL to offer.
    expect(sentMessage().webpush.fcmOptions).toBeUndefined();
  });
});
