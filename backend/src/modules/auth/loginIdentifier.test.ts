import { loginSchema } from './auth.validation';
import { createUserSchema } from '../users/user.validation';
import { normalizePhone } from '../../lib/phone';

/**
 * Sign-in moved from an email to a phone number. These are the cases that
 * decide whether someone can get in at all, so they are pinned rather than
 * spot-checked.
 */
describe('loginSchema', () => {
  it('takes a phone number in the identifier field', () => {
    const parsed = loginSchema.parse({ identifier: '+91 98765 43210', password: 'pw' });
    expect(parsed.identifier).toBe('+91 98765 43210');
  });

  it('takes it in a field called phone, which is what the new app sends', () => {
    expect(loginSchema.parse({ phone: '+919876543210', password: 'pw' }).identifier).toBe('+919876543210');
  });

  /**
   * The compatibility case, and the one worth a test: an APK already on
   * someone's phone posts { email, password }. Dropping that field would
   * have signed every installed copy out permanently on deploy.
   */
  it('still takes the email field older apps send', () => {
    expect(loginSchema.parse({ email: 'admin@example.com', password: 'pw' }).identifier).toBe(
      'admin@example.com',
    );
  });

  /**
   * Deliberately not validated as an email or as a phone. The lookup
   * decides which it was; rejecting "9876543210" here as a malformed email
   * would refuse the request before the code that understands it runs.
   */
  it('does not judge the shape of the identifier', () => {
    expect(() => loginSchema.parse({ identifier: '9876543210', password: 'pw' })).not.toThrow();
    expect(() => loginSchema.parse({ identifier: 'not-an-email', password: 'pw' })).not.toThrow();
  });

  it('refuses a request with nothing to look up', () => {
    expect(() => loginSchema.parse({ password: 'pw' })).toThrow();
    expect(() => loginSchema.parse({ identifier: '   ', password: 'pw' })).toThrow();
  });
});

/**
 * How login tells a phone number from an email — there is no second field
 * asking the person to say which one they typed.
 */
describe('identifier resolution', () => {
  it('reads every form of a number people actually type as the same number', () => {
    for (const typed of ['+91 98765 43210', '+91-98765-43210', '0091 9876543210', '919876543210']) {
      expect(normalizePhone(typed)).toBe('+919876543210');
    }
  });

  it('never mistakes an email for a phone number', () => {
    expect(normalizePhone('admin@example.com')).toBeNull();
    expect(normalizePhone('9876543210@example.com')).toBeNull();
  });
});

describe('createUserSchema', () => {
  it('requires a phone number, because sign-in needs one', () => {
    // Without it the account is one nobody can get into.
    expect(() =>
      createUserSchema.parse({
        email: 'a@b.com',
        password: 'password1',
        validUntil: new Date(Date.now() + 86400000),
      }),
    ).toThrow();
  });

  it('requires the country code', () => {
    // "9876543210" is a different person in a different country, and a
    // login that guessed would eventually guess wrong.
    expect(() =>
      createUserSchema.parse({
        email: 'a@b.com',
        password: 'password1',
        phone: '9876543',
        validUntil: new Date(Date.now() + 86400000),
      }),
    ).toThrow();
  });

  it('accepts a number typed the way a person types it', () => {
    const parsed = createUserSchema.parse({
      email: 'a@b.com',
      password: 'password1',
      phone: '+91 98765 43210',
      validUntil: new Date(Date.now() + 86400000),
    });
    expect(parsed.phone).toBe('+91 98765 43210');
  });
});
