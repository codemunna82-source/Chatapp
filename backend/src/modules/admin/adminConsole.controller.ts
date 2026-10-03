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

  select {
    width: 100%; padding: 11px 13px; font: inherit; border-radius: 10px;
    border: 1px solid var(--line); background: Field; color: inherit;
  }
  /* Tall enough to show a conversation rather than a peephole, capped so
     the page is still scrollable past it on a phone. */
  .scroll { max-height: 300px; overflow-y: auto; margin-top: 10px; }
  .chat { max-height: 420px; }
  .conv {
    display: flex; gap: 10px; align-items: baseline; width: 100%; text-align: left;
    padding: 11px 13px; margin-bottom: 7px; cursor: pointer; font: inherit; color: inherit;
    background: rgba(128,128,128,.05); border: 1px solid var(--line); border-radius: 10px;
  }
  .conv.on { border-color: var(--accent); background: rgba(99,102,241,.1); }
  .conv .grow { flex: 1; min-width: 0; }
  .conv .name { font-weight: 600; }
  .conv .meta { font-size: 12.5px; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conv .when { font-size: 11.5px; opacity: .6; white-space: nowrap; }

  /* Direction is carried by the side the bubble sits on, the way every
     chat app does it — an agent should not have to read a label to tell
     an incoming message from one of their own. */
  .bub { max-width: 82%; padding: 9px 12px; border-radius: 13px; margin-bottom: 8px; font-size: 14px; }
  .bub.in { background: rgba(128,128,128,.14); border-bottom-left-radius: 4px; }
  .bub.out { background: rgba(99,102,241,.16); margin-left: auto; border-bottom-right-radius: 4px; }
  .bub .t { white-space: pre-wrap; word-break: break-word; }
  .bub .s { font-size: 11.5px; opacity: .72; margin-top: 4px; }
  .bub .fail { color: var(--danger); opacity: 1; font-weight: 600; }
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
        <h2>Message check</h2>
        <span class="note">Pick a number to see what is arriving and leaving on it.</span>
      </div>
      <select id="chatNumber"><option value="">Loading numbers…</option></select>
      <div id="convs" class="scroll"></div>
      <div id="chat" class="scroll chat"></div>
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

  /**
   * The message check: one number, its chats, and what actually happened
   * to each message.
   *
   * This exists because "did it send?" could not be answered anywhere. The
   * agent's app shows a failed tick with no reason; the logs have the
   * reason but nobody reads logs during a customer conversation. Meta
   * accepts a message and refuses it seconds later, so "sent" and
   * "arrived" are different claims and only the delivery status tells
   * them apart.
   */
  var chatNumberId = '';
  var openConvId = '';
  var pollTimer = null;

  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    var time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    // The date is noise on today's messages and essential on older ones,
    // which is the whole question being asked here: did this arrive now?
    return sameDay ? time : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + time;
  }

  /** Meta's status, said the way an agent would ask about it. */
  function statusWord(m) {
    if (m.direction === 'IN') return 'received';
    switch (m.status) {
      case 'READ': return 'read by customer';
      case 'DELIVERED': return 'delivered';
      case 'SENT': return 'sent to WhatsApp';
      case 'QUEUED': return 'queued';
      case 'FAILED': return 'FAILED — not delivered';
      default: return m.status || '';
    }
  }

  function renderChat(messages) {
    var box = el('chat');
    box.innerHTML = '';
    if (!messages.length) { box.appendChild(node('p', 'empty', 'No messages in this chat.')); return; }
    messages.forEach(function (m) {
      var out = m.direction === 'OUT';
      var b = node('div', 'bub ' + (out ? 'out' : 'in'));
      b.appendChild(node('div', 't', m.text || ('[' + (m.type || 'message') + ']')));
      var line = node('div', 's', when(m.createdAt) + ' · ' + statusWord(m));
      if (m.status === 'FAILED') line.className = 's fail';
      b.appendChild(line);
      // Meta's own sentence for the refusal. Shown in full rather than
      // summarised: it is the only place the reason appears outside the
      // server logs, and it is what gets quoted in a support ticket.
      if (m.failureReason) b.appendChild(node('div', 's fail', m.failureReason));
      box.appendChild(b);
    });
    box.scrollTop = box.scrollHeight;
  }

  async function loadChat(convId) {
    openConvId = convId;
    try {
      var messages = await call('GET', '/api/conversations/' + convId + '/messages?limit=50');
      // The list comes back newest first; a chat reads oldest first.
      renderChat((messages || []).slice().reverse());
    } catch (err) {
      el('chat').innerHTML = '';
      el('chat').appendChild(node('p', 'empty', err.message));
    }
  }

  function renderConvs(convs) {
    var box = el('convs');
    box.innerHTML = '';
    if (!convs.length) {
      box.appendChild(node('p', 'empty', 'No chats on this number yet.'));
      el('chat').innerHTML = '';
      return;
    }
    convs.forEach(function (c) {
      var btn = node('button', 'conv' + (c.id === openConvId ? ' on' : ''));
      var grow = node('div', 'grow');
      var who = (c.contact && (c.contact.name || c.contact.phone)) || 'Unknown';
      grow.appendChild(node('div', 'name', who + (c.unreadCount ? ' (' + c.unreadCount + ' new)' : '')));
      grow.appendChild(node('div', 'meta',
        (c.lastMessageDirection === 'OUT' ? 'You: ' : '') + (c.lastMessagePreview || 'No messages')));
      btn.appendChild(grow);
      btn.appendChild(node('div', 'when', when(c.lastMessageAt)));
      btn.addEventListener('click', function () {
        openConvId = c.id;
        Array.prototype.forEach.call(box.children, function (n) { n.classList.remove('on'); });
        btn.classList.add('on');
        loadChat(c.id);
      });
      box.appendChild(btn);
    });
  }

  async function loadConvs() {
    if (!chatNumberId) {
      el('convs').innerHTML = '';
      el('chat').innerHTML = '';
      return;
    }
    try {
      var convs = await call('GET',
        '/api/conversations?limit=25&whatsappPhoneNumberId=' + encodeURIComponent(chatNumberId));
      renderConvs(convs || []);
    } catch (err) {
      el('convs').innerHTML = '';
      el('convs').appendChild(node('p', 'empty', err.message));
    }
  }

  /**
   * Polled rather than pushed. The socket needs a connection this page
   * does not otherwise keep, and the question being asked — "is anything
   * arriving?" — is answered well enough by a look every few seconds.
   * Only while a number is selected, so an idle page is silent.
   */
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (!chatNumberId || document.hidden) return;
      loadConvs();
      if (openConvId) loadChat(openConvId);
    }, 5000);
  }

  function fillNumberPicker(numbers) {
    var sel = el('chatNumber');
    sel.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = numbers.length ? 'Choose a number…' : 'No numbers registered';
    sel.appendChild(first);
    numbers.forEach(function (n) {
      var opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = n.displayPhoneNumber + (n.metaAppName ? ' · ' + n.metaAppName : '');
      sel.appendChild(opt);
    });
    // Survives the refresh that follows every removal, so checking a
    // number does not get undone by an unrelated action on the page.
    sel.value = chatNumberId;
  }

  el('chatNumber').addEventListener('change', function () {
    chatNumberId = this.value;
    openConvId = '';
    el('chat').innerHTML = '';
    loadConvs();
  });

  async function refresh() {
    // One failing list must not blank the other two: a workspace with no
    // Business Managers still needs its numbers and members on screen.
    var results = await Promise.allSettled([
      call('GET', '/api/meta-apps'),
      call('GET', '/api/whatsapp/numbers'),
      call('GET', '/api/users')
    ]);
    if (results[0].status === 'fulfilled') renderApps(results[0].value || []);
    if (results[1].status === 'fulfilled') {
      renderNumbers(results[1].value || []);
      fillNumberPicker(results[1].value || []);
    }
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
      startPolling();
    } catch (err) {
      msg.textContent = err.message;
      show(msg, true);
      btn.disabled = false;
    }
  });
})();`;
