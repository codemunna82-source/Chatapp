import { assertGuestMedia, guestMediaKind, GUEST_AUDIO_MAX_BYTES, GUEST_IMAGE_MAX_BYTES } from './guestMedia.service';
import { ApiError } from '../../lib/ApiError';

describe('guestMediaKind', () => {
  it('accepts the image types a phone camera roll produces', () => {
    expect(guestMediaKind('image/jpeg')).toBe('image');
    expect(guestMediaKind('image/webp')).toBe('image');
  });

  /**
   * The regression this file exists for. MediaRecorder reports its codec in
   * the Content-Type, so a bare-string match rejects every recording Chrome
   * makes — voice notes would fail on the most common browser there is,
   * with "only photos can be sent here" as the explanation.
   */
  it('accepts a recorder type that carries its codec', () => {
    expect(guestMediaKind('audio/webm;codecs=opus')).toBe('audio');
    expect(guestMediaKind('audio/ogg; codecs=opus')).toBe('audio');
  });

  it('accepts what Safari records, which is the whole iPhone audience', () => {
    expect(guestMediaKind('audio/mp4')).toBe('audio');
  });

  it('is not case sensitive', () => {
    expect(guestMediaKind('IMAGE/PNG')).toBe('image');
  });

  it('refuses anything else', () => {
    expect(guestMediaKind('application/pdf')).toBeNull();
    expect(guestMediaKind('video/mp4')).toBeNull();
    expect(guestMediaKind('')).toBeNull();
  });
});

describe('assertGuestMedia', () => {
  it('returns the kind for a file within its own limit', () => {
    expect(assertGuestMedia('image/png', 1024)).toBe('image');
    expect(assertGuestMedia('audio/webm;codecs=opus', 1024)).toBe('audio');
  });

  it('refuses an unsupported type', () => {
    expect(() => assertGuestMedia('application/zip', 10)).toThrow(ApiError);
  });

  /**
   * The two limits are different sizes, and applying the image one to audio
   * would cut a voice note off at eight megabytes for no reason — so the
   * boundary is asserted per kind rather than assumed shared.
   */
  it('holds each kind to its own size limit', () => {
    expect(() => assertGuestMedia('image/jpeg', GUEST_IMAGE_MAX_BYTES + 1)).toThrow(/8 MB/);
    expect(assertGuestMedia('audio/mp4', GUEST_IMAGE_MAX_BYTES + 1)).toBe('audio');
    expect(() => assertGuestMedia('audio/mp4', GUEST_AUDIO_MAX_BYTES + 1)).toThrow(/16 MB/);
  });
});
