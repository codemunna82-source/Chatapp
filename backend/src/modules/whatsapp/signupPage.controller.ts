import type { Request, Response } from 'express';
import { env } from '../../config/env';

/**
 * Escapes a value for embedding inside a JavaScript string literal.
 *
 * U+2028 and U+2029 are the ones that are easy to miss: they are legal
 * inside a JSON string but terminate a line in JavaScript source, so a
 * value containing one silently breaks the script rather than producing a
 * visible error.
 */
function jsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Escapes a value for HTML text content. */
function htmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The public origin this request arrived on, for building the redirect URI. */
function publicOrigin(req: Request): string {
  const host = req.get('host') ?? '';
  // Render terminates TLS in front of the app, so req.protocol is http
  // there. The redirect URI must be the https one Meta has allow-listed.
  const proto = req.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

const SHELL_STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 16px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #ffffff; color: #111b21; padding: 24px; text-align: center;
  }
  @media (prefers-color-scheme: dark) { body { background: #0b141a; color: #e9edef; } }
  a.btn {
    display: block; text-decoration: none;
    font: inherit; font-weight: 600; color: #fff; background: #1877f2;
    border-radius: 10px; padding: 15px 22px; margin: 20px auto 0; max-width: 320px;
  }
  .muted { opacity: .7; font-size: 14px; }
  .error { color: #c62828; }
`;

/**
 * Starts Embedded Signup by sending the whole WebView to Facebook.
 *
 * Deliberately *not* the JavaScript SDK's `FB.login()`. That opens a popup
 * window and waits on its handle — and a React Native WebView has no
 * popups, so `window.open` returns null and the SDK stalls with no error
 * at all. The button simply did nothing, which is the worst way for this
 * to fail.
 *
 * The redirect flow needs no popup and no SDK: Facebook takes over the
 * whole view, and hands control back to the callback route below.
 *
 * Note this page still never sees a VOXO session. It carries the app id
 * and config id, both public; the authorization code returns to the
 * callback, which passes it to the app, which posts it to the API with its
 * own credentials.
 */
export function whatsappSignupPageHandler(req: Request, res: Response): void {
  if (!env.META_APP_ID || !env.META_CONFIG_ID) {
    res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect WhatsApp</title>
<style>${SHELL_STYLE}</style></head><body><div>
<p class="error">This server is missing META_APP_ID or META_CONFIG_ID, so WhatsApp onboarding cannot start.</p>
</div></body></html>`);
    return;
  }

  const redirectUri = `${publicOrigin(req)}/api/whatsapp/signup/callback`;
  const dialog = new URL(`https://www.facebook.com/${env.META_API_VERSION}/dialog/oauth`);
  dialog.searchParams.set('client_id', env.META_APP_ID);
  dialog.searchParams.set('redirect_uri', redirectUri);
  dialog.searchParams.set('response_type', 'code');
  dialog.searchParams.set('config_id', env.META_CONFIG_ID);
  // Without this the dialog returns an access token in the URL fragment —
  // a live Meta credential sitting in the WebView's address bar. The code
  // flow keeps the token on the server.
  dialog.searchParams.set('override_default_response_type', 'true');
  dialog.searchParams.set('extras', JSON.stringify({ sessionInfoVersion: '3' }));

  // A link rather than an immediate 302: an automatic redirect makes a
  // failure on Facebook's side look like our page is broken, and leaves no
  // way back. One tap, and the WebView's Cancel button still works.
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Connect WhatsApp</title>
<style>${SHELL_STYLE}</style></head><body><div>
<p>Connect your WhatsApp Business account to continue.</p>
<a class="btn" href="${htmlText(dialog.toString())}">Continue with Facebook</a>
<p class="muted" style="margin-top:18px">Facebook handles the login and number verification.</p>
</div></body></html>`);
}

/**
 * Where Facebook returns after onboarding.
 *
 * Hands the authorization code to the app over the WebView bridge and
 * stops. It does not call the API itself — the app does that with its own
 * session, so the user's token never travels in a URL that could end up in
 * a log or a browser history.
 */
export function whatsappSignupCallbackHandler(req: Request, res: Response): void {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const error = typeof req.query.error_description === 'string'
    ? req.query.error_description
    : typeof req.query.error === 'string'
      ? req.query.error
      : '';

  const payload = code
    ? `{ type: 'code', code: '${jsString(code)}' }`
    : error
      ? `{ type: 'error', message: '${jsString(error)}' }`
      : `{ type: 'cancelled' }`;

  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect WhatsApp</title>
<style>${SHELL_STYLE}</style></head><body><div>
<p>${code ? 'Finishing up…' : error ? `<span class="error">${htmlText(error)}</span>` : 'Cancelled.'}</p>
<script>
  var payload = ${payload};
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
</script>
</div></body></html>`);
}

/** Exported for its unit test only — not part of the module's surface. */
export { jsString as __jsStringForTests };
