import { cloudinaryVariant } from './cloudinary';

describe('cloudinaryVariant', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1712345678/voxo/tenant/abc.jpg';

  it('inserts the transformation immediately after /upload/', () => {
    expect(cloudinaryVariant(url, 480)).toBe(
      'https://res.cloudinary.com/demo/image/upload/c_limit,w_480,q_auto/v1712345678/voxo/tenant/abc.jpg',
    );
  });

  /**
   * c_limit rather than c_scale is the whole point: a photo already
   * narrower than the bound must come back as it is, not upscaled into a
   * blurry copy of itself that is also larger than the original.
   */
  it('asks for a limit, never an enlargement', () => {
    expect(cloudinaryVariant(url, 960)).toContain('c_limit,w_960');
  });

  it('leaves a URL that is not a Cloudinary delivery URL alone', () => {
    const other = 'https://example.com/files/photo.jpg';
    expect(cloudinaryVariant(other, 480)).toBe(other);
  });

  /** A file held in the database has a `db:` ref, and must not be mangled. */
  it('leaves a database storage ref alone', () => {
    expect(cloudinaryVariant('db:9f86d081', 480)).toBe('db:9f86d081');
  });
});
