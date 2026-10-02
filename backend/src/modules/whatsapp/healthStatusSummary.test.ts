import { summariseHealthStatus } from './healthStatusSummary';

/**
 * The payload below is the real one, captured from the number that could
 * not deliver a single message while every screen in the app and in Meta's
 * own dashboard showed it CONNECTED with a High quality rating.
 */
const REAL = {
  can_send_message: 'LIMITED',
  entities: [
    {
      entity_type: 'PHONE_NUMBER',
      id: '1390492767471371',
      can_send_message: 'LIMITED',
      can_receive_call_sip: 'BLOCKED',
      errors: [
        {
          error_code: 138024,
          error_description: 'WhatsApp Business calling cannot use SIP because it is not enabled',
          possible_solution: 'Configure SIP using {PHONE_NUMBER_ID}/settings API',
        },
      ],
      additional_info: [
        'Your display name has not been approved yet. Your message limit will increase after the display name is approved.',
      ],
    },
    { entity_type: 'WABA', id: '834301939761794', can_send_message: 'AVAILABLE' },
    { entity_type: 'BUSINESS', id: '1119553801014221', can_send_message: 'AVAILABLE' },
    {
      entity_type: 'APP',
      id: '1119027070555222',
      can_send_message: 'AVAILABLE',
      can_receive_call_sip: 'BLOCKED',
      errors: [
        {
          error_code: 138025,
          error_description: 'This app cannot use SIP for WhatsApp Business calling',
          possible_solution: 'Configure SIP server using {PHONE_NUMBER_ID}/settings API',
        },
      ],
    },
  ],
};

describe('summariseHealthStatus', () => {
  it('reports the verdict and the reason from the entity actually holding things up', () => {
    const summary = summariseHealthStatus(REAL);
    expect(summary.canSendMessage).toBe('LIMITED');
    expect(summary.reason).toMatch(/display name has not been approved/i);
  });

  it('ignores the calling errors, which are not sending errors', () => {
    // 138024/138025 sit in the same errors array and are about SIP
    // telephony. Reporting them to someone whose messages are not
    // arriving sends them to configure a feature they are not using.
    const summary = summariseHealthStatus(REAL);
    expect(summary.reason).not.toMatch(/SIP/i);
  });

  it('skips the healthy entities rather than reporting the first one listed', () => {
    const summary = summariseHealthStatus({
      can_send_message: 'BLOCKED',
      entities: [
        { entity_type: 'WABA', can_send_message: 'AVAILABLE' },
        { entity_type: 'BUSINESS', can_send_message: 'AVAILABLE' },
        {
          entity_type: 'PHONE_NUMBER',
          can_send_message: 'BLOCKED',
          errors: [{ error_code: 1, error_description: 'The number is restricted.' }],
        },
      ],
    });
    expect(summary.reason).toBe('The number is restricted.');
  });

  it('says nothing beyond the verdict when everything is available', () => {
    expect(summariseHealthStatus({ can_send_message: 'AVAILABLE', entities: [] })).toEqual({
      canSendMessage: 'AVAILABLE',
    });
  });

  it('survives the shapes Meta has not sent yet', () => {
    // A diagnostic that throws on an unfamiliar payload fails exactly when
    // it is needed, so every one of these has to come back empty instead.
    expect(summariseHealthStatus(null)).toEqual({});
    expect(summariseHealthStatus(undefined)).toEqual({});
    expect(summariseHealthStatus('LIMITED')).toEqual({});
    expect(summariseHealthStatus([])).toEqual({});
    expect(summariseHealthStatus({ entities: 'nope' })).toEqual({});
    expect(summariseHealthStatus({ can_send_message: 'LIMITED', entities: [null, 7] })).toEqual({
      canSendMessage: 'LIMITED',
    });
  });

  it('appends the suggested remedy when Meta gives one', () => {
    const summary = summariseHealthStatus({
      can_send_message: 'BLOCKED',
      entities: [
        {
          entity_type: 'WABA',
          can_send_message: 'BLOCKED',
          errors: [
            {
              error_code: 2,
              error_description: 'Payment method missing.',
              possible_solution: 'Add one in Business Settings.',
            },
          ],
        },
      ],
    });
    expect(summary.reason).toBe('Payment method missing. Add one in Business Settings.');
  });
});
