import { __jsStringForTests as jsString } from './signupPage.controller';

/**
 * The signup page interpolates two env values into inline JavaScript.
 * They are non-secret ids, but a value that breaks out of its string
 * literal breaks the page silently — the button simply never works — so
 * the escaping is pinned here.
 */
describe('jsString', () => {
  it('leaves an ordinary id untouched', () => {
    expect(jsString('1234567890123456')).toBe('1234567890123456');
  });

  it('escapes quotes and backslashes', () => {
    expect(jsString("it's")).toBe("it\\'s");
    expect(jsString('a\\b')).toBe('a\\\\b');
  });

  it('escapes < so a value cannot close the script tag', () => {
    expect(jsString('</script>')).toBe('\\u003c/script>');
  });

  it('escapes U+2028 and U+2029', () => {
    // Legal inside a JSON string, but a line terminator in JavaScript
    // source — the one case that produces a broken page and no error.
    expect(jsString('a\u2028b')).toBe('a\\u2028b');
    expect(jsString('a\u2029b')).toBe('a\\u2029b');
  });

  it('does not strip ordinary spaces', () => {
    // Guarding a mistake made once already: a regex meant to match the two
    // separators, written with the literal characters, matched spaces.
    expect(jsString('a b')).toBe('a b');
  });
});
