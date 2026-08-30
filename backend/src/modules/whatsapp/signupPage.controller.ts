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

/**
 * The Embedded Signup page, served by us and loaded in the app's WebView.
 *
 * This page exists because Embedded Signup is the Facebook *JavaScript*
 * SDK — `FB.login` with a config_id — and there is no native Android
 * equivalent. A React Native app cannot launch it directly, so it loads
 * this page instead.
 *
 * What the page does NOT do is as important as what it does: it never sees
 * a VOXO access token and never calls our API. It hands the authorization
 * code to the WebView via postMessage, and the app then calls
 * POST /api/whatsapp/connect with its own credentials. That keeps the
 * user's session out of a page whose URL could end up in a log or history.
 *
 * The two values embedded here — app id and config id — are public
 * identifiers, not secrets. META_APP_SECRET stays on the server and is
 * used only in the code exchange.
 */
export function whatsappSignupPageHandler(_req: Request, res: Response): void {
  const appId = jsString(env.META_APP_ID);
  const configId = jsString(env.META_CONFIG_ID);
  const graphVersion = jsString(env.META_API_VERSION);
  const configured = env.META_APP_ID.length > 0 && env.META_CONFIG_ID.length > 0;

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Connect WhatsApp</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #ffffff; color: #111b21; padding: 24px; text-align: center;
  }
  @media (prefers-color-scheme: dark) { body { background: #0b141a; color: #e9edef; } }
  button {
    font: inherit; font-weight: 600; color: #fff; background: #1877f2;
    border: 0; border-radius: 10px; padding: 14px 22px; min-height: 48px; width: 100%; max-width: 320px;
  }
  button:disabled { opacity: .5; }
  .muted { opacity: .7; font-size: 14px; margin-top: 16px; }
  .error { color: #c62828; }
</style>
</head>
<body>
<div>
  ${
    configured
      ? `<p>Connect your WhatsApp Business account to continue.</p>
  <button id="go" type="button">Continue with Facebook</button>
  <p class="muted" id="msg"></p>`
      : `<p class="error">This server is missing META_APP_ID or META_CONFIG_ID, so WhatsApp onboarding cannot start.</p>`
  }
</div>
<script>
  // One channel back to the app for every outcome, so the native side has
  // a single message handler and no silent states.
  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  // Meta delivers the WABA and phone number ids through a window message,
  // separately from the auth code. We forward what arrives but the server
  // does not trust any of it — it re-derives the WABA from the token via
  // debug_token. This is for progress display only.
  window.addEventListener('message', function (event) {
    if (!/facebook\\.com$/.test(new URL(event.origin).hostname)) return;
    try {
      var data = JSON.parse(event.data);
      if (data.type === 'WA_EMBEDDED_SIGNUP') {
        post({ type: 'signup_event', event: data.event, data: data.data });
      }
    } catch (e) {
      // Non-JSON messages are routine on this origin; ignore them.
    }
  });
</script>
${
  configured
    ? `<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>
<script>
  window.fbAsyncInit = function () {
    FB.init({ appId: '${appId}', autoLogAppEvents: true, xfbml: false, version: '${graphVersion}' });
    document.getElementById('go').disabled = false;
  };

  document.getElementById('go').addEventListener('click', function () {
    var msg = document.getElementById('msg');
    if (typeof FB === 'undefined') {
      msg.textContent = 'Could not reach Facebook. Check your connection and try again.';
      post({ type: 'error', message: 'FB SDK failed to load' });
      return;
    }
    msg.textContent = '';
    FB.login(function (response) {
      var code = response && response.authResponse && response.authResponse.code;
      if (code) {
        // The code alone goes to the app. It is single-use and useless
        // without the app secret, which only the server holds.
        post({ type: 'code', code: code });
      } else {
        post({ type: 'cancelled' });
      }
    }, {
      config_id: '${configId}',
      response_type: 'code',
      // Without this, the SDK returns an access token to the page — which
      // would put a live Meta credential in the WebView. The code flow
      // keeps the token server-side.
      override_default_response_type: true,
      extras: { sessionInfoVersion: '3' }
    });
  });
</script>`
    : ''
}
</body>
</html>`);
}

/** Exported for its unit test only — not part of the module's surface. */
export { jsString as __jsStringForTests };
