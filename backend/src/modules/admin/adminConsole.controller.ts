import type { Request, Response } from 'express';

/**
 * A one-page admin console, served by the backend itself.
 *
 * It exists because the controls it carries had nowhere to live. The
 * removals (a Business Manager, a number, a member) and the per-number
 * quality reading are all live endpoints with no button anywhere: the web
 * admin is a separate deployment whose source is not in this repository,
 * and the Android app is not where an admin manages credentials.
 *
 * Deliberately modest. This is not a replacement for that admin — it is
 * the set of destructive, rarely-used operations that an operator
 * otherwise has to reach with curl and a hand-copied bearer token, which
 * is exactly the situation in which people delete the wrong thing.
 *
 * Same shape as the guest console next door: no credentials in the page,
 * the admin's own login posted to the same /api/auth/login every client
 * uses, and the token kept in a JavaScript variable for the life of the
 * tab. Nothing is written to storage, so closing the tab ends the
 * session. Same-origin, so none of it depends on the CORS configuration.
 */
export function adminConsolePageHandler(_req: Request, res: Response): void {
  res.type('html').send(PAGE);
}

/**
 * The page's script, from its own URL rather than inlined.
 *
 * Helmet sets `script-src 'self'`, so an inline <script> is refused by the
 * browser: the page would render and every button would do nothing, with
 * the reason visible only in the console. An external file from the same
 * origin satisfies that policy exactly as it stands.
 */
