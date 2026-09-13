import { cloudinaryVideoPoster } from "./cloudinary";

/**
 * No network: this builds a URL, and the shape of that URL is the whole
 * contract. Getting it wrong does not throw — it 404s at Cloudinary on
 * every video in the app, and the bubble silently falls back to no
 * poster, which looks exactly like the bug this was meant to fix.
 */
describe("cloudinaryVideoPoster", () => {
  const video =
    "https://res.cloudinary.com/demo/video/upload/v1699999999/voxo/t1/clip.mp4";

  it("asks for the first frame, as an image, at the requested bound", () => {
    expect(cloudinaryVideoPoster(video, 480)).toBe(
      "https://res.cloudinary.com/demo/video/upload/so_0,c_limit,w_480,q_auto/v1699999999/voxo/t1/clip.jpg",
    );
  });

  it("keeps everything after /upload/ apart from the extension", () => {
    // The version and folder path are how Cloudinary finds the asset at
    // all; dropping either would derive from a file that does not exist.
    const poster = cloudinaryVideoPoster(video, 720)!;
    expect(poster).toContain("/v1699999999/voxo/t1/clip.jpg");
    expect(poster).toContain("w_720");
  });

  it("declines a URL it cannot derive from rather than returning a broken one", () => {
    // Media held at Meta, or in Mongo: no /upload/ segment to transform.
    expect(
      cloudinaryVideoPoster("https://lookaside.fbcdn.net/whatsapp/abc", 480),
    ).toBeNull();
    expect(cloudinaryVideoPoster("meta:1234567890", 480)).toBeNull();
  });

  it("declines a URL with no extension instead of guessing one", () => {
    expect(
      cloudinaryVideoPoster(
        "https://res.cloudinary.com/demo/video/upload/v1/voxo/clip",
        480,
      ),
    ).toBeNull();
  });
});
