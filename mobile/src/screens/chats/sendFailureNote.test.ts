import { sendFailureNote } from './sendFailureNote';

describe('sendFailureNote', () => {
  it('explains a spent WhatsApp allowance and names the way through', () => {
    const note = sendFailureNote('WHATSAPP_NUDGE_LIMIT_REACHED');
    expect(note).toContain('private chat link');
  });

  it('explains that the wording is fixed, not that sending is over', () => {
    const note = sendFailureNote('WHATSAPP_NUDGE_NOT_ALLOWED');
    expect(note).toContain('fixed WhatsApp messages');
  });

  it('explains a closed 24-hour window', () => {
    expect(sendFailureNote('MESSAGE_TEMPLATE_REQUIRED')).toContain('24 hours');
  });

  // The important half. A dropped connection, a 500, a rejected media
  // upload — those are blips, "tap to retry" is the whole instruction,
  // and a paragraph under them would bury it.
  it('says nothing for an ordinary failure', () => {
    expect(sendFailureNote('INTERNAL_ERROR')).toBeNull();
    expect(sendFailureNote(undefined)).toBeNull();
  });
});
