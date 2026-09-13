import { cloudinaryAsJpeg } from "../../integrations/cloudinary";
import { validateMediaFile, CONVERTIBLE_IMAGE_TYPES } from "./media.validation";

/**
 * No database and no network: the two pure halves of "a phone handed us a
 * format WhatsApp will not take".
 *
 * Worth pinning because the failure this fixes was invisible from the
 * code and obvious to the user — "Unsupported media MIME type:
 * image/webp" on a picture they could see perfectly well on screen.
 */
describe("images WhatsApp will not accept", () => {
  it("lets the formats a phone actually produces through validation, as images", () => {
    for (const type of CONVERTIBLE_IMAGE_TYPES) {
      expect(validateMediaFile(type, 1_000_000)).toBe("image");
    }
  });

  it("still holds them to the image size ceiling", () => {
    // Checked before conversion on purpose — conversion only ever makes
    // a file smaller, so the pre-check is the conservative one.
    expect(() => validateMediaFile("image/webp", 6 * 1024 * 1024)).toThrow(
      /under 5MB/,
    );
  });

  it("still refuses a format that is not an image at all", () => {
    expect(() => validateMediaFile("application/x-msdownload", 1000)).toThrow(
      /Unsupported media MIME type/,
    );
  });

  it("leaves the formats Meta does accept exactly as they were", () => {
    expect(validateMediaFile("image/jpeg", 1000)).toBe("image");
    expect(validateMediaFile("image/png", 1000)).toBe("image");
  });

  describe("cloudinaryAsJpeg", () => {
    const webp =
      "https://res.cloudinary.com/demo/image/upload/v1699999999/voxo/t1/shot.webp";

    it("asks for a jpeg, bounded, by both transformation and extension", () => {
      // Both halves matter: f_jpg without the extension change asks
      // Cloudinary for a format the filename contradicts.
      expect(cloudinaryAsJpeg(webp, 1600)).toBe(
        "https://res.cloudinary.com/demo/image/upload/f_jpg,c_limit,w_1600,q_auto/v1699999999/voxo/t1/shot.jpg",
      );
    });

    it("keeps the version and folder, which are how the asset is found", () => {
      expect(cloudinaryAsJpeg(webp, 800)).toContain(
        "/v1699999999/voxo/t1/shot.jpg",
      );
    });

    it("declines a URL it cannot derive from rather than returning a broken one", () => {
      expect(
        cloudinaryAsJpeg("https://lookaside.fbcdn.net/whatsapp/abc", 1600),
      ).toBeNull();
      expect(
        cloudinaryAsJpeg(
          "https://res.cloudinary.com/demo/image/upload/v1/shot",
          1600,
        ),
      ).toBeNull();
    });
  });
});
