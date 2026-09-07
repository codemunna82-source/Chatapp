import { resolveCorsOrigin } from './cors';

type OriginFn = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void;

function check(origin: ReturnType<typeof resolveCorsOrigin>, value: string | undefined): boolean {
  let allowed = false;
  (origin as OriginFn)(value, (_err, ok) => {
    allowed = Boolean(ok);
  });
  return allowed;
}

describe('resolveCorsOrigin', () => {
  it('treats "*" as a real wildcard', () => {
    // render.yaml ships CORS_ORIGINS="*". Handed to `cors` as the array
    // ["*"], it was compared literally and matched no origin at all, so
    // every browser request was blocked. Only the Android app existed, and
    // a native client sends no Origin header, so nothing ever showed it.
    expect(resolveCorsOrigin(['*'])).toBe(true);
  });

  it('allows exactly the configured origins', () => {
    const origin = resolveCorsOrigin(['https://chat.example.com']);
    expect(check(origin, 'https://chat.example.com')).toBe(true);
    expect(check(origin, 'https://evil.example.com')).toBe(false);
  });

  it('ignores a trailing slash on either side', () => {
    // Pasting the origin out of a browser's address bar brings the slash
    // with it, and an exact match would then reject the real site.
    const origin = resolveCorsOrigin(['https://chat.example.com/']);
    expect(check(origin, 'https://chat.example.com')).toBe(true);
  });

  it('allows a request with no Origin header', () => {
    // curl, health checks and the native mobile client. Not a browser
    // cross-origin request, so CORS has nothing to decide.
    const origin = resolveCorsOrigin(['https://chat.example.com']);
    expect(check(origin, undefined)).toBe(true);
  });

  it('handles several origins and stray whitespace', () => {
    const origin = resolveCorsOrigin(['https://a.example.com', ' https://b.example.com ']);
    expect(check(origin, 'https://a.example.com')).toBe(true);
    expect(check(origin, 'https://b.example.com')).toBe(true);
  });

  it('denies everything when nothing is configured', () => {
    expect(resolveCorsOrigin([])).toBe(false);
  });
});
