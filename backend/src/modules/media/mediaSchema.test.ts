import { Media } from './media.model';

/**
 * No database: a Mongoose schema can be inspected without a connection,
 * and what needs pinning here is a `required` flag rather than any
 * behaviour at runtime.
 *
 * This guards a bug that was invisible from both ends. `sha256` was
 * required, but inbound WhatsApp media is recorded at webhook time without
 * downloading the bytes, so there is no hash to give — and an empty string
 * does not satisfy `required` on a String. Every photo, video and voice
 * note a customer sent threw "Path `sha256` is required" inside the webhook
 * handler: the message was never stored, Meta retried the delivery
 * forever, and the agent simply never saw the image. Nothing in the app
 * said anything was wrong.
 */
describe('Media schema', () => {
  it('does not require sha256, which inbound WhatsApp media cannot supply', () => {
    expect(Media.schema.path('sha256').isRequired).toBeFalsy();
  });

  it('accepts a media document with no hash and no size', () => {
    // Exactly the shape webhook.service.ts builds for inbound media.
    const doc = new Media({
      tenantId: '507f1f77bcf86cd799439011',
      whatsappPhoneNumberId: '507f1f77bcf86cd799439012',
      metaMediaId: '1234567890',
      mimeType: 'image/jpeg',
      storageRef: 'meta:1234567890',
      status: 'READY',
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('still requires what genuinely identifies the file', () => {
    // sha256 becoming optional must not quietly relax the rest: without a
    // storageRef there is no way to fetch the bytes back at all.
    const doc = new Media({
      tenantId: '507f1f77bcf86cd799439011',
      whatsappPhoneNumberId: '507f1f77bcf86cd799439012',
      mimeType: 'image/jpeg',
      status: 'READY',
    });
    expect(doc.validateSync()?.errors.storageRef).toBeDefined();
  });
});
