import { locationLine } from './guest.service';
import { guestLocationSchema, guestReportSchema } from './guest.validation';

/**
 * The line every non-map reader of a location message sees: the chat list,
 * the agent app, the push notification, a quote. It is stored on the
 * message, so getting it wrong is not a rendering bug that a refresh
 * fixes — it is written into the row.
 */
describe('locationLine', () => {
  it('names the place when there is one', () => {
    expect(locationLine({ latitude: 12.971599, longitude: 77.594566, name: 'Cubbon Park' })).toBe(
      'Cubbon Park (12.971599, 77.594566)',
    );
  });

  it('falls back to a word rather than an empty bracket', () => {
    expect(locationLine({ latitude: 19.076, longitude: 72.8777 })).toBe(
      'Location (19.076000, 72.877700)',
    );
  });

  /**
   * A browser's geolocation reports far more precision than it has — ten
   * or more decimal places off a device accurate to metres. Six is about a
   * tenth of a metre, which is past the accuracy of any consumer GPS, and
   * keeps the line short enough to read.
   */
  it('does not print a browser’s full float', () => {
    expect(locationLine({ latitude: 12.9715987654321, longitude: 77.5945627182818 })).toBe(
      'Location (12.971599, 77.594563)',
    );
  });

  it('treats a blank name as no name', () => {
    expect(locationLine({ latitude: 0, longitude: 0, name: '   ' })).toBe('Location (0.000000, 0.000000)');
  });
});

describe('guestLocationSchema', () => {
  it('accepts a plain coordinate pair', () => {
    const parsed = guestLocationSchema.parse({ latitude: 12.97, longitude: 77.59 });
    expect(parsed.latitude).toBe(12.97);
  });

  it('rejects points that are not on Earth', () => {
    expect(() => guestLocationSchema.parse({ latitude: 91, longitude: 0 })).toThrow();
    expect(() => guestLocationSchema.parse({ latitude: 0, longitude: -181 })).toThrow();
  });

  /**
   * Not coerced. A string here means the client sent something other than
   * a number, and coercing it would turn "" into 0 — the coordinate of a
   * point in the Atlantic that a map would happily draw a pin on.
   */
  it('rejects a coordinate that is not a number', () => {
    expect(() => guestLocationSchema.parse({ latitude: '', longitude: '' })).toThrow();
  });
});

describe('guestReportSchema', () => {
  it('accepts a report with a reason', () => {
    const parsed = guestReportSchema.parse({ reason: 'SPAM', report: true, block: false });
    expect(parsed.reason).toBe('SPAM');
  });

  /** Blocking is not an accusation, so it needs no reason attached. */
  it('accepts a block on its own', () => {
    const parsed = guestReportSchema.parse({ block: true, report: false });
    expect(parsed.block).toBe(true);
  });

  it('refuses a report with no reason', () => {
    expect(() => guestReportSchema.parse({ report: true, block: false })).toThrow();
  });

  it('refuses a submission that would do nothing', () => {
    expect(() => guestReportSchema.parse({ report: false, block: false })).toThrow();
  });

  it('refuses a reason it has never heard of', () => {
    expect(() => guestReportSchema.parse({ reason: 'BECAUSE', report: true, block: false })).toThrow();
  });
});
