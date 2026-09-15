import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { env } from '../../config/env';
import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { createTtlCache } from '../../lib/ttlCache';
import { Tenant } from './tenant.model';
import {
  type GuestDomainSource,
  guestDomainTxtName,
  guestDomainTxtValue,
  guestOriginFor,
  hostOfBaseUrl,
  normalizeGuestHost,
  parseDomainPool,
  resolveGuestLinkBaseUrl,
  txtRecordsProveOwnership,
} from './guestDomain';

/**
 * The database side of per-workspace chat domains.
 *
 * Two things in here are on hot paths and both are cached, for different
 * reasons. A workspace's own base URL is read on every inbound WhatsApp
 * message (the auto-reply) and on every push, so it gets a short per-tenant
 * cache. The set of trusted browser origins is read on every single
 * cross-origin request the API serves, so it is cached WHOLE rather than
 * per-origin: an unknown origin then costs a set lookup instead of a query,
 * which matters because unknown origins are exactly what an attacker can
 * generate for free.
 *
 * Both caches are invalidated explicitly by the writes below, so an admin
 * who sets a domain sees it work immediately rather than a TTL later. The
 * TTL is what covers the OTHER instances of a horizontally scaled
 * deployment, which never see that invalidation.
 */

/** Long enough to skip the read on a burst of messages, short enough that an admin change on another instance lands within a minute. */
const BASE_URL_TTL_MS = 60_000;
const ORIGIN_SET_TTL_MS = 60_000;

const baseUrlCache = createTtlCache<string>({ ttlMs: BASE_URL_TTL_MS, maxEntries: 500 });

let originSet: { value: Set<string>; expiresAt: number } | null = null;
let originSetInFlight: Promise<Set<string>> | null = null;

let cachedPool: string[] | null = null;

/** The configured pool, parsed once. */
export function domainPool(): string[] {
  if (!cachedPool) cachedPool = parseDomainPool(env.GUEST_LINK_DOMAIN_POOL);
  return cachedPool;
}

/**
 * Origins that are ours no matter what any workspace has configured: the
 * shared fallback domain and every pool member.
 *
 * Read from configuration rather than from the database on purpose — these
 * have to keep working during a database outage, or a blip would revoke the
 * API access of every chat window at once.
 */
function configuredOrigins(): string[] {
  const origins: string[] = [];
  const fallbackHost = hostOfBaseUrl(env.GUEST_LINK_BASE_URL);
  if (fallbackHost) origins.push(guestOriginFor(fallbackHost));
  for (const host of domainPool()) origins.push(guestOriginFor(host));
  return origins;
}

function forgetOriginSet(): void {
  originSet = null;
}

async function loadOriginSet(): Promise<Set<string>> {
  const set = new Set(configuredOrigins());
  try {
    // Only verified CUSTOM hosts and POOL hosts. An unverified custom host
    // is a hostname somebody typed; trusting it as a browser origin before
    // the DNS check would let anyone add any origin to this API's
    // allow-list just by claiming it.
    const rows = await Tenant.find(
      {
        'guestDomain.host': { $type: 'string' },
        $or: [{ 'guestDomain.source': 'POOL' }, { 'guestDomain.verifiedAt': { $ne: null } }],
      },
      { 'guestDomain.host': 1 },
    ).lean();
    for (const row of rows) {
      const host = row.guestDomain?.host ? normalizeGuestHost(row.guestDomain.host) : null;
      if (host) set.add(guestOriginFor(host));
    }
  } catch (error) {
    // Configured origins still stand. Failing closed here would drop the
    // shared domain too, which is every workspace at once — a far larger
    // outage than the stale-by-a-minute custom domain this risks.
    logger.error({ err: error }, 'Could not read tenant chat domains; CORS is answering from configuration only');
  }
  return set;
}

/** The trusted-origin set, refreshed at most once per TTL and never concurrently. */
async function trustedOrigins(): Promise<Set<string>> {
  const now = Date.now();
  if (originSet && originSet.expiresAt > now) return originSet.value;
  if (originSetInFlight) return originSetInFlight;

  originSetInFlight = loadOriginSet()
    .then((value) => {
      originSet = { value, expiresAt: Date.now() + ORIGIN_SET_TTL_MS };
      return value;
    })
    .finally(() => {
      originSetInFlight = null;
    });
  return originSetInFlight;
}

/**
 * Whether a browser origin belongs to a chat window we serve.
 *
 * Exact-match against the set, never a suffix test: a suffix test on
 * `example.com` also accepts `example.com.attacker.net`, which is the
 * standard way a dynamic CORS check becomes a vulnerability.
 */
export async function isTrustedGuestOrigin(origin: string): Promise<boolean> {
  const normalized = origin.trim().replace(/\/+$/, '').toLowerCase();
  if (!normalized) return false;
  const set = await trustedOrigins();
  return set.has(normalized);
}

