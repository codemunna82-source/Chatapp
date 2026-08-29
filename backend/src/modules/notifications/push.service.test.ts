import { previewForMessage } from './push.service';

/**
 * The preview is the entire notification body — if it is empty or wrong,
 * the user sees a blank or misleading heads-up and has no way to tell what
 * arrived without opening the app.
 */
describe('previewForMessage', () => {
  it('uses the text of a text message', () => {
    expect(previewForMessage('text', 'Is the order ready?')).toBe('Is the order ready?');
  });

  it('truncates a long message rather than pushing a wall of text', () => {
    const long = 'a'.repeat(500);
    const preview = previewForMessage('text', long);
    expect(preview).toHaveLength(120);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('labels media types, which carry no text of their own', () => {
    // A blank notification body reads as a bug, not as a photo.
    expect(previewForMessage('image', undefined)).toBe('📷 Photo');
    expect(previewForMessage('audio', undefined)).toBe('🎤 Voice message');
    expect(previewForMessage('document', undefined)).toBe('📄 Document');
  });

  it('falls back to something readable for an unmodelled type', () => {
    expect(previewForMessage('unknown', undefined)).toBe('New message');
  });

  it('does not render an empty body for a text message with no text', () => {
    // Meta can deliver a text message whose body failed to normalise.
    expect(previewForMessage('text', undefined)).toBe('New message');
  });
});
