import { normalizeCallMedia } from './webCall.service';

/**
 * No database. This decides whether a camera opens, and every wrong
 * answer is either a call with no picture or a camera nobody asked for —
 * so it is tested against what clients actually send, including the ones
 * that send nothing.
 */
describe('normalizeCallMedia', () => {
  it('takes video only when video is what was asked for', () => {
    expect(normalizeCallMedia('video')).toBe('video');
  });

  it('treats an older client, which sends nothing, as an audio call', () => {
    expect(normalizeCallMedia(undefined)).toBe('audio');
    expect(normalizeCallMedia(null)).toBe('audio');
  });

  it('refuses anything it does not recognise rather than guessing', () => {
    // A socket takes whatever is put on it. Opening a camera for 'VIDEO',
    // 'true' or an object would be the expensive way to be wrong.
    expect(normalizeCallMedia('VIDEO')).toBe('audio');
    expect(normalizeCallMedia(true)).toBe('audio');
    expect(normalizeCallMedia({ media: 'video' })).toBe('audio');
    expect(normalizeCallMedia(1)).toBe('audio');
  });
});