/**
 * The base URL a workspace's links are built on.
 *
 * Falls back to the shared domain for any workspace that has not been
 * given one, which is what makes this safe to drop into the four places
 * that used to read the environment variable directly.
 */
export async function guestLinkBaseUrlFor(tenantId: string): Promise<string> {
  const key = String(tenantId);
  const hit = baseUrlCache.get(key);
  if (hit !== undefined) return hit;

  let resolved = env.GUEST_LINK_BASE_URL;
  try {
    const tenant = await Tenant.findById(key, { guestDomain: 1 }).lean();
    resolved = resolveGuestLinkBaseUrl(tenant?.guestDomain, env.GUEST_LINK_BASE_URL);
  } catch (error) {
    // The shared domain is a correct answer, just not the most specific
    // one. Throwing would stop an invitation going out over a read that
    // exists purely to brand the link.
    logger.error({ err: error, tenantId: key }, 'Could not read the workspace chat domain; using the shared one');
  }

  baseUrlCache.set(key, resolved);
  return resolved;
}

/** Drop a workspace's cached base URL and the origin set, after a write. */
function forgetTenant(tenantId: string): void {
  baseUrlCache.delete(String(tenantId));
  forgetOriginSet();
}

export interface GuestDomainView {
  host: string | null;
  source: GuestDomainSource | null;
  verified: boolean;
  assignedAt: string | null;
  /** The link base actually in use right now, shared fallback included. */
  baseUrl: string;
  /** Present only while a CUSTOM domain is waiting on DNS. */
  dns: { name: string; type: 'TXT'; value: string } | null;
  /** What is left to hand out, so the admin screen can offer a choice. */
  poolAvailable: string[];
}

export async function getGuestDomainSettings(tenantId: string): Promise<GuestDomainView> {
  const tenant = await Tenant.findById(tenantId, { guestDomain: 1 }).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Workspace not found');

  const domain = tenant.guestDomain;
  const host = domain?.host ? normalizeGuestHost(domain.host) : null;
  const source = (domain?.source ?? null) as GuestDomainSource | null;
  const verified = Boolean(domain?.verifiedAt);

  return {
    host,
    source,
    verified,
    assignedAt: domain?.assignedAt ? new Date(domain.assignedAt).toISOString() : null,
    baseUrl: resolveGuestLinkBaseUrl(domain, env.GUEST_LINK_BASE_URL),
    dns:
      host && source === 'CUSTOM' && !verified && domain?.verifyToken
        ? { name: guestDomainTxtName(host), type: 'TXT', value: guestDomainTxtValue(domain.verifyToken) }
        : null,
    poolAvailable: await availablePoolDomains(),
  };
}

/** Pool members nobody holds yet. */
async function availablePoolDomains(): Promise<string[]> {
  const pool = domainPool();
  if (pool.length === 0) return [];
  const taken = new Set(
    (await Tenant.find({ 'guestDomain.host': { $in: pool } }, { 'guestDomain.host': 1 }).lean())
      .map((row) => row.guestDomain?.host)
      .filter((host): host is string => Boolean(host)),
  );
  return pool.filter((host) => !taken.has(host));
}

/**
 * Option B: hand this workspace one of our spare domains.
 *
 * First free one in configured order, rather than a hash of the workspace
 * id. A hash spreads evenly on paper and re-shuffles every workspace the
 * moment the pool gains or loses a member, which would change live links;
 * walking the list in order means an assignment, once made, never moves on
 * its own.
 *
 * `host` picks a specific member — an admin moving one noisy workspace off
 * a domain the rest are fine on.
 */
export async function assignPoolDomain(tenantId: string, host?: string): Promise<GuestDomainView> {
  const pool = domainPool();
  if (pool.length === 0) {
    throw ApiError.serviceUnavailable(
      'GUEST_DOMAIN_POOL_EMPTY',
      'No spare chat domains are configured on the server (GUEST_LINK_DOMAIN_POOL).',
    );
  }

  let chosen: string | undefined;
  if (host) {
    const normalized = normalizeGuestHost(host);
    if (!normalized || !pool.includes(normalized)) {
      throw ApiError.badRequest('GUEST_DOMAIN_NOT_IN_POOL', 'That domain is not one of the spare chat domains.');
    }
    chosen = normalized;
  } else {
    const free = await availablePoolDomains();
    chosen = free[0];
  }

  if (!chosen) {
    throw ApiError.conflict(
      'GUEST_DOMAIN_POOL_EXHAUSTED',
      'Every spare chat domain is already in use. Add another to the pool first.',
    );
  }

  await saveDomain(tenantId, { host: chosen, source: 'POOL', verifiedAt: new Date() });
  return getGuestDomainSettings(tenantId);
}

/**
 * Option A: the workspace claims a domain of its own.
 *
 * Stored unverified, which is the entire safety property. Until the DNS
 * check passes this changes nothing a customer sees and adds nothing to
 * the API's trusted origins — so a typo, or a deliberate attempt to claim
 * a domain belonging to someone else, costs nothing.
 */
