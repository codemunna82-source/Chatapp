import request from 'supertest';
import { createApp } from '../../app';

/**
 * No database: this page renders nothing from the database, which is what
 * makes it testable here and also what keeps it cheap to serve.
 */
const app = createApp();

describe('GET /api/guest/console', () => {
  it('serves the page without a link token', async () => {
    // It sits in front of requireGuest on purpose — it is the thing that
    // produces a token, so demanding one would be circular.
    const res = await request(app).get('/api/guest/console');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Web chat link');
  });

  it('loads its script from a URL instead of inlining it', async () => {
    // Helmet sends script-src 'self' on every response, so an inline
    // <script> is refused by the browser: the page renders and every
    // button silently does nothing. This is the assertion that would have
    // caught that before anyone opened the page.
    const res = await request(app).get('/api/guest/console');

    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.text).toContain('<script src="/api/guest/console.js"></script>');
    expect(res.text).not.toMatch(/<script>[^<]/);
  });

  it('serves that script as JavaScript', async () => {
    const res = await request(app).get('/api/guest/console.js');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('/api/auth/login');
    expect(res.text).toContain('/api/conversations/guest-link');
  });

  it('ships no credentials or token of its own', async () => {
    // The page authenticates as the admin who is using it and nothing
    // else; anything baked in here would be a secret served to the public.
    const page = await request(app).get('/api/guest/console');
    const script = await request(app).get('/api/guest/console.js');

    for (const body of [page.text, script.text]) {
      expect(body).not.toMatch(/JWT_ACCESS_SECRET|META_APP_SECRET|Bearer [A-Za-z0-9._-]{20,}/);
    }
  });

  it('keeps the access token out of persistent storage', async () => {
    // A token left in localStorage outlives the reason it was created, on
    // a page meant for occasional manual use. Matched as a property
    // access, not as a word, so the comment explaining the rule does not
    // fail the rule.
    const script = await request(app).get('/api/guest/console.js');

    expect(script.text).not.toMatch(/localStorage\s*[.[]/);
    expect(script.text).not.toMatch(/sessionStorage\s*[.[]/);
  });

  it('still refuses the guest routes behind it without a token', async () => {
    // Registering the page before the auth middleware must not have
    // exempted anything else on the router.
    const res = await request(app).get('/api/guest/session');
    expect(res.status).toBe(401);
  });
});
