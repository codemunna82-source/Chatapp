import type { Request, Response } from 'express';

/**
 * A one-page console for minting a web-chat link.
 *
 * Until the agent app grows a button for this, the only way to get a link
 * is two API calls with a bearer token — which is fine from a laptop and
 * miserable from the phone the person testing is actually holding.
 *
 * It introduces no new way in. The page ships no credentials and no
 * token; it collects the admin's own login, posts it to the same
 * /api/auth/login every client uses, and keeps the resulting access token
 * in a JavaScript variable for the life of the tab. Nothing is written to
 * localStorage, so closing the tab ends the session — deliberate for a
 * page whose whole purpose is occasional manual use.
 *
 * Same-origin, so none of this depends on the CORS configuration.
 */
export function guestConsolePageHandler(_req: Request, res: Response): void {
  res.type('html').send(PAGE);
}

/**
 * The page's script, served from its own URL rather than inlined.
 *
 * Helmet sets `script-src 'self'` on every response, so an inline
 * <script> is refused by the browser — the page would render and every
 * button would do nothing, with the reason visible only in the console.
 * An external file from the same origin satisfies that policy exactly as
 * it stands, which is better than carving out an exception for one page.
 */
export function guestConsoleScriptHandler(_req: Request, res: Response): void {
  res.type('application/javascript').send(SCRIPT);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex,nofollow" />
<title>Web chat link</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 24px 20px;
    font: 16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f6f7fb; color: #111b21;
  }
  @media (prefers-color-scheme: dark) { body { background: #0b141a; color: #e9edef; } }
  main { max-width: 420px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { margin: 0 0 24px; opacity: .7; font-size: 14px; }
  fieldset { border: 0; padding: 0; margin: 0 0 20px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input {
    width: 100%; padding: 12px 14px; font: inherit; border-radius: 10px;
    border: 1px solid rgba(128,128,128,.4); background: Field; color: inherit;
  }
  button {
    width: 100%; margin-top: 18px; padding: 13px 16px; font: inherit; font-weight: 600;
    color: #fff; background: #6366f1; border: 0; border-radius: 10px; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: default; }
  .msg { margin-top: 16px; font-size: 14px; }
  .err { color: #d92d20; }
  .ok { color: #067647; }
  .result {
    margin-top: 20px; padding: 14px; border-radius: 10px;
    background: rgba(99,102,241,.1); word-break: break-all;
  }
  .result a { color: #6366f1; font-weight: 600; }
  .hide { display: none; }
</style>
</head>
<body>
<main>
  <h1>Web chat link</h1>
  <p class="sub">Sign in, enter the customer's number, get their private chat link.</p>

  <form id="loginForm">
    <fieldset id="loginFields">
      <label for="email">Admin email</label>
      <input id="email" type="email" autocomplete="username" required />
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" required />
    </fieldset>
    <button type="submit" id="loginBtn">Sign in</button>
    <p class="msg err hide" id="loginMsg"></p>
  </form>

  <form id="linkForm" class="hide">
    <p class="msg ok" id="who"></p>
    <fieldset>
      <label for="phone">Customer's WhatsApp number</label>
      <input id="phone" type="tel" placeholder="+91 98765 43210" required />
      <label for="name">Name (optional)</label>
      <input id="name" type="text" />
    </fieldset>
    <button type="submit" id="linkBtn">Create link</button>
    <p class="msg err hide" id="linkMsg"></p>
    <div class="result hide" id="result"></div>
  </form>
</main>

<script src="/api/guest/console.js"></script>
</body>
</html>`;

const SCRIPT = `(function () {
  // Memory only. Never localStorage: this page exists for occasional
  // manual use, and a token left in storage outlives the reason it was
  // created.
  var accessToken = null;

  function show(el, on) { el.classList.toggle('hide', !on); }
  function fail(el, text) { el.textContent = text; show(el, true); }

  async function post(path, body, token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    var res = await fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var msg = data && data.error && data.error.message ? data.error.message : 'Request failed (' + res.status + ')';
      throw new Error(msg);
    }
    return data.data;
  }

  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = document.getElementById('loginBtn');
    var msg = document.getElementById('loginMsg');
    show(msg, false);
    btn.disabled = true;
    try {
      var out = await post('/api/auth/login', {
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      });
      accessToken = out.accessToken;
      document.getElementById('who').textContent = 'Signed in as ' + out.user.email;
      show(document.getElementById('loginForm'), false);
      show(document.getElementById('linkForm'), true);
    } catch (err) {
      fail(msg, err.message);
      btn.disabled = false;
    }
  });

  document.getElementById('linkForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = document.getElementById('linkBtn');
    var msg = document.getElementById('linkMsg');
    var result = document.getElementById('result');
    show(msg, false);
    show(result, false);
    btn.disabled = true;
    try {
      var name = document.getElementById('name').value.trim();
      var body = { phone: document.getElementById('phone').value.trim() };
      if (name) body.name = name;
      var out = await post('/api/conversations/guest-link', body, accessToken);

      result.innerHTML = '';
      var a = document.createElement('a');
      a.href = out.url;
      a.textContent = out.url;
      a.target = '_blank';
      a.rel = 'noopener';
      result.appendChild(a);
      var note = document.createElement('p');
      note.style.margin = '10px 0 0';
      note.style.fontSize = '13px';
      note.style.opacity = '.75';
      note.textContent = 'For ' + out.phone + '. Open it, send a message, and it lands in that chat in VOXO.';
      result.appendChild(note);
      show(result, true);
    } catch (err) {
      fail(msg, err.message);
    }
    btn.disabled = false;
  });
})();`;
