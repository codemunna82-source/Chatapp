import { contactDisplayName, formatPhoneForDisplay } from './formatPhone';

/**
 * Kept deliberately identical to the server's own rule (backend
 * src/lib/phone.ts) — the two run in different processes and cannot share
 * code, so these are the cases that say when they have drifted.
 */
describe('formatPhoneForDisplay', () => {
  it('groups an Indian number the way an Indian number is written', () => {
    expect(formatPhoneForDisplay('+919876543210')).toBe('+91 98765 43210');
  });

  it('groups a US number the way a US number is written', () => {
    expect(formatPhoneForDisplay('+14155550123')).toBe('+1 415 555 0123');
  });

  it('does not let +1 swallow a number that is really +971', () => {
    expect(formatPhoneForDisplay('+971501234567')).toBe('+971 50 123 4567');
  });

  it('still breaks up a country it has no pattern for', () => {
    expect(formatPhoneForDisplay('+34612345678')).toBe('+346 1234 5678');
  });

  it('falls back to even blocks when the length does not match the pattern', () => {
    expect(formatPhoneForDisplay('+911234567')).toBe('+9 1123 4567');
  });

  it('hands back anything that is not a plain number untouched', () => {
    // Better a strange header than one that has cut a word into blocks.
    expect(formatPhoneForDisplay('extension 4021')).toBe('extension 4021');
    expect(formatPhoneForDisplay('')).toBe('');
    expect(formatPhoneForDisplay(undefined)).toBe('');
  });
});

describe('contactDisplayName', () => {
  it('prefers the saved name', () => {
    expect(contactDisplayName({ name: 'Priya Sharma', phone: '+919876543210' })).toBe('Priya Sharma');
  });

  it('ignores a name that is only whitespace', () => {
    expect(contactDisplayName({ name: '   ', phone: '+919876543210' })).toBe('+91 98765 43210');
  });

  it('falls back when there is neither', () => {
    expect(contactDisplayName(null)).toBe('Conversation');
    expect(contactDisplayName({}, 'Unknown')).toBe('Unknown');
  });
});
