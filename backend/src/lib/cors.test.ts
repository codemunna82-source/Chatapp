import { resolveCorsOrigin } from './cors';

/**
 * Which browser origins the API answers.
 *
 * This is an allow-list, so every test here is really asking the same
 * question: can anything get through that should not? The dynamic half is
 * the new risk — it exists so a workspace on its own chat domain can talk
 * to the API, and the classic way that becomes a vulnerability is a
 * near-match being accepted.
 */
function ask(origin: string | undefined, resolved: ReturnType<typeof resolveCorsOrigin>): Promise<boolean> {
  if (typeof resolved === 'boolean') return Promise.resolve(resolved);
  if (typeof resolved !== 'function') throw new Error('expected a callback resolver');
  return new Promise((resolve, reject) => {
    resolved(origin, (err, allow) => (err ? reject(err) : resolve(allow === true)));
  });
}

describe('resolveCorsOrigin', () => {
  it('allows a configured origin and refuses everything else', async () => {
    const resolved = resolveCorsOrigin(['https://a.example']);
    await expect(ask('https://a.example', resolved)).resolves.toBe(true);
    await expect(ask('https://b.example', resolved)).resolves.toBe(false);
  });

  it('allows a request with no Origin at all — the native app and health checks', async () => {
    await expect(ask(undefined, resolveCorsOrigin(['https://a.example']))).resolves.toBe(true);
  });

  it('forgives a trailing slash on either side', async () => {
    const resolved = resolveCorsOrigin(['https://a.example/']);
    await expect(ask('https://a.example', resolved)).resolves.toBe(true);
  });

  it('handles several origins and stray whitespace', async () => {
    const resolved = resolveCorsOrigin(['https://a.example.com', ' https://b.example.com ']);
    await expect(ask('https://a.example.com', resolved)).resolves.toBe(true);
    await expect(ask('https://b.example.com', resolved)).resolves.toBe(true);
  });

  it('turns a wildcard into reflecting the caller, not a literal star', () => {
    // credentials: true forbids answering `*`, so the only workable
    // reading of a wildcard is `true`, which makes cors echo the origin.
    expect(resolveCorsOrigin(['*'])).toBe(true);
  });

  it('refuses everything when nothing is configured and there is nothing to ask', () => {
    expect(resolveCorsOrigin([])).toBe(false);
  });

  describe('with a dynamic source', () => {
    it('consults it only after the static list misses', async () => {
      const lookup = jest.fn().mockResolvedValue(false);
      const resolved = resolveCorsOrigin(['https://a.example'], lookup);

      await expect(ask('https://a.example', resolved)).resolves.toBe(true);
      expect(lookup).not.toHaveBeenCalled();

      await expect(ask('https://b.example', resolved)).resolves.toBe(false);
      expect(lookup).toHaveBeenCalledWith('https://b.example');
    });

    it('allows an origin the dynamic source vouches for', async () => {
      const resolved = resolveCorsOrigin(
        ['https://a.example'],
        async (origin) => origin === 'https://chat.tenant.in',
      );
      await expect(ask('https://chat.tenant.in', resolved)).resolves.toBe(true);
      // The near-misses a suffix check would have let through.
      await expect(ask('https://chat.tenant.in.attacker.test', resolved)).resolves.toBe(false);
      await expect(ask('https://evil-chat.tenant.in', resolved)).resolves.toBe(false);
    });

    it('is still an allow-list when nothing static is configured', async () => {
      const resolved = resolveCorsOrigin([], async (origin) => origin === 'https://chat.tenant.in');
      await expect(ask('https://chat.tenant.in', resolved)).resolves.toBe(true);
      await expect(ask('https://anything.else', resolved)).resolves.toBe(false);
    });

    it('treats a failed lookup as a refusal rather than a 500', async () => {
      // The database being down must not turn every cross-origin request
      // into a server error — and must certainly not turn it into a grant.
      const resolved = resolveCorsOrigin(['https://a.example'], async () => {
        throw new Error('mongo is down');
      });
      await expect(ask('https://b.example', resolved)).resolves.toBe(false);
    });

    it('still short-circuits a wildcard without asking', () => {
      expect(resolveCorsOrigin(['*'], async () => false)).toBe(true);
    });
  });
});
