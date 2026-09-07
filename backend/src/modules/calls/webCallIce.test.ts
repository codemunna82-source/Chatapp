/**
 * ICE configuration, tested without a database.
 *
 * Worth its own test because a browser and a phone that are served
 * different relays gather candidates that can never pair up — the call
 * rings, answers, and is silent. That failure gives no error anywhere, so
 * the shape of this config is checked here rather than discovered on a
 * customer call.
 */

const ORIGINAL_ENV = process.env;

function loadWithEnv(overrides: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...overrides };
  // Required after resetModules: config/env.ts parses process.env once, at
  // import time, so a fresh module registry is the only way to see a
  // different configuration.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./webCall.service') as typeof import('./webCall.service');
}

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('buildIceServers', () => {
  it('serves the default public STUN when nothing is configured', () => {
    const { buildIceServers, hasTurnConfigured } = loadWithEnv({
      TURN_URLS: undefined,
      TURN_USERNAME: undefined,
      TURN_CREDENTIAL: undefined,
      STUN_URLS: undefined,
    });

    expect(buildIceServers()).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
    // The honest answer to "will calls actually connect": no relay is set.
    expect(hasTurnConfigured()).toBe(false);
  });

  it('includes TURN with its credentials when configured', () => {
    const { buildIceServers, hasTurnConfigured } = loadWithEnv({
      TURN_URLS: 'turn:relay.example.com:3478',
      TURN_USERNAME: 'user',
      TURN_CREDENTIAL: 'secret',
    });

    expect(buildIceServers()).toEqual([
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['turn:relay.example.com:3478'], username: 'user', credential: 'secret' },
    ]);
    expect(hasTurnConfigured()).toBe(true);
  });

  it('splits comma-separated lists and drops the whitespace around them', () => {
    // These are pasted into a hosting dashboard by hand, where a stray
    // space around a comma is routine — and an ICE url with a leading
    // space is silently ignored by the browser rather than rejected.
    const { buildIceServers } = loadWithEnv({
      TURN_URLS: 'turn:a.example.com:3478 , turn:b.example.com:3478?transport=tcp',
      TURN_USERNAME: 'u',
      TURN_CREDENTIAL: 'p',
      STUN_URLS: 'stun:one.example.com , stun:two.example.com',
    });

    expect(buildIceServers()).toEqual([
      { urls: ['stun:one.example.com', 'stun:two.example.com'] },
      {
        urls: ['turn:a.example.com:3478', 'turn:b.example.com:3478?transport=tcp'],
        username: 'u',
        credential: 'p',
      },
    ]);
  });

  it('omits an empty credential pair rather than sending blank strings', () => {
    // A TURN entry with username: '' is not the same as one with no
    // username — some clients treat the empty string as a real credential
    // and fail the allocation instead of falling back.
    const { buildIceServers } = loadWithEnv({
      TURN_URLS: 'turn:relay.example.com:3478',
      TURN_USERNAME: '',
      TURN_CREDENTIAL: '',
    });

    const turn = buildIceServers().find((s) => s.urls[0]?.startsWith('turn:'));
    expect(turn).toEqual({ urls: ['turn:relay.example.com:3478'], username: undefined, credential: undefined });
  });

  it('serves no STUN at all when it is explicitly cleared', () => {
    const { buildIceServers } = loadWithEnv({
      STUN_URLS: '',
      TURN_URLS: 'turn:relay.example.com:3478',
      TURN_USERNAME: 'u',
      TURN_CREDENTIAL: 'p',
    });

    expect(buildIceServers().every((s) => !s.urls[0]?.startsWith('stun:'))).toBe(true);
  });
});
