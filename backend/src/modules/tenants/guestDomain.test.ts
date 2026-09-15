import {
  guestChatUrl,
  guestDomainTxtName,
  guestDomainTxtValue,
  guestLinkUrlPattern,
  normalizeGuestHost,
  parseDomainPool,
  resolveGuestLinkBaseUrl,
  txtRecordsProveOwnership,
} from './guestDomain';

/**
 * Per-workspace chat domains, without a database.
 *
 * Worth pinning hard, because two of these rules are the difference
 * between a feature and a vulnerability: a hostname that normalizes into
 * something other than what was typed becomes a trusted browser origin
 * (guestDomain.service.ts feeds this straight into CORS), and a custom
 * domain that reads as usable before its DNS check passes sends customers
 * to a host nobody has proved they own.
 */
describe('normalizeGuestHost', () => {
  it('accepts an ordinary hostname', () => {
    expect(normalizeGuestHost('chat.example.in')).toBe('chat.example.in');
  });

  it('forgives the ways admins actually paste a domain', () => {
    expect(normalizeGuestHost('  CHAT.Example.IN  ')).toBe('chat.example.in');
    expect(normalizeGuestHost('https://chat.example.in')).toBe('chat.example.in');
    expect(normalizeGuestHost('https://chat.example.in/')).toBe('chat.example.in');
    // The DNS root dot is legal and means nothing here.
    expect(normalizeGuestHost('chat.example.in.')).toBe('chat.example.in');
  });

  it('refuses anything that is not plain https on 443', () => {
    expect(normalizeGuestHost('http://chat.example.in')).toBeNull();
    expect(normalizeGuestHost('ftp://chat.example.in')).toBeNull();
    expect(normalizeGuestHost('chat.example.in:8443')).toBeNull();
    // `/c/<token>` is appended to this; a base with its own path routes nowhere.
    expect(normalizeGuestHost('chat.example.in/app')).toBeNull();
    expect(normalizeGuestHost('chat.example.in?a=1')).toBeNull();
    expect(normalizeGuestHost('chat.example.in#x')).toBeNull();
  });

  it('refuses hosts no customer could reach', () => {
    expect(normalizeGuestHost('localhost')).toBeNull();
    expect(normalizeGuestHost('intranet')).toBeNull();
    expect(normalizeGuestHost('203.0.113.9')).toBeNull();
    expect(normalizeGuestHost('')).toBeNull();
    expect(normalizeGuestHost('   ')).toBeNull();
  });

  it('refuses malformed labels', () => {
    expect(normalizeGuestHost('-bad.example.in')).toBeNull();
    expect(normalizeGuestHost('bad-.example.in')).toBeNull();
    expect(normalizeGuestHost('a..example.in')).toBeNull();
    expect(normalizeGuestHost(`${'a'.repeat(64)}.example.in`)).toBeNull();
  });

  it('refuses credentials smuggled into the authority', () => {
    // `evil.test@good.example.in` is a host a careless reader sees as
    // good.example.in and a careless parser sees as evil.test.
    expect(normalizeGuestHost('https://evil.test@good.example.in')).toBeNull();
  });
});

describe('parseDomainPool', () => {
  it('reads a comma separated list and drops what it cannot use', () => {
    expect(parseDomainPool('one.example, https://two.example/ , , nope, three.example')).toEqual([
      'one.example',
      'two.example',
      'three.example',
    ]);
  });

  it('drops duplicates so assignment does not favour a repeated entry', () => {
    expect(parseDomainPool('one.example,ONE.example,two.example')).toEqual(['one.example', 'two.example']);
  });

  it('treats no pool as an empty pool rather than an error', () => {
    expect(parseDomainPool('')).toEqual([]);
  });
});

describe('resolveGuestLinkBaseUrl', () => {
  const shared = 'https://www.waprivate.dev';

  it('falls back to the shared domain when nothing is configured', () => {
    expect(resolveGuestLinkBaseUrl(null, shared)).toBe(shared);
    expect(resolveGuestLinkBaseUrl(undefined, shared)).toBe(shared);
    expect(resolveGuestLinkBaseUrl({}, shared)).toBe(shared);
  });

  it('uses a pool domain immediately — it is ours, there is nothing to prove', () => {
    expect(resolveGuestLinkBaseUrl({ host: 'two.example', source: 'POOL' }, shared)).toBe('https://two.example');
  });

  it('ignores an unverified custom domain', () => {
    expect(
      resolveGuestLinkBaseUrl({ host: 'chat.example.in', source: 'CUSTOM', verifiedAt: null }, shared),
    ).toBe(shared);
  });

  it('uses a custom domain once it is verified', () => {
    expect(
      resolveGuestLinkBaseUrl({ host: 'chat.example.in', source: 'CUSTOM', verifiedAt: new Date() }, shared),
    ).toBe('https://chat.example.in');
  });

  it('ignores a stored host that no longer normalizes', () => {
    expect(resolveGuestLinkBaseUrl({ host: 'not a host', source: 'POOL' }, shared)).toBe(shared);
  });

  it('never leaves a trailing slash for /c/ to double up on', () => {
    expect(resolveGuestLinkBaseUrl(null, 'https://www.waprivate.dev/')).toBe(shared);
  });
});

describe('guestChatUrl and guestLinkUrlPattern', () => {
  it('builds the link a customer taps', () => {
    expect(guestChatUrl('https://chat.example.in', 'abc123')).toBe('https://chat.example.in/c/abc123');
    expect(guestChatUrl('https://chat.example.in/', 'abc123')).toBe('https://chat.example.in/c/abc123');
  });

  it('builds the pattern a WhatsApp template is approved against', () => {
    expect(guestLinkUrlPattern('https://chat.example.in')).toBe('https://chat.example.in/c/{{1}}');
    expect(guestLinkUrlPattern('')).toBeNull();
  });
});

describe('txtRecordsProveOwnership', () => {
  const token = 'a1b2c3';
  const expected = guestDomainTxtValue(token);

  it('names a record that cannot collide with the CNAME the host will need', () => {
    expect(guestDomainTxtName('chat.example.in')).toBe('_voxo-chat.chat.example.in');
  });

  it('accepts the record among a zone’s other TXT records', () => {
    expect(txtRecordsProveOwnership([['v=spf1 -all'], [expected]], token)).toBe(true);
  });

  it('joins the 255-byte chunks a resolver splits a record into', () => {
    const half = Math.ceil(expected.length / 2);
    expect(txtRecordsProveOwnership([[expected.slice(0, half), expected.slice(half)]], token)).toBe(true);
  });

  it('tolerates the whitespace and quoting registrar UIs add', () => {
    expect(txtRecordsProveOwnership([[`  "${expected}"  `]], token)).toBe(true);
  });

  it('rejects another workspace’s token', () => {
    expect(txtRecordsProveOwnership([[guestDomainTxtValue('someone-else')]], token)).toBe(false);
  });

  it('rejects a record that merely contains the token', () => {
    expect(txtRecordsProveOwnership([[`${expected} and more`]], token)).toBe(false);
    expect(txtRecordsProveOwnership([], token)).toBe(false);
  });
});
