import { MEDIA_WIDTH_BUCKETS, resolveMediaWidth } from "./media.validation";

/**
 * No database: this is the pure half of the media endpoint — which size a
 * request is actually served at.
 *
 * Worth pinning because both directions of getting it wrong are bugs the
 * user sees and the tests would not: rounding down makes every photo in
 * the app soft, and honouring an arbitrary number turns one photo into
 * unbounded Cloudinary derivations.
 */
describe("resolveMediaWidth", () => {
  it('means "the original" when no width is asked for', () => {
    expect(resolveMediaWidth(undefined)).toBeUndefined();
    expect(resolveMediaWidth("")).toBeUndefined();
    expect(resolveMediaWidth(null)).toBeUndefined();
  });

  it("ignores a value that is not a usable width", () => {
    expect(resolveMediaWidth("wide")).toBeUndefined();
    expect(resolveMediaWidth(0)).toBeUndefined();
    expect(resolveMediaWidth(-800)).toBeUndefined();
  });

  it("rounds UP to the next bucket, never down", () => {
    // 321px asked for and 320px served would be a photo drawn one pixel
    // short of its box — soft, on every screen, forever.
    expect(resolveMediaWidth(321)).toBe(480);
    expect(resolveMediaWidth(481)).toBe(720);
    expect(resolveMediaWidth(1)).toBe(320);
  });

  it("serves a bucket exactly when one is asked for exactly", () => {
    for (const bucket of MEDIA_WIDTH_BUCKETS) {
      expect(resolveMediaWidth(bucket)).toBe(bucket);
    }
  });

  it("caps at the largest bucket rather than falling back to full size", () => {
    // A request for the whole camera roll original undoes the entire
    // point of the parameter. The original is still reachable — by
    // asking for no width at all, which is what the viewer does.
    expect(resolveMediaWidth(4032)).toBe(1080);
    expect(resolveMediaWidth(1081)).toBe(1080);
  });

  it("accepts the string a query parameter actually arrives as", () => {
    expect(resolveMediaWidth("840")).toBe(1080);
  });
});
