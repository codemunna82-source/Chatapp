import { parseWebhookPayload } from './webhookPayload';

function inboundTextPayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_NUMBER_ID' },
              contacts: [{ profile: { name: 'Alex Rivera' }, wa_id: '15550002222' }],
              messages: [
                {
                  from: '15550002222',
                  id: 'wamid.HBgLMTU1NTAwMDIyMjIVAgASGBQzQTVCM',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'Is my order ready?' },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

function statusUpdatePayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_NUMBER_ID' },
              statuses: [
                {
                  id: 'wamid.OUTBOUND0001',
                  status: 'delivered',
                  timestamp: '1700000100',
                  recipient_id: '15550002222',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

describe('parseWebhookPayload', () => {
  it('normalizes an inbound text message', () => {
    const items = parseWebhookPayload(inboundTextPayload());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'message',
      eventId: 'wamid.HBgLMTU1NTAwMDIyMjIVAgASGBQzQTVCM',
      phoneNumberId: 'PHONE_NUMBER_ID',
      from: '15550002222',
      messageId: 'wamid.HBgLMTU1NTAwMDIyMjIVAgASGBQzQTVCM',
      messageType: 'text',
      text: 'Is my order ready?',
      contactName: 'Alex Rivera',
    });
  });

  it('normalizes a status update with a per-transition idempotency key', () => {
    const items = parseWebhookPayload(statusUpdatePayload());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'status',
      eventId: 'wamid.OUTBOUND0001:delivered',
      phoneNumberId: 'PHONE_NUMBER_ID',
      messageId: 'wamid.OUTBOUND0001',
      status: 'delivered',
    });
  });

  it('gives sent/delivered/read transitions of the same message distinct event ids', () => {
    const sent = parseWebhookPayload({
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P' }, statuses: [{ id: 'wamid.X', status: 'sent', timestamp: '1' }] } }] }],
    })[0];
    const delivered = parseWebhookPayload({
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P' }, statuses: [{ id: 'wamid.X', status: 'delivered', timestamp: '2' }] } }] }],
    })[0];
    expect(sent?.eventId).not.toBe(delivered?.eventId);
  });

  it('extracts a media reference and caption for an image message', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'P' },
                messages: [
                  {
                    from: '15550002222',
                    id: 'wamid.IMG0001',
                    timestamp: '1700000200',
                    type: 'image',
                    image: { id: 'META_MEDIA_ID', mime_type: 'image/jpeg', caption: 'Receipt photo' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const [item] = parseWebhookPayload(payload);
    expect(item?.kind).toBe('message');
    if (item?.kind === 'message') {
      expect(item.messageType).toBe('image');
      expect(item.text).toBe('Receipt photo');
      expect(item.mediaRef).toEqual({ metaMediaId: 'META_MEDIA_ID', mimeType: 'image/jpeg' });
    }
  });

  it('falls back to "unknown" for a message type we do not model, without throwing', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'P' },
                messages: [{ from: '1', id: 'wamid.SYS1', timestamp: '1700000300', type: 'system' }],
              },
            },
          ],
        },
      ],
    };
    const [item] = parseWebhookPayload(payload);
    expect(item?.kind).toBe('message');
    if (item?.kind === 'message') {
      expect(item.messageType).toBe('unknown');
    }
  });

  it('ignores changes for fields other than "messages" (e.g. template status updates)', () => {
    const payload = {
      entry: [{ changes: [{ field: 'message_template_status_update', value: { some: 'thing' } }] }],
    };
    expect(parseWebhookPayload(payload)).toHaveLength(0);
  });

  it('returns an empty array for a malformed/empty payload rather than throwing', () => {
    expect(parseWebhookPayload({})).toEqual([]);
    expect(parseWebhookPayload(null)).toEqual([]);
    expect(parseWebhookPayload({ entry: 'not-an-array' })).toEqual([]);
  });

  it('handles multiple messages and statuses within a single delivery', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'P' },
                messages: [
                  { from: 'A', id: 'wamid.M1', timestamp: '1', type: 'text', text: { body: 'hi' } },
                  { from: 'B', id: 'wamid.M2', timestamp: '2', type: 'text', text: { body: 'yo' } },
                ],
                statuses: [{ id: 'wamid.M0', status: 'read', timestamp: '3' }],
              },
            },
          ],
        },
      ],
    };
    const items = parseWebhookPayload(payload);
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.kind === 'message')).toHaveLength(2);
    expect(items.filter((i) => i.kind === 'status')).toHaveLength(1);
  });
});
