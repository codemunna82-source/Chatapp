/**
 * Which address a workspace's private-chat link is built on.
 *
 * The whole point of this module is blast radius. Meta and every other
 * anti-abuse system score reputation on the REGISTRABLE domain (eTLD+1),
 * not on the hostname — so `a.example.com` and `b.example.com` share one
 * fate, and giving each workspace a subdomain of the shared domain buys
 * exactly nothing. One workspace's links getting flagged takes down the
 * links of every workspace behind the same registrable domain, including
 * the ones that did nothing wrong.
 *
 * Two arrangements actually move that number, and both live here:
 *
 *   CUSTOM — the workspace brings its own domain (`chat.theirbusiness.in`).
 *            Real isolation: their reputation is theirs alone. Costs them
 *            a DNS record and costs us a verification step, because
 *            pointing our chat window at a hostname we do not control is
 *            only safe once they have proved they control it.
 *
 *   POOL   — we own several unrelated registrable domains and spread
 *            workspaces across them. Partial isolation: a flagged domain
 *            takes out its share of tenants rather than all of them. No
 *            per-workspace work, which is what makes it the default.
 *
 * Everything in this file is pure. The database side is in
 * guestDomain.service.ts, and the split is deliberate: these rules decide
 * what a customer's link looks like and which origins the API will talk
 * to, so they need tests that run without a Mongo binary.
 */

export const GUEST_DOMAIN_SOURCES = ['POOL', 'CUSTOM'] as const;
export type GuestDomainSource = (typeof GUEST_DOMAIN_SOURCES)[number];

/** RFC 1035 label plus the leading-digit relaxation everyone actually uses. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Turns whatever an admin typed into a bare hostname, or null if it is not
 * one we can serve.
 *
 * Admins paste `https://chat.example.in/`, `chat.example.in `, and
 * `CHAT.Example.IN` interchangeably and all three mean the same thing, so
 * all three are accepted. What is NOT accepted is anything that would make
 * the stored value mean something other than "a host we serve HTTPS on":
 *
 *  - a port, because the link goes in a WhatsApp message to a stranger's
 *    phone and 443 is the only port that survives that trip;
 *  - a path, query or fragment, because `/c/<token>` is appended to this
 *    and a base carrying its own path would produce a URL nobody routes;
 *  - a scheme other than https, for a link sent to a customer;
 *  - a bare label or an IP literal, neither of which can hold a public
 *    certificate for a name a customer will trust.
 */
export function normalizeGuestHost(input: string): string | null {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value) return null;

  // A scheme is stripped, but only https. `http://` is not a paste error
  // to forgive — it is a different, worse thing to send someone.
  if (value.startsWith('https://')) value = value.slice('https://'.length);
  else if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) return null;

  // Anything after the authority is dropped: a trailing slash is a paste
  // artefact. A real path is not, and is rejected below.
  const slash = value.indexOf('/');
  if (slash >= 0) {
    const rest = value.slice(slash);
    if (rest !== '/') return null;
    value = value.slice(0, slash);
  }
  if (value.includes('?') || value.includes('#') || value.includes('@')) return null;
  if (value.includes(':')) return null; // port, or an IPv6 literal
  value = value.replace(/\.+$/, ''); // the root dot is legal DNS and noise here

  if (value.length === 0 || value.length > 253) return null;

  const labels = value.split('.');
  // Two labels minimum. A single label is either `localhost` or an
  // intranet name, and neither can be reached from a customer's phone.
  if (labels.length < 2) return null;
  if (!labels.every((label) => LABEL.test(label))) return null;
  // A final all-numeric label means this is an IPv4 address, not a name.
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return null;

  return value;
}

/** The origin form, which is what CORS compares and what a link is built on. */
export function guestOriginFor(host: string): string {
  return `https://${host}`;
}

/**
 * The host inside an already-configured base URL.
 *
 * GUEST_LINK_BASE_URL is an origin string from the hosting dashboard, and
 * the shared fallback domain has to end up in the same allow-list as every
 * per-tenant one or the workspaces still on it lose their API access the
 * moment CORS starts being computed from tenants.
 */
export function hostOfBaseUrl(baseUrl: string): string | null {
  const trimmed = String(baseUrl ?? '').trim();
  if (!trimmed) return null;
  return normalizeGuestHost(trimmed);
}

/**
 * The pool, as configured.
 *
 * Order is preserved and duplicates are dropped, because assignment walks
 * this list and a domain listed twice would otherwise be handed out twice
 * as often — the opposite of what spreading tenants is for.
 */
export function parseDomainPool(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const part of parts) {
    const host = normalizeGuestHost(part);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    pool.push(host);
  }
  return pool;
}

/**
 * Where a workspace proves it owns the domain it just claimed.
 *
 * A TXT record on a dedicated `_`-prefixed subdomain rather than on the
 * host itself: the host will be pointed at the chat window with a CNAME,
 * and a CNAME cannot coexist with other records on the same name. Asking
 * for both at once is asking for a DNS setup that silently cannot be
 * completed.
 */
export function guestDomainTxtName(host: string): string {
  return `_voxo-chat.${host}`;
}

/** The exact string the TXT record must contain. */
export function guestDomainTxtValue(token: string): string {
  return `voxo-chat-verify=${token}`;
}

/**
 * Whether a DNS answer proves ownership.
 *
 * Resolvers hand back TXT records split into 255-byte chunks, so each
 * record arrives as an array of strings that has to be joined before it
 * means anything — comparing chunk-by-chunk is the classic way a correct
 * record reads as missing. Surrounding whitespace is tolerated because
 * several registrars' UIs add it.
 */
export function txtRecordsProveOwnership(records: string[][], token: string): boolean {
  const expected = guestDomainTxtValue(token);
  return records.some((chunks) => chunks.join('').trim().replace(/^"|"$/g, '') === expected);
}

/**
 * The link base for a workspace, given what it has configured.
 *
 * A CUSTOM domain counts only once verified. Before that the workspace has
 * typed a hostname it may not own, and building customer links on it would
 * send people to somebody else's server — so the shared fallback stays in
 * use until the DNS check passes, which also means turning the feature on
 * never interrupts links that already work.
 */
export function resolveGuestLinkBaseUrl(
  domain:
    | {
        host?: string | null;
        source?: GuestDomainSource | null;
        verifiedAt?: Date | null;
      }
    | null
    | undefined,
  fallbackBaseUrl: string,
): string {
  const host = domain?.host ? normalizeGuestHost(domain.host) : null;
  if (host) {
    const usable = domain?.source === 'POOL' || Boolean(domain?.verifiedAt);
    if (usable) return guestOriginFor(host);
  }
  return fallbackBaseUrl.replace(/\/+$/, '');
}

/** The URL a chat link points at. The one place `/c/` is spelled out. */
export function guestChatUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/c/${token}`;
}

/**
 * What a WhatsApp template's URL button has to be built on.
 *
 * Meta lets an approved template's URL vary only in a trailing variable,
 * so this is fixed at submission time and getting it wrong is discovered
 * days later, after approval. Per-workspace now, because two workspaces
 * on different domains genuinely need two different templates.
 */
export function guestLinkUrlPattern(baseUrl: string): string | null {
  const base = baseUrl.replace(/\/+$/, '');
  return base ? `${base}/c/{{1}}` : null;
}
