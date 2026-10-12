import SmsAndroid, { type RawSmsMessage } from 'react-native-get-sms-android';

export const MAX_SMS_SCANNED = 300;

/**
 * One of the device's own SMS boxes, newest-scanned-first — read-only,
 * never leaves the device except as a reply. 'sent' is what makes a
 * message VOXO itself sent (sendSms in VoxoSmsAutoReplyModule.kt inserts
 * a record there, same as the Messages app does for its own sends) show
 * up as a real, persisted row rather than something that only exists for
 * as long as a screen stays mounted.
 */
export function listSms(box: 'inbox' | 'sent'): Promise<RawSmsMessage[]> {
  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify({ box, maxCount: MAX_SMS_SCANNED }),
      (error) => reject(new Error(error)),
      (_count, smsListJson) => {
        try {
          resolve(JSON.parse(smsListJson) as RawSmsMessage[]);
        } catch {
          reject(new Error(`Could not read the SMS ${box}.`));
        }
      },
    );
  });
}

/** The device's own SMS inbox — see listSms. Kept as its own export since most callers only ever want this one box. */
export function listInboxSms(): Promise<RawSmsMessage[]> {
  return listSms('inbox');
}
