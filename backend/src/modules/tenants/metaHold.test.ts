import { resolveMetaHold } from './metaHold';

/**
 * Three states, not two. A workspace that has never opened the switch is
 * not the same as one that has deliberately turned WhatsApp back on, and
 * reading the second as the first would re-apply a server-wide hold to
 * the workspace that just opted out of it.
 */
describe('resolveMetaHold', () => {
  it('follows the server when the workspace has no preference', () => {
    expect(resolveMetaHold(undefined, true)).toBe(true);
    expect(resolveMetaHold(undefined, false)).toBe(false);
    expect(resolveMetaHold(null, true)).toBe(true);
    expect(resolveMetaHold(null, false)).toBe(false);
  });

  it('lets a workspace put WhatsApp on hold on a server that has not', () => {
    expect(resolveMetaHold(true, false)).toBe(true);
  });

  it('lets a workspace use WhatsApp on a server that holds it by default', () => {
    // The case the distinction exists for: false is a decision, not a
    // blank, and it has to survive a server default of true.
    expect(resolveMetaHold(false, true)).toBe(false);
  });
});
