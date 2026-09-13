import { toPublicWhatsAppNumber } from './whatsapp.service';
import type { WhatsAppPhoneNumberDoc } from './whatsappPhoneNumber.model';

/**
 * The one rule that could not be got wrong quietly.
 *
 * `enabled` was added after numbers already existed, so every stored
 * document is missing it. If absent read as "off", the deploy that shipped
 * this field would have locked every member out of every number at once —
 * silently, and looking exactly like an outage.
 */
function asNumber(fields: Partial<{ enabled: boolean }>): WhatsAppPhoneNumberDoc {
  return {
    _id: 'n1',
    phoneNumberId: 'PN1',
    displayPhoneNumber: '+91 90000 00000',
    status: 'CONNECTED',
    ...fields,
  } as unknown as WhatsAppPhoneNumberDoc;
}

describe('number access switch', () => {
  it('reports a number with no stored value as enabled', () => {
    expect(toPublicWhatsAppNumber(asNumber({})).enabled).toBe(true);
  });

  it('reports an explicitly enabled number as enabled', () => {
    expect(toPublicWhatsAppNumber(asNumber({ enabled: true })).enabled).toBe(true);
  });

  it('reports an explicitly disabled number as disabled', () => {
    expect(toPublicWhatsAppNumber(asNumber({ enabled: false })).enabled).toBe(false);
  });

  // The switch is the workspace's decision and `status` is Meta's. A
  // refresh from Meta must never be able to turn access back on.
  it('is independent of the Meta status', () => {
    const disabled = asNumber({ enabled: false });
    disabled.status = 'CONNECTED';
    expect(toPublicWhatsAppNumber(disabled).enabled).toBe(false);
    expect(toPublicWhatsAppNumber(disabled).status).toBe('CONNECTED');
  });
});
