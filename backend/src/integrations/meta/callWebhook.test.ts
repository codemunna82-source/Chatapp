import { parseWebhookPayload } from './webhookPayload';

/**
 * Calls arrive through the same webhook as messages, under a different
 * field. These pin the two shapes apart, because getting it wrong fails
 * silently: an unparsed connect event is simply a call that never rings.
 */
describe('parseWebhookPayload — calls', () => {
  const connect = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_1',
        changes: [
          {
            field: 'calls',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '+911', phone_number_id: '123' },
              contacts: [{ profile: { name: 'Asha' }, wa_id: '919876543210' }],
              calls: [
                {
                  id: 'CALL_1',
                  from: '919876543210',
                  timestamp: '1735689600',
                  session: { sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0', sdp_type: 'offer' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it('reads an incoming call, its offer and who it is from', () => {
    const [item] = parseWebhookPayload(connect);
    expect(item).toMatchObject({
      kind: 'call',
      event: 'connect',
      callId: 'CALL_1',
      phoneNumberId: '123',
      from: '919876543210',
      contactName: 'Asha',
    });
    expect((item as { sdpOffer?: string }).sdpOffer).toContain('v=0');
  });

  it('keys connect and terminate separately for the same call', () => {
    // Both events carry the same call id. A shared idempotency key would
    // make the terminate look like a duplicate of the connect and get
    // dropped — the call would ring and then never end.
    const terminate = JSON.parse(JSON.stringify(connect));
    terminate.entry[0].changes[0].value.calls[0] = {
      id: 'CALL_1',
      from: '919876543210',
      timestamp: '1735689700',
      status: 'COMPLETED',
      duration: 42,
    };
    const [connectItem] = parseWebhookPayload(connect);
    const [terminateItem] = parseWebhookPayload(terminate);

    expect(connectItem!.eventId).toBe('CALL_1:connect');
    expect(terminateItem!.eventId).toBe('CALL_1:terminate');
    expect(terminateItem).toMatchObject({ event: 'terminate', status: 'COMPLETED', durationSeconds: 42 });
  });

  it('still parses messages, and does not confuse them with calls', () => {
    const messages = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '123' },
                messages: [{ id: 'wamid.1', from: '919876543210', type: 'text', text: { body: 'hi' }, timestamp: '1735689600' }],
              },
            },
          ],
        },
      ],
    };
    const [item] = parseWebhookPayload(messages);
    expect(item!.kind).toBe('message');
  });

  it('ignores a field it does not handle rather than mis-reading it', () => {
    const other = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'W', changes: [{ field: 'account_update', value: { metadata: { phone_number_id: '123' } } }] }],
    };
    expect(parseWebhookPayload(other)).toEqual([]);
  });
});