export async function claimCustomDomain(tenantId: string, rawHost: string): Promise<GuestDomainView> {
  const host = normalizeGuestHost(rawHost);
  if (!host) {
    throw ApiError.badRequest(
      'GUEST_DOMAIN_INVALID',
      'Enter a hostname such as chat.yourbusiness.in — no http://, no port, no path.',
    );
  }
  if (domainPool().includes(host) || host === hostOfBaseUrl(env.GUEST_LINK_BASE_URL)) {
    throw ApiError.badRequest(
      'GUEST_DOMAIN_RESERVED',
      'That domain is one of ours. Pick one of the spare domains instead of claiming it.',
    );
  }

  const clash = await Tenant.findOne({ 'guestDomain.host': host, _id: { $ne: tenantId } }, { _id: 1 }).lean();
  if (clash) {
    throw ApiError.conflict('GUEST_DOMAIN_TAKEN', 'Another workspace is already using that domain.');
  }

  await saveDomain(tenantId, {
    host,
    source: 'CUSTOM',
    verifiedAt: null,
    verifyToken: randomBytes(16).toString('hex'),
  });
  return getGuestDomainSettings(tenantId);
}

/**
 * Check the DNS record and, if it is there, start using the domain.
 *
 * Deliberately a separate call the admin makes rather than something a
 * background job retries: DNS takes anywhere from a minute to a day to
 * propagate, and an admin pressing a button knows when they finished
 * editing their zone far better than any polling interval would.
 */
export async function verifyCustomDomain(tenantId: string): Promise<GuestDomainView> {
  const tenant = await Tenant.findById(tenantId, { guestDomain: 1 }).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Workspace not found');

  const domain = tenant.guestDomain;
  const host = domain?.host ? normalizeGuestHost(domain.host) : null;
  if (!host || domain?.source !== 'CUSTOM' || !domain?.verifyToken) {
    throw ApiError.badRequest('GUEST_DOMAIN_NOT_CLAIMED', 'No custom chat domain is waiting to be verified.');
  }
  if (domain.verifiedAt) return getGuestDomainSettings(tenantId);

  const name = guestDomainTxtName(host);
  let records: string[][] = [];
  try {
    records = await dns.resolveTxt(name);
  } catch (error) {
    // ENOTFOUND/ENODATA is the ordinary "not added yet, or not propagated
    // yet" answer, so it is reported as a retryable failure rather than an
    // error. Only the field NAMES and the DNS error code are logged.
    const code = (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';
    logger.info({ tenantId, dnsErrorCode: code }, 'Chat domain TXT lookup found nothing yet');
    throw ApiError.badRequest(
      'GUEST_DOMAIN_DNS_MISSING',
      `No TXT record found at ${name} yet. DNS changes can take a few hours to appear.`,
    );
  }

  if (!txtRecordsProveOwnership(records, domain.verifyToken)) {
    throw ApiError.badRequest(
      'GUEST_DOMAIN_DNS_MISMATCH',
      `A TXT record exists at ${name} but does not contain the expected value.`,
    );
  }

  await saveDomain(tenantId, { host, source: 'CUSTOM', verifiedAt: new Date() });
  return getGuestDomainSettings(tenantId);
}

/** Back to the shared domain. Existing links on the old host stop resolving. */
export async function clearGuestDomain(tenantId: string): Promise<GuestDomainView> {
  await Tenant.findByIdAndUpdate(tenantId, { $unset: { guestDomain: '' } });
  forgetTenant(tenantId);
  return getGuestDomainSettings(tenantId);
}

async function saveDomain(
  tenantId: string,
  fields: { host: string; source: GuestDomainSource; verifiedAt: Date | null; verifyToken?: string },
): Promise<void> {
  const set: Record<string, unknown> = {
    'guestDomain.host': fields.host,
    'guestDomain.source': fields.source,
    'guestDomain.assignedAt': new Date(),
  };
  const unset: Record<string, ''> = {};
  if (fields.verifiedAt) set['guestDomain.verifiedAt'] = fields.verifiedAt;
  else unset['guestDomain.verifiedAt'] = '';
  if (fields.verifyToken) set['guestDomain.verifyToken'] = fields.verifyToken;
  // A POOL domain needs no proof, so a leftover token from an abandoned
  // custom claim would only show a stale DNS record on the settings screen.
  if (fields.source === 'POOL') unset['guestDomain.verifyToken'] = '';

  const updated = await Tenant.findByIdAndUpdate(tenantId, {
    $set: set,
    ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
  });
  if (!updated) throw ApiError.notFound('TENANT_NOT_FOUND', 'Workspace not found');
  forgetTenant(tenantId);
}

/** Test seam: both caches, dropped. */
export function resetGuestDomainCaches(): void {
  baseUrlCache.clear();
  forgetOriginSet();
  cachedPool = null;
}