export function adminConsoleScriptHandler(_req: Request, res: Response): void {
  res.type('application/javascript').send(SCRIPT);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex,nofollow" />
<title>VOXO admin</title>
<style>
  :root { color-scheme: light dark; --line: rgba(128,128,128,.28); --accent: #6366f1; --danger: #d92d20; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 20px 64px;
    font: 15px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f6f7fb; color: #111b21;
  }
  @media (prefers-color-scheme: dark) { body { background: #0b141a; color: #e9edef; } }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0; }
  p.sub { margin: 0 0 24px; opacity: .7; font-size: 14px; }
  fieldset { border: 0; padding: 0; margin: 0; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input {
    width: 100%; padding: 11px 13px; font: inherit; border-radius: 10px;
    border: 1px solid var(--line); background: Field; color: inherit;
  }
  button {
    padding: 10px 15px; font: inherit; font-weight: 600; color: #fff;
    background: var(--accent); border: 0; border-radius: 9px; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: default; }
  button.danger { background: var(--danger); }
  button.wide { width: 100%; margin-top: 18px; padding: 13px 16px; }
  section { margin-top: 28px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .head .note { font-size: 12.5px; opacity: .65; }
  .row {
    display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap;
    padding: 13px 15px; border: 1px solid var(--line); border-radius: 11px;
    margin-bottom: 9px; background: rgba(128,128,128,.05);
  }
  .row .grow { flex: 1; min-width: 190px; }
  .row .name { font-weight: 600; }
  .row .meta { font-size: 12.5px; opacity: .7; margin-top: 2px; word-break: break-all; }
  .pill {
    display: inline-block; font-size: 11.5px; font-weight: 600; padding: 2px 8px;
    border-radius: 999px; margin-left: 7px; vertical-align: 1px;
  }
  .q-ok { background: rgba(6,118,71,.15); color: #067647; }
  .q-warn { background: rgba(180,120,10,.17); color: #a86a08; }
  .q-critical { background: rgba(217,45,32,.15); color: var(--danger); }
  .q-unknown { background: rgba(128,128,128,.17); opacity: .85; }
  .msg { margin-top: 14px; font-size: 14px; }
  .err { color: var(--danger); }
  .ok { color: #067647; }
  .hide { display: none; }
  .empty { font-size: 13.5px; opacity: .65; padding: 4px 2px 0; }
</style>
</head>
<body>
<main>
  <h1>VOXO admin</h1>
  <p class="sub" id="who">Sign in to manage Business Managers, numbers and members.</p>

  <form id="loginForm">
    <fieldset>
      <label for="identifier">Phone or email</label>
      <input id="identifier" type="text" autocomplete="username" required />
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" required />
    </fieldset>
    <button type="submit" id="loginBtn" class="wide">Sign in</button>
    <p class="msg err hide" id="loginMsg"></p>
  </form>

  <div id="panel" class="hide">
    <section>
      <div class="head">
        <h2>Business Managers</h2>
        <span class="note">Removing one is refused while it still holds numbers.</span>
      </div>
      <div id="apps"></div>
    </section>

    <section>
      <div class="head">
        <h2>WhatsApp numbers</h2>
        <span class="note">Quality is Meta's own rating. Removal is refused once a number has chats.</span>
      </div>
      <div id="numbers"></div>
    </section>

    <section>
      <div class="head">
        <h2>Members</h2>
        <span class="note">Remove deletes the account for good. You cannot remove yourself.</span>
      </div>
      <div id="users"></div>
    </section>

    <p class="msg hide" id="actionMsg"></p>
  </div>
</main>

<script src="/api/admin/console.js"></script>
</body>
</html>`;

const SCRIPT = `(function () {
  // Memory only. Never localStorage: this page is for occasional manual
  // use, and a token left in storage outlives the reason it was created.
  var accessToken = null;
  var meId = null;

  function el(id) { return document.getElementById(id); }
  function show(node, on) { node.classList.toggle('hide', !on); }

  function say(text, isError) {
    var msg = el('actionMsg');
    msg.textContent = text;
    msg.className = 'msg ' + (isError ? 'err' : 'ok');
    show(msg, true);
  }

  async function call(method, path, body) {
    var headers = {};
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    if (body) headers['Content-Type'] = 'application/json';
    var res = await fetch(path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      // The server's own message is the useful part: every refusal here
      // explains what is still attached and what to do about it.
      var m = data && data.error && data.error.message
        ? data.error.message
        : 'Request failed (' + res.status + ')';
      throw new Error(m);
    }
    return data ? data.data : null;
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /**
   * A destructive button, with the confirmation built into the page.
   *
   * Two taps rather than a dialog: window.confirm is unreliable in an
   * embedded view, and a button that silently does nothing on the one
   * action you cannot undo is worse than no button.
   */
  function removeButton(label, confirmLabel, run) {
    var btn = node('button', 'danger', label);
    var armed = false;
    btn.addEventListener('click', async function () {
      if (!armed) {
        armed = true;
        btn.textContent = confirmLabel;
        setTimeout(function () {
          if (!armed) return;
          armed = false;
          btn.textContent = label;
        }, 4000);
        return;
      }
      armed = false;
      btn.disabled = true;
      btn.textContent = 'Removing…';
      try {
        await run();
        say('Removed.', false);
        await refresh();
      } catch (err) {
        say(err.message, true);
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    return btn;
  }

  function renderApps(apps) {
    var box = el('apps');
    box.innerHTML = '';
    var real = apps.filter(function (a) { return a.id; });
    if (!real.length) { box.appendChild(node('p', 'empty', 'No Business Managers added.')); return; }
    real.forEach(function (a) {
      var row = node('div', 'row');
      var grow = node('div', 'grow');
      grow.appendChild(node('div', 'name', a.name));
      grow.appendChild(node('div', 'meta',
        'App ID ' + a.appId + ' · ' + a.numberCount + ' number' + (a.numberCount === 1 ? '' : 's') +
        (a.accountStatus ? ' · ' + a.accountStatus : '')));
      row.appendChild(grow);
      row.appendChild(removeButton('Remove', 'Tap again to remove', function () {
        return call('DELETE', '/api/meta-apps/' + a.id);
      }));
      box.appendChild(row);
    });
  }

  function renderNumbers(numbers) {
    var box = el('numbers');
    box.innerHTML = '';
    if (!numbers.length) { box.appendChild(node('p', 'empty', 'No numbers registered.')); return; }
    numbers.forEach(function (n) {
      var row = node('div', 'row');
      var grow = node('div', 'grow');

      var name = node('div', 'name', n.displayPhoneNumber);
      if (n.health) {
        var pill = node('span', 'pill q-' + n.health.level, n.health.headline);
        name.appendChild(pill);
      }
      grow.appendChild(name);
      grow.appendChild(node('div', 'meta',
        n.phoneNumberId + ' · ' + (n.metaAppName || 'no Business Manager') +
        (n.messagingLimitTier ? ' · ' + n.messagingLimitTier : '')));

      // Only where it changes what to do. A healthy number needs no
      // paragraph; a falling one needs the reason and the remedy.
      if (n.health && (n.health.level === 'warn' || n.health.level === 'critical')) {
        grow.appendChild(node('div', 'meta', n.health.detail));
      }

      row.appendChild(grow);
      row.appendChild(removeButton('Remove', 'Tap again to remove', function () {
        return call('DELETE', '/api/whatsapp/numbers/' + n.id);
      }));
      box.appendChild(row);
    });
  }

  function renderUsers(users) {
    var box = el('users');
    box.innerHTML = '';
    if (!users.length) { box.appendChild(node('p', 'empty', 'No members.')); return; }
    users.forEach(function (u) {
      var row = node('div', 'row');
      var grow = node('div', 'grow');
      grow.appendChild(node('div', 'name', u.displayName || u.email || u.phone || u.id));
      grow.appendChild(node('div', 'meta',
        u.role + ' · ' + u.status + (u.email ? ' · ' + u.email : '')));
      row.appendChild(grow);

      // The server refuses this too, but saying so here means the one
      // button that cannot be undone is never offered for the account
      // whose session is running the page.
      if (u.id === meId) {
        row.appendChild(node('div', 'meta', 'This is you'));
      } else {
        row.appendChild(removeButton('Remove', 'Tap again to remove', function () {
          return call('DELETE', '/api/users/' + u.id + '/permanently');
        }));
      }
      box.appendChild(row);
    });
  }

  async function refresh() {
    // One failing list must not blank the other two: a workspace with no
    // Business Managers still needs its numbers and members on screen.
    var results = await Promise.allSettled([
      call('GET', '/api/meta-apps'),
      call('GET', '/api/whatsapp/numbers'),
      call('GET', '/api/users')
    ]);
    if (results[0].status === 'fulfilled') renderApps(results[0].value || []);
    if (results[1].status === 'fulfilled') renderNumbers(results[1].value || []);
    if (results[2].status === 'fulfilled') renderUsers(results[2].value || []);

    var failed = results.filter(function (r) { return r.status === 'rejected'; });
    if (failed.length) say(failed[0].reason.message, true);
  }

  el('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = el('loginBtn');
    var msg = el('loginMsg');
    show(msg, false);
    btn.disabled = true;
    try {
      var out = await call('POST', '/api/auth/login', {
        identifier: el('identifier').value.trim(),
        password: el('password').value
      });
      accessToken = out.accessToken;
      meId = out.user.id;
      if (out.user.role !== 'MASTER_ADMIN') {
        throw new Error('This page is for admins. Sign in with a Master Admin account.');
      }
      el('who').textContent = 'Signed in as ' + (out.user.displayName || out.user.email);
      show(el('loginForm'), false);
      show(el('panel'), true);
      await refresh();
    } catch (err) {
      msg.textContent = err.message;
      show(msg, true);
      btn.disabled = false;
    }
  });
})();`;
