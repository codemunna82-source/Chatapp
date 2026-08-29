import request from 'supertest';
import { createApp } from '../../app';
import { env } from '../../config/env';

/**
 * Route-level, not just verifier-level: the unit tests prove the token
 * comparison is right, but the thing that actually breaks a Meta
 * subscription is the wiring around it — the route being reachable
 * unauthenticated, the challenge coming back as a bare body rather than
 * wrapped in the API's usual JSON envelope, and the response being exactly
 * the challenge Meta sent. All three are asserted here.
 */
describe('GET /api/webhooks/meta (Meta subscription challenge)', () => {
  const app = createApp();

  it('echoes hub.challenge verbatim, unauthenticated, as plain text', async () => {
    const res = await request(app).get('/api/webhooks/meta').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': env.META_VERIFY_TOKEN,
      'hub.challenge': '1158201444',
    });

    expect(res.status).toBe(200);
    // Meta compares this byte-for-byte — no JSON envelope, no quotes.
    expect(res.text).toBe('1158201444');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('rejects a wrong verify token with 403', async () => {
    const res = await request(app).get('/api/webhooks/meta').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'not-the-configured-token',
      'hub.challenge': '1158201444',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WEBHOOK_VERIFICATION_FAILED');
  });
});

describe('GET /api/webhooks/meta/health (configuration self-check)', () => {
  const app = createApp();

  it('reports which Meta credentials are present without exposing them', async () => {
    const res = await request(app).get('/api/webhooks/meta/health');

    expect(res.status).toBe(200);
    expect(res.body.data.verifyTokenConfigured).toBe(true);
    expect(res.body.data.appSecretConfigured).toBe(true);
    expect(res.body.data.callbackUrl).toMatch(/\/api\/webhooks\/meta$/);
    // No FCM service account in the test env, so this must report false
    // rather than being absent — an absent field reads as "old build".
    expect(res.body.data.pushConfigured).toBe(false);

    // The whole point of the endpoint is that it is safe to curl publicly.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(env.META_VERIFY_TOKEN);
    expect(serialized).not.toContain(env.META_APP_SECRET);
  });
});
