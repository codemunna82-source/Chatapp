import { parseWebhookPayload } from './webhookPayload';
import type { NormalizedMessageItem } from './webhookPayload';

/** Narrows one parsed item to a message, failing the test if it is not. */
function messageItem(payload: unknown): NormalizedMessageItem {
  const [item] = parseWebhookPayload(payload);
  if (!item || item.kind !== 'message') throw new Error('expected one message item');
  return item;
}

const envelope = (message: unknown) => ({
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '1234567890' },
            messages: [message],
          },
        },
      ],
    },
  ],
});

const pin = (location: unknown) =>
  envelope({ id: 'wamid.LOC', from: '919999999999', type: 'location', timestamp: '1700000000', location });

/**
 * A pin dropped in WhatsApp and one shared from the web window have to
 * come out the same shape, or the chat shows two kinds of location message
 * and only one of them draws a map.
 */
describe('parseWebhookPayload — location', () => {
  it('carries the coordinates alongside the text line', () => {
    const item = messageItem(pin({ latitude: 12.971599, longitude: 77.594566, name: 'Cubbon Park' }));
    expect(item.location).toEqual({
      latitude: 12.971599,
      longitude: 77.594566,
      name: 'Cubbon Park',
      address: undefined,
    });
    expect(item.text).toContain('Cubbon Park');
  });

  /**
   * Meta's payload is another system's JSON. Half a coordinate, or one
   * that is not a number at all, must leave the message with no location
   * rather than a pin somewhere confidently wrong.
   */
  it('drops a pair that is not a point on Earth', () => {
    for (const bad of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: 'north', longitude: 12 },
      { latitude: 12 },
      undefined,
    ]) {
      expect(messageItem(pin(bad)).location).toBeUndefined();
    }
  });

  it('leaves every other message type without one', () => {
    const item = messageItem(
      envelope({ id: 'wamid.T', from: '919999999999', type: 'text', timestamp: '1700000000', text: { body: 'hi' } }),
    );
    expect(item.location).toBeUndefined();
  });
});
